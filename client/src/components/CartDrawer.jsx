import { useEffect, useRef, useState } from 'react';
import { api, money } from '../api.js';
import { BudgetBar } from './Blocks.jsx';

const SDK_URL = 'https://www.sandbox.paypal.com/web-sdk/v6/core';

function loadSdk() {
  if (window.paypal?.createInstance) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let script = document.getElementById('paypal-sdk');
    if (!script) {
      script = document.createElement('script');
      script.id = 'paypal-sdk';
      script.src = SDK_URL;
      script.async = true;
      document.head.append(script);
    }
    script.addEventListener('load', () => (window.paypal?.createInstance ? resolve() : reject(new Error('PayPal SDK is unavailable'))), { once: true });
    script.addEventListener('error', () => reject(new Error('PayPal SDK failed to load')), { once: true });
  });
}

function Checkout({ cart, onPaid, onCartChanged }) {
  const [approved, setApproved] = useState(false);
  const [state, setState] = useState({ phase: 'loading', message: '' });
  const sessionRef = useRef(null);
  const buttonRef = useRef(null);
  const handlers = useRef({});
  handlers.current = { onPaid, onCartChanged };

  // Set up the PayPal Sandbox SDK once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const config = await api.config();
        if (!config.paypal.configured) return setState({ phase: 'unconfigured', message: 'PayPal Sandbox needs a Client ID and Secret in the server .env file.' });
        await loadSdk();
        const sdk = await window.paypal.createInstance({ clientId: config.paypal.clientId, components: ['paypal-payments'], pageType: 'cart' });
        const methods = await sdk.findEligibleMethods({ currencyCode: 'USD' });
        if (!methods.isEligible('paypal')) return setState({ phase: 'error', message: 'PayPal Sandbox checkout is not available for USD with these credentials.' });
        sessionRef.current = sdk.createPayPalOneTimePaymentSession({
          onApprove: async ({ orderId }) => {
            setState({ phase: 'working', message: 'Payment approved. Verifying it with PayPal…' });
            try {
              const receipt = await api.captureOrder(orderId);
              if (receipt.status === 'COMPLETED') handlers.current.onPaid(receipt);
              else setState({ phase: 'info', message: receipt.message || 'PayPal is still processing this Sandbox payment.' });
            } catch (e) {
              setState({ phase: 'error', message: e.message });
              handlers.current.onCartChanged();
            }
          },
          onCancel: () => setState({ phase: 'info', message: 'Checkout cancelled. Nothing was charged and your cart is unchanged.' }),
          onError: () => setState({ phase: 'error', message: 'PayPal could not complete checkout. Nothing was charged.' }),
        });
        if (!cancelled) setState({ phase: 'ready', message: '' });
      } catch (e) {
        if (!cancelled) setState({ phase: 'error', message: 'Could not load PayPal Sandbox checkout. Check your connection and credentials.' });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const start = async () => {
    if (!sessionRef.current || !approved) return;
    setState({ phase: 'working', message: 'Verifying prices and preparing your Sandbox payment…' });
    try {
      const orderPromise = api.createOrder().then((order) => ({ orderId: order.orderId }));
      await sessionRef.current.start({ presentationMode: 'auto' }, orderPromise);
      setState((s) => (s.phase === 'working' && s.message.startsWith('Verifying prices') ? { phase: 'ready', message: '' } : s));
    } catch (e) {
      setState({ phase: 'error', message: e.message || 'Could not start PayPal checkout.' });
      if (e.data?.cart) handlers.current.onCartChanged();
    }
  };

  // <paypal-button> is a custom element: attach the click listener by hand.
  useEffect(() => {
    const el = buttonRef.current;
    if (!el) return undefined;
    const click = () => start();
    el.addEventListener('click', click);
    return () => el.removeEventListener('click', click);
  });

  const busy = state.phase === 'working' || state.phase === 'loading';
  return (
    <div className="space-y-3 border border-rule bg-canvas p-4">
      <h3 className="display text-2xl font-semibold">Review &amp; pay</h3>
      <ul className="space-y-1 text-[12.5px]">
        {cart.items.map((i) => <li key={i.id} className="flex justify-between gap-3"><span className="truncate">{i.quantity} × {i.product.name}</span><span className="flex-none font-semibold">{money(i.lineTotal)}</span></li>)}
      </ul>
      <div className="flex items-baseline justify-between border-t border-rule pt-2"><span className="eyebrow !text-muted">Total payable</span><span className="display text-3xl font-semibold">{money(cart.total)}</span></div>
      <p className="text-[11.5px] leading-snug text-muted">
        PayPal Sandbox demo. Your payment goes to Buypal’s test merchant, no real money moves, and no retailer order or delivery is created. Prices are re-checked with the retailer data right before the payment is created.
      </p>
      <label className="flex items-start gap-2 text-[12.5px]">
        <input type="checkbox" checked={approved} onChange={(e) => setApproved(e.target.checked)} className="mt-0.5 accent-azure" />
        <span>I’ve reviewed this order and approve paying {money(cart.total)} in PayPal Sandbox.</span>
      </label>
      <div className={approved && state.phase === 'ready' ? '' : 'pointer-events-none opacity-40'}>
        {state.phase === 'unconfigured' || state.phase === 'loading' ? null : <paypal-button ref={buttonRef} type="pay" />}
      </div>
      {state.message && (
        <p role="status" className={`border-l-2 px-3 py-2 text-xs ${state.phase === 'error' ? 'border-danger bg-paper text-danger' : state.phase === 'unconfigured' ? 'border-azure bg-paper text-azure' : 'border-azure bg-paper text-ink'}`}>{state.message}</p>
      )}
      {busy && !state.message && <p className="text-xs text-muted">Loading PayPal…</p>}
    </div>
  );
}

export default function CartDrawer({ open, onClose, cart, setCart, orders, refreshOrders, checkoutSignal }) {
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState(null);
  const [checkout, setCheckout] = useState(false);

  useEffect(() => { if (!cart.items.length) setCheckout(false); }, [cart.items.length]);
  // "Buy now" opens the cart with the review-and-pay step already showing. Nothing is charged until the user approves in PayPal.
  useEffect(() => { if (checkoutSignal) { setReceipt(null); setCheckout(true); } }, [checkoutSignal]);

  const guard = async (fn) => {
    setError('');
    try { setCart(await fn()); } catch (e) { setError(e.message); }
  };

  const paid = async (r) => {
    setReceipt(r);
    setCheckout(false);
    setCart(await api.cart());
    refreshOrders();
  };

  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-navy/40" onClick={onClose} />}
      <aside aria-label="Shopping cart" aria-hidden={!open}
        className={`fixed right-0 top-0 z-40 flex h-full w-full max-w-md flex-col border-l border-rule bg-paper transition-transform duration-300 ${open ? 'translate-x-0' : 'invisible translate-x-full'}`}>
        <div className="flex items-start justify-between border-b border-rule p-5">
          <div>
            <p className="eyebrow">Your selection</p>
            <h2 className="display text-3xl font-semibold">Cart ({cart.count})</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close cart" className="text-2xl leading-none text-muted hover:text-ink">×</button>
        </div>
        <div className="scroll-thin flex-1 space-y-4 overflow-y-auto p-5">
          {receipt && (
            <div className="border border-azure bg-canvas p-4 text-sm text-azure" role="status">
              <p className="display text-2xl font-semibold">Sandbox payment complete</p>
              <p className="mt-1">{money(Number(receipt.amount))} {receipt.currency} · Order {receipt.orderId}</p>
              {receipt.captureId && <p className="text-xs">Capture {receipt.captureId}</p>}
              <p className="mt-1 text-xs">This was a PayPal Sandbox test. No retailer order was placed and nothing will be delivered.</p>
            </div>
          )}
          {cart.items.length === 0 ? (
            <div className="py-10 text-center text-muted"><p className="display text-2xl font-semibold text-ink">Your cart is empty</p><p className="text-sm">Ask Buypal for a product and add the picks you like.</p></div>
          ) : (
            <>
              <ul className="space-y-3">
                {cart.items.map((item) => (
                  <li key={item.id} className="flex gap-3">
                    <div className="flex h-16 w-16 flex-none items-center justify-center border border-rule bg-white">
                      {item.product.image ? <img src={item.product.image} alt="" className="max-h-full max-w-full object-contain" /> : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-[13px] font-semibold leading-snug">{item.product.name}</p>
                      <p className="text-[11.5px] text-muted">{item.product.merchant || 'Retailer not listed'} · {money(item.product.price)}</p>
                      <div className="mt-1.5 flex items-center justify-between">
                        <div className="flex items-center gap-2 border border-rule px-1 text-sm">
                          <button type="button" aria-label="Decrease quantity" disabled={item.quantity <= 1} className="h-6 w-6 disabled:opacity-30" onClick={() => guard(() => api.setQuantity(item.id, item.quantity - 1))}>−</button>
                          <span className="w-4 text-center text-[13px]">{item.quantity}</span>
                          <button type="button" aria-label="Increase quantity" disabled={item.quantity >= 10} className="h-6 w-6 disabled:opacity-30" onClick={() => guard(() => api.setQuantity(item.id, item.quantity + 1))}>+</button>
                        </div>
                        <b className="display text-xl font-semibold">{money(item.lineTotal)}</b>
                      </div>
                      <button type="button" className="mt-1 text-[11.5px] text-muted underline-offset-2 hover:underline" onClick={() => guard(() => api.removeItem(item.id))}>Remove</button>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="space-y-2 border-t border-rule pt-3">
                <div className="flex items-baseline justify-between"><span className="eyebrow !text-muted">Total</span><b className="display text-3xl font-semibold">{money(cart.total)}</b></div>
                <BudgetBar total={cart.total} budget={cart.budget} />
              </div>
              {!checkout ? (
                <button type="button" onClick={() => { setReceipt(null); setCheckout(true); }} className="btn btn-primary w-full">Review order &amp; checkout</button>
              ) : (
                <Checkout cart={cart} onPaid={paid} onCartChanged={async () => setCart(await api.cart())} />
              )}
            </>
          )}
          {error && <p className="border-l-2 border-danger bg-paper px-3 py-2 text-xs text-danger">{error}</p>}
          {orders.length > 0 && (
            <div className="border-t border-rule pt-4">
              <h3 className="display mb-2 text-2xl font-semibold">Order history</h3>
              <ul className="space-y-2 text-[12.5px]">
                {orders.map((o) => (
                  <li key={o.orderId} className="border border-rule bg-canvas p-3">
                    <div className="flex justify-between"><b className="display text-xl">{money(Number(o.amount))}</b><span className="text-muted">{o.status}</span></div>
                    <p className="truncate text-muted">{o.items.map((i) => i.name).join(', ')}</p>
                    <p className="text-[11px] text-muted">{o.createdAt} UTC · {o.orderId}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
