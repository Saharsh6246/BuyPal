import { useEffect, useRef, useState } from 'react';
import { api, money } from '../api.js';
import { loadPayPalSdk } from '../paypalSdk.js';
import { IconClose, IconShield } from './icons.jsx';

const REASON_LABEL = { welcome: 'Welcome gift', search: 'Search', setup: 'Setup', topup: 'PayPal top-up', paypal_claim: 'PayPal checkout reward' };

/** Verifiable earning path: a PayPal Sandbox payment to Buypal's own merchant account. */
function TopUp({ wallet, onCredited }) {
  const [packId, setPackId] = useState(wallet.packs[1]?.id || wallet.packs[0].id);
  const [approved, setApproved] = useState(false);
  const [state, setState] = useState({ phase: 'loading', message: '' });
  const sessionRef = useRef(null);
  const buttonRef = useRef(null);
  const latest = useRef({});
  latest.current = { packId, onCredited };
  const pack = wallet.packs.find((p) => p.id === packId);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const config = await api.config();
        if (!config.paypal.configured) return setState({ phase: 'unconfigured', message: 'PayPal Sandbox needs a Client ID and Secret in the server .env file.' });
        await loadPayPalSdk();
        const sdk = await window.paypal.createInstance({ clientId: config.paypal.clientId, components: ['paypal-payments'], pageType: 'cart' });
        const methods = await sdk.findEligibleMethods({ currencyCode: 'USD' });
        if (!methods.isEligible('paypal')) return setState({ phase: 'error', message: 'PayPal Sandbox checkout is not available for these credentials.' });
        sessionRef.current = sdk.createPayPalOneTimePaymentSession({
          onApprove: async ({ orderId }) => {
            setState({ phase: 'working', message: 'Payment approved. Verifying it with PayPal…' });
            try {
              const receipt = await api.captureOrder(orderId);
              if (receipt.status === 'COMPLETED') {
                setState({ phase: 'done', message: `${receipt.points} ${receipt.unit} added. Balance: ${receipt.balance}.` });
                setApproved(false);
                latest.current.onCredited(receipt.balance);
              } else setState({ phase: 'info', message: receipt.message || 'PayPal is still processing this payment.' });
            } catch (e) { setState({ phase: 'error', message: e.message }); }
          },
          onCancel: () => setState({ phase: 'info', message: 'Cancelled. Nothing was charged and no points were added.' }),
          onError: () => setState({ phase: 'error', message: 'PayPal could not complete the payment. Nothing was charged.' }),
        });
        if (!cancelled) setState({ phase: 'ready', message: '' });
      } catch {
        if (!cancelled) setState({ phase: 'error', message: 'Could not load PayPal Sandbox. Check your connection and credentials.' });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const start = async () => {
    if (!sessionRef.current || !approved) return;
    setState({ phase: 'working', message: 'Preparing your Sandbox payment…' });
    try {
      const orderPromise = api.createTopUp(latest.current.packId).then((order) => ({ orderId: order.orderId }));
      await sessionRef.current.start({ presentationMode: 'auto' }, orderPromise);
      setState((s) => (s.phase === 'working' ? { phase: 'ready', message: '' } : s));
    } catch (e) { setState({ phase: 'error', message: e.message || 'Could not start PayPal.' }); }
  };
  useEffect(() => {
    const el = buttonRef.current;
    if (!el) return undefined;
    el.addEventListener('click', start);
    return () => el.removeEventListener('click', start);
  });

  return (
    <div>
      <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Choose a points pack">
        {wallet.packs.map((p) => (
          <button key={p.id} type="button" role="radio" aria-checked={packId === p.id} onClick={() => setPackId(p.id)}
            className={`rounded-xl border p-3 text-left transition hover:border-azure ${packId === p.id ? 'border-azure bg-azure/5 ring-2 ring-azure/20' : 'border-rule'}`}>
            <span className="num display block text-xl font-semibold text-navy">{p.points}</span>
            <span className="block text-xs text-muted">{wallet.unit.name}</span>
            <span className="num mt-1 block text-sm font-semibold text-navy">{money(Number(p.priceUsd))}</span>
          </button>
        ))}
      </div>
      <label className="mt-3 flex items-start gap-2 text-[13px] text-navy">
        <input type="checkbox" checked={approved} onChange={(e) => setApproved(e.target.checked)} className="mt-0.5 h-4 w-4 accent-azure" />
        <span>I approve paying {pack && money(Number(pack.priceUsd))} in PayPal Sandbox for {pack?.points} {wallet.unit.name}.</span>
      </label>
      <div className={`mt-3 ${approved && ['ready', 'done', 'info'].includes(state.phase) ? '' : 'pointer-events-none opacity-40'}`}>
        {state.phase === 'unconfigured' || state.phase === 'loading' ? null : <paypal-button ref={buttonRef} type="pay" />}
      </div>
      {state.message && <p role="status" className={`mt-3 rounded-lg border px-3 py-2 text-xs ${state.phase === 'error' ? 'border-danger/30 bg-danger/5 text-danger' : state.phase === 'done' ? 'border-mint/30 bg-mint/5 text-mint' : 'border-rule bg-canvas text-ink'}`}>{state.message}</p>}
      {state.phase === 'loading' && <p className="mt-3 text-xs text-muted">Loading PayPal…</p>}
      <p className="mt-3 flex items-start gap-2 text-xs leading-snug text-muted"><IconShield size={16} className="mt-0.5 flex-none text-mint" />Verified: Buypal confirms the payment with PayPal before adding points. PayPal Sandbox demo, so no real money moves.</p>
    </div>
  );
}

/** Reward path: the shopper reports a PayPal checkout made at an external retailer. */
function Claim({ wallet, prefill, onClaimed }) {
  const [merchant, setMerchant] = useState(prefill?.merchant || '');
  const [transactionId, setTransactionId] = useState('');
  const [amount, setAmount] = useState(prefill?.amount ? String(prefill.amount) : '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState({ kind: '', text: '' });
  const rules = wallet.claimRules;

  useEffect(() => {
    if (prefill?.merchant) setMerchant(prefill.merchant);
    if (prefill?.amount) setAmount(String(prefill.amount));
  }, [prefill]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setMessage({ kind: '', text: '' });
    try {
      const res = await api.claimCheckout({ merchant, transactionId, amountUsd: Number(amount) });
      setMessage({ kind: 'ok', text: `+${res.points} ${wallet.unit.name}. Balance: ${res.balance}.` });
      setTransactionId('');
      onClaimed(res.wallet);
    } catch (error) {
      setMessage({ kind: 'error', text: error.message });
    } finally { setBusy(false); }
  };

  const input = 'field w-full px-3 py-2.5 text-[14px] outline-none placeholder:text-muted/60';
  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-[13px] font-medium text-navy">Store you paid at
          <input value={merchant} onChange={(e) => setMerchant(e.target.value)} className={`${input} mt-1`} placeholder="e.g. Best Buy" maxLength={80} required />
        </label>
        <label className="block text-[13px] font-medium text-navy">Amount paid (USD)
          <input value={amount} onChange={(e) => setAmount(e.target.value)} className={`${input} mt-1`} placeholder="e.g. 42.50" inputMode="decimal" required />
        </label>
      </div>
      <label className="block text-[13px] font-medium text-navy">PayPal transaction ID
        <input value={transactionId} onChange={(e) => setTransactionId(e.target.value)} className={`${input} mt-1 uppercase placeholder:normal-case`} placeholder="17 characters, from PayPal's receipt email" maxLength={24} required />
      </label>
      <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Checking…' : `Claim up to ${rules.maxPointsPerClaim} ${wallet.unit.name}`}</button>
      {message.text && <p role="status" className={`rounded-lg border px-3 py-2 text-xs ${message.kind === 'ok' ? 'border-mint/30 bg-mint/5 text-mint' : 'border-danger/30 bg-danger/5 text-danger'}`}>{message.text}</p>}
      <p className="text-xs leading-snug text-muted">
        You earn {rules.pointsPerUsd} point per $1 (at least {rules.minPoints}, at most {rules.maxPointsPerClaim}). Self-reported: Buypal cannot see retailer orders, so claims are checked for format, limited to {rules.maxClaimsPerDay} a day, and each PayPal transaction counts once. Verifying them automatically needs retailer or PayPal partner data.
      </p>
    </form>
  );
}

export default function WalletDrawer({ open, onClose, wallet, prefill, onWallet }) {
  const refresh = () => api.wallet().then(onWallet).catch(() => {});
  useEffect(() => { if (open) refresh(); }, [open]);

  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-navy/40" onClick={onClose} />}
      <aside aria-label="Your wallet" aria-hidden={!open}
        className={`fixed right-0 top-0 z-40 flex h-full w-full max-w-lg flex-col bg-paper shadow-[-20px_0_60px_-30px_rgba(10,31,77,0.4)] transition-transform duration-300 ${open ? 'translate-x-0' : 'invisible translate-x-full'}`}>
        <div className="flex items-start justify-between border-b border-rule px-6 py-5">
          <div>
            <p className="eyebrow">Your wallet</p>
            <h2 className="display text-2xl font-semibold text-navy">{wallet?.unit.name || 'Points'}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close wallet" className="rounded-lg p-1.5 text-muted hover:bg-mist hover:text-navy"><IconClose size={22} /></button>
        </div>

        {open && wallet && (
          <div className="scroll-thin flex-1 space-y-7 overflow-y-auto p-6">
            <section className="rounded-xl bg-navy p-5 text-white">
              <p className="text-xs font-semibold uppercase tracking-wide text-sky">Balance</p>
              <p className="num display mt-1 text-5xl font-semibold leading-none">{wallet.balance}</p>
              <p className="mt-2 text-[13px] text-white/75">A search costs {wallet.costs.search}. A complete setup costs {wallet.costs.setup}. Points have no cash value.</p>
            </section>

            <section>
              <h3 className="display text-lg font-semibold text-navy">Earn points with PayPal</h3>
              <p className="mt-1 text-[13px] text-muted">Buypal rewards shoppers who pay with PayPal. There are two ways to earn.</p>

              <div className="mt-4 rounded-xl border border-rule p-4">
                <p className="text-[13px] font-semibold text-navy">1. Paid with PayPal at a retailer</p>
                <p className="mb-3 mt-0.5 text-[13px] text-muted">Chose PayPal at checkout on a store we linked you to? Claim your reward.</p>
                <Claim wallet={wallet} prefill={prefill} onClaimed={onWallet} />
              </div>

              <div className="mt-4 rounded-xl border border-rule p-4">
                <p className="text-[13px] font-semibold text-navy">2. Top up with PayPal</p>
                <p className="mb-3 mt-0.5 text-[13px] text-muted">Instant, and verified by PayPal.</p>
                <TopUp wallet={wallet} onCredited={() => refresh()} />
              </div>
            </section>

            <section>
              <h3 className="display text-lg font-semibold text-navy">History</h3>
              <ul className="mt-2 divide-y divide-rule rounded-xl border border-rule">
                {wallet.ledger.map((entry) => (
                  <li key={entry.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]">
                    <span className="min-w-0"><span className="block font-medium text-navy">{REASON_LABEL[entry.reason] || entry.reason}</span><span className="block truncate text-xs text-muted">{entry.note || entry.createdAt}</span></span>
                    <b className={`num flex-none ${entry.delta > 0 ? 'text-mint' : 'text-navy'}`}>{entry.delta > 0 ? '+' : ''}{entry.delta}</b>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}
      </aside>
    </>
  );
}
