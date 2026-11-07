import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, setInrRate } from './api.js';
import BasketDrawer from './components/BasketDrawer.jsx';
import { CartBlock, OutOfPoints, Recommendations } from './components/Blocks.jsx';
import CartDrawer from './components/CartDrawer.jsx';
import Header from './components/Header.jsx';
import Home from './components/Home.jsx';
import { LogoMark } from './components/Logo.jsx';
import ProfileDrawer from './components/ProfileDrawer.jsx';
import SetupBaskets from './components/SetupBaskets.jsx';
import WalletDrawer from './components/WalletDrawer.jsx';
import { WalletContext } from './wallet.jsx';

const EMPTY_CART = { items: [], count: 0, total: 0, budget: null, currency: 'USD' };

function Typing() {
  return (
    <div className="flex items-center gap-3 text-sm text-muted" aria-label="Buypal is comparing stores">
      <LogoMark size={28} />
      <span className="flex items-center gap-1.5">
        {[0, 1, 2].map((i) => <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-azure" style={{ animationDelay: `${i * 0.15}s` }} />)}
        <span className="ml-2">Comparing stores…</span>
      </span>
    </div>
  );
}

export default function App() {
  const [config, setConfig] = useState(null);
  const [messages, setMessages] = useState([]);
  const [cart, setCart] = useState(EMPTY_CART);
  const [orders, setOrders] = useState([]);
  const [priority, setPriority] = useState(null);
  const [home, setHome] = useState(null);
  const [homeLoading, setHomeLoading] = useState(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [drawer, setDrawer] = useState(null);
  const [basketView, setBasketView] = useState(null);
  const [wallet, setWallet] = useState(null);
  const [claimPrefill, setClaimPrefill] = useState(null);
  const [error, setError] = useState('');
  const bottomRef = useRef(null);

  const refreshOrders = useCallback(() => api.orders().then((d) => setOrders(d.orders)).catch(() => {}), []);
  const loadHome = useCallback(() => {
    setHomeLoading(true);
    api.home().then((h) => { setHome(h); setPriority(h.priority); }).catch(() => {}).finally(() => setHomeLoading(false));
  }, []);

  useEffect(() => {
    api.config().then((c) => { setInrRate(c.inrPerUsd); setConfig(c); }).catch(() => setError('Cannot reach the Buypal server. Is it running?'));
    api.me().then((m) => setPriority(m.priority)).catch(() => {});
    api.history().then((d) => setMessages(d.messages)).catch(() => {});
    api.cart().then(setCart).catch(() => {});
    api.wallet().then(setWallet).catch(() => {});
    refreshOrders();
  }, [refreshOrders]);

  const showingHome = messages.length === 0;
  useEffect(() => { if (showingHome) loadHome(); }, [showingHome, loadHome]);
  useEffect(() => { if (!showingHome) bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages, loading, showingHome]);

  const send = async (text) => {
    const message = String(text).trim();
    if (message.length < 2 || loading) return;
    setInput('');
    setError('');
    setMessages((m) => [...m, { role: 'user', content: message, blocks: [] }]);
    setLoading(true);
    try {
      const res = await api.chat(message);
      setMessages((m) => [...m, { role: 'assistant', content: res.reply, blocks: res.blocks, notice: res.notice }]);
      setCart(res.cart);
      if (res.wallet) setWallet((w) => (w ? { ...w, balance: res.wallet.balance } : w));
      setConfig((c) => (c ? { ...c, ai: res.usage } : c));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const choosePriority = async (value) => {
    setPriority(value);
    try { await api.setPriority(value); setHome(null); if (showingHome) loadHome(); } catch (e) { setError(e.message); }
  };
  const openWallet = (prefill = null) => { setClaimPrefill(prefill); setDrawer('wallet'); };
  const startOver = async () => { await api.clearHistory(); setMessages([]); setHome(null); };
  const cartIds = useMemo(() => new Set(cart.items.map((i) => i.id)), [cart]);

  return (
    <WalletContext.Provider value={{ wallet, openWallet }}>
    <div className="flex h-full flex-col">
      <Header ai={config?.ai} wallet={wallet} onWallet={() => openWallet()} cartCount={cart.count} showHome={showingHome} onHome={startOver} onProfile={() => setDrawer('profile')} onCart={() => setDrawer('cart')} />

      <main className="scroll-thin flex-1 overflow-y-auto">
        {showingHome ? (
          <Home home={home} loading={homeLoading} priority={priority} onPriority={choosePriority} cartIds={cartIds} onCart={setCart} onSearch={send} />
        ) : (
          <div className="mx-auto w-full max-w-7xl px-4 pb-8 pt-8 sm:px-6">
            <div className="space-y-8">
              {messages.map((m, index) => (
                <div key={index} className={m.role === 'user' ? 'flex justify-end' : ''}>
                  {m.role === 'user' ? (
                    <p className="max-w-[85%] rounded-2xl rounded-br-md bg-navy px-4 py-2.5 text-[15px] text-white animate-rise sm:max-w-xl">{m.content}</p>
                  ) : (
                    <div className="flex gap-3 animate-rise">
                      <div className="mt-0.5"><LogoMark size={28} /></div>
                      <div className="min-w-0 flex-1">
                        <div className="card max-w-3xl px-4 py-3 text-[15px] leading-relaxed">{m.content}</div>
                        {m.notice && <p className="mt-2 max-w-3xl text-xs text-muted">{m.notice}</p>}
                        {m.blocks?.map((block, i) => {
                          if (block.type === 'recommendations') return <Recommendations key={i} block={block} cartIds={cartIds} onCart={setCart} rejectReasons={config?.rejectReasons} />;
                          if (block.type === 'setupBaskets') return <SetupBaskets key={i} block={block} onOpen={(basket) => setBasketView({ basket, block })} onUseAsCart={(c) => { setCart(c); setDrawer('cart'); }} />;
                          if (block.type === 'outOfPoints') return <OutOfPoints key={i} block={block} onOpenWallet={() => openWallet()} />;
                          if (block.type === 'setup') return <CartBlock key={i} block={block} title="Your proposed setup" onOpenCart={() => setDrawer('cart')} />;
                          if (block.type === 'cart') return <CartBlock key={i} block={block} onOpenCart={() => setDrawer('cart')} />;
                          return null;
                        })}
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {loading && <Typing />}
              <div ref={bottomRef} />
            </div>
          </div>
        )}
      </main>

      {!showingHome && (
        <footer className="border-t border-rule bg-paper px-4 py-3 sm:px-6">
          <div className="mx-auto max-w-3xl">
            {error && <p className="mb-2 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger" role="alert">{error}</p>}
            <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="field flex items-end gap-2 p-1.5">
              <label htmlFor="chat-input" className="sr-only">Message Buypal</label>
              <textarea id="chat-input" rows={1} value={input} onChange={(e) => setInput(e.target.value)} maxLength={1000}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
                placeholder="Ask a follow-up or search again"
                className="max-h-32 min-h-[44px] flex-1 resize-none overflow-hidden bg-transparent px-3 py-3 text-[15px] outline-none placeholder:text-muted/70" />
              <button type="submit" disabled={loading || input.trim().length < 2} className="btn btn-primary !py-3">Send</button>
            </form>
            <p className="mt-1.5 text-center text-[11px] text-muted">Buypal shows only what listings state. Prices and availability can change at the retailer.{wallet && ` A search costs ${wallet.costs.search} ${wallet.unit.name}; you have ${wallet.balance}.`}</p>
          </div>
        </footer>
      )}
      {showingHome && error && <p className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-lg border border-danger/30 bg-paper px-4 py-2 text-xs text-danger shadow" role="alert">{error}</p>}

      <CartDrawer open={drawer === 'cart'} onClose={() => setDrawer(null)} cart={cart} setCart={setCart} orders={orders} refreshOrders={refreshOrders} />
      <BasketDrawer view={basketView} onClose={() => setBasketView(null)} />
      <WalletDrawer open={drawer === 'wallet'} onClose={() => setDrawer(null)} wallet={wallet} prefill={claimPrefill} onWallet={setWallet} />
      <ProfileDrawer open={drawer === 'profile'} onClose={() => setDrawer(null)} priority={priority} onPriority={choosePriority} onReset={() => setHome(null)} />
    </div>
    </WalletContext.Provider>
  );
}
