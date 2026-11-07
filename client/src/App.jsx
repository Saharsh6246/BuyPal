import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, setInrRate } from './api.js';
import { CartBlock, Recommendations } from './components/Blocks.jsx';
import CartDrawer from './components/CartDrawer.jsx';
import Home from './components/Home.jsx';
import ProfileDrawer from './components/ProfileDrawer.jsx';

const EMPTY_CART = { items: [], count: 0, total: 0, budget: null, currency: 'USD' };

function Typing() {
  return (
    <div className="flex items-center gap-1.5 py-2" aria-label="Buypal is looking">
      {[0, 1, 2].map((i) => <span key={i} className="h-1.5 w-1.5 animate-bounce bg-brass" style={{ animationDelay: `${i * 0.15}s` }} />)}
      <span className="ml-2 text-xs italic text-muted">Comparing listings…</span>
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
  const [checkoutSignal, setCheckoutSignal] = useState(0);
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

  const buyNow = () => { setDrawer('cart'); setCheckoutSignal((n) => n + 1); };
  const newChat = async () => { await api.clearHistory(); setMessages([]); setHome(null); };
  const cartIds = useMemo(() => new Set(cart.items.map((i) => i.id)), [cart]);
  const ai = config?.ai;

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-ink bg-canvas">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <button type="button" onClick={newChat} className="serif text-[34px] font-semibold leading-none tracking-tight" aria-label="Buypal, start over">Buypal</button>
          <nav className="flex items-center gap-5 text-[11.5px] font-semibold uppercase tracking-[0.14em]">
            {ai && <span className="hidden font-medium normal-case tracking-normal text-muted md:inline" title="Buypal stops calling the AI model at this daily limit, so it can never bill you.">{ai.enabled ? `AI ${ai.calls}/${ai.limit} today` : 'Basic mode'}</span>}
            {!showingHome && <button type="button" onClick={newChat} className="text-muted hover:text-ink">Home</button>}
            <button type="button" onClick={() => setDrawer('profile')} className="text-muted hover:text-ink">Profile</button>
            <button type="button" onClick={() => setDrawer('cart')} className="hover:text-bottle">Cart{cart.count > 0 && <span className="ml-1.5 bg-ink px-1.5 py-0.5 text-[10px] text-canvas">{cart.count}</span>}</button>
          </nav>
        </div>
        <div className="border-t border-rule" />
      </header>

      <main className="scroll-thin flex-1 overflow-y-auto">
        {showingHome ? (
          <Home home={home} loading={homeLoading} priority={priority} onPriority={choosePriority} cartIds={cartIds} onCart={setCart}
            onSearch={send} rejectReasons={config?.rejectReasons} />
        ) : (
          <div className="mx-auto w-full max-w-6xl px-4 pb-8 pt-8 sm:px-6">
            <div className="space-y-8">
              {messages.map((m, index) => (
                <div key={index} className={m.role === 'user' ? 'flex justify-end' : ''}>
                  {m.role === 'user' ? (
                    <p className="serif max-w-[85%] border border-rule bg-paper px-4 py-2.5 text-[19px] italic animate-rise">{m.content}</p>
                  ) : (
                    <div className="animate-rise">
                      <div className="max-w-2xl border-l-2 border-brass pl-4 text-[15.5px] leading-relaxed">{m.content}</div>
                      {m.notice && <p className="mt-2 max-w-2xl pl-4 text-xs italic text-muted">{m.notice}</p>}
                      {m.blocks?.map((block, i) => {
                        if (block.type === 'recommendations') return <Recommendations key={i} block={block} cartIds={cartIds} onCart={setCart} onBuyNow={buyNow} rejectReasons={config?.rejectReasons} />;
                        if (block.type === 'setup') return <CartBlock key={i} block={block} title="Your proposed setup" onOpenCart={() => setDrawer('cart')} />;
                        if (block.type === 'cart') return <CartBlock key={i} block={block} onOpenCart={() => setDrawer('cart')} />;
                        return null;
                      })}
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

      {(!showingHome || loading) && (
        <footer className="border-t border-rule bg-canvas px-4 py-3 sm:px-6">
          <div className="mx-auto max-w-3xl">
            {error && <p className="mb-2 border-l-2 border-wine bg-paper px-3 py-2 text-xs text-wine" role="alert">{error}</p>}
            <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="field flex items-end gap-2 p-1.5">
              <label htmlFor="chat-input" className="sr-only">Message Buypal</label>
              <textarea id="chat-input" rows={1} value={input} onChange={(e) => setInput(e.target.value)} maxLength={1000}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
                placeholder="Refine, ask a question, or search for something else"
                className="max-h-32 min-h-[44px] flex-1 resize-none bg-transparent px-3 py-3 text-[15px] outline-none placeholder:text-muted/70" />
              <button type="submit" disabled={loading || input.trim().length < 2} className="btn btn-primary">Send</button>
            </form>
            <p className="mt-1.5 text-center text-[11px] text-muted">Buypal shows only what listings state. Prices and availability can change at the retailer.</p>
          </div>
        </footer>
      )}
      {showingHome && error && <p className="fixed bottom-4 left-1/2 -translate-x-1/2 border-l-2 border-wine bg-paper px-4 py-2 text-xs text-wine" role="alert">{error}</p>}

      <CartDrawer open={drawer === 'cart'} onClose={() => setDrawer(null)} cart={cart} setCart={setCart} orders={orders} refreshOrders={refreshOrders} checkoutSignal={checkoutSignal} />
      <ProfileDrawer open={drawer === 'profile'} onClose={() => setDrawer(null)} priority={priority} onPriority={choosePriority} onReset={() => setHome(null)} />
    </div>
  );
}
