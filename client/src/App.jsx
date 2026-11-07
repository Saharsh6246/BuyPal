import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { CartBlock, Recommendations } from './components/Blocks.jsx';
import CartDrawer from './components/CartDrawer.jsx';
import ProfileDrawer from './components/ProfileDrawer.jsx';

const EXAMPLES = [
  'Lightweight laptop for college under ₹60,000',
  'Gaming laptop under $900 with a good display',
  'Build me a complete gaming setup under ₹1,00,000',
  'A wireless mouse under $30',
];

const EMPTY_CART = { items: [], count: 0, total: 0, budget: null, currency: 'USD' };

function Typing() {
  return (
    <div className="flex items-center gap-1.5 rounded-2xl bg-white px-4 py-3 shadow-sm" aria-label="Buypal is thinking">
      {[0, 1, 2].map((i) => <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted" style={{ animationDelay: `${i * 0.15}s` }} />)}
    </div>
  );
}

export default function App() {
  const [config, setConfig] = useState(null);
  const [messages, setMessages] = useState([]);
  const [cart, setCart] = useState(EMPTY_CART);
  const [orders, setOrders] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [drawer, setDrawer] = useState(null);
  const [error, setError] = useState('');
  const bottomRef = useRef(null);

  const refreshOrders = useCallback(() => api.orders().then((d) => setOrders(d.orders)).catch(() => {}), []);

  useEffect(() => {
    api.config().then(setConfig).catch(() => setError('Cannot reach the Buypal server. Is it running?'));
    api.history().then((d) => setMessages(d.messages)).catch(() => {});
    api.cart().then(setCart).catch(() => {});
    refreshOrders();
  }, [refreshOrders]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages, loading]);

  const send = async (text) => {
    const message = text.trim();
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

  const cartIds = useMemo(() => new Set(cart.items.map((i) => i.id)), [cart]);
  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); }
  };
  const clearChat = async () => { await api.clearHistory(); setMessages([]); };
  const ai = config?.ai;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-line bg-canvas/90 px-4 py-3 backdrop-blur sm:px-6">
        <a href="/" className="flex items-center gap-2 font-display text-lg font-extrabold" aria-label="Buypal home">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-lime text-forest">b</span>buypal
        </a>
        <div className="flex items-center gap-2 sm:gap-3">
          {ai && (
            <span className="hidden text-[11px] text-muted sm:inline" title="Buypal stops calling the AI model at this daily limit, so it can never bill you.">
              {ai.enabled ? `AI calls today ${ai.calls}/${ai.limit}` : 'AI: basic mode'}
            </span>
          )}
          {messages.length > 0 && <button type="button" onClick={clearChat} className="hidden text-xs text-muted hover:text-ink sm:inline">New chat</button>}
          <button type="button" onClick={() => setDrawer('cart')} className="relative rounded-full border border-line bg-white px-4 py-1.5 text-sm font-semibold hover:border-ink">
            Cart{cart.count > 0 && <span className="ml-1.5 rounded-full bg-ink px-1.5 py-0.5 text-[11px] text-white">{cart.count}</span>}
          </button>
          <button type="button" onClick={() => setDrawer('profile')} aria-label="Shopping preferences" className="flex h-9 w-9 items-center justify-center rounded-full bg-forest text-sm font-bold text-white">♥</button>
        </div>
      </header>

      <main className="scroll-thin flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl px-4 pb-6 pt-6 sm:px-6">
          {messages.length === 0 && (
            <section className="mx-auto max-w-2xl pt-8 text-center animate-rise">
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-forest">✳ Your personal shopping agent</p>
              <h1 className="mt-3 font-display text-4xl font-extrabold leading-tight sm:text-5xl">What are you shopping for today?</h1>
              <p className="mt-3 text-muted">Tell me what you need, your budget and what matters. I’ll search real listings, explain my picks and build your cart.</p>
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                {EXAMPLES.map((example) => (
                  <button key={example} type="button" onClick={() => send(example)}
                    className="rounded-full border border-line bg-white px-4 py-2 text-sm hover:border-ink">{example}</button>
                ))}
              </div>
              <p className="mt-6 text-xs text-muted">Checkout uses PayPal Sandbox: a safe test payment. Buypal never places a real retailer order.</p>
            </section>
          )}

          <div className="space-y-5">
            {messages.map((m, index) => (
              <div key={index} className={m.role === 'user' ? 'flex justify-end' : ''}>
                {m.role === 'user' ? (
                  <p className="max-w-[85%] rounded-2xl rounded-br-md bg-ink px-4 py-2.5 text-sm text-white animate-rise">{m.content}</p>
                ) : (
                  <div className="max-w-full animate-rise">
                    <div className="max-w-2xl rounded-2xl rounded-bl-md bg-white px-4 py-3 text-[14.5px] leading-relaxed shadow-sm">{m.content}</div>
                    {m.notice && <p className="mt-1.5 max-w-2xl text-xs text-amber-800">ⓘ {m.notice}</p>}
                    {m.blocks?.map((block, i) => {
                      if (block.type === 'recommendations') return <Recommendations key={i} block={block} cartIds={cartIds} onCart={setCart} rejectReasons={config?.rejectReasons} />;
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
      </main>

      <footer className="border-t border-line bg-canvas px-4 py-3 sm:px-6">
        <div className="mx-auto max-w-3xl">
          {error && <p className="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800" role="alert">{error}</p>}
          <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="flex items-end gap-2 rounded-2xl border border-line bg-white p-2 shadow-sm focus-within:border-ink">
            <label htmlFor="chat-input" className="sr-only">Message Buypal</label>
            <textarea id="chat-input" rows={1} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onKey} maxLength={1000}
              placeholder="Try “laptop for college under ₹80,000, good battery life”"
              className="max-h-32 min-h-[40px] flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-muted" />
            <button type="submit" disabled={loading || input.trim().length < 2}
              className="rounded-xl bg-lime px-4 py-2.5 text-sm font-bold text-forest transition hover:brightness-95 disabled:opacity-50">Send →</button>
          </form>
          <p className="mt-1.5 text-center text-[11px] text-muted">Buypal shows only what listings state. Prices and availability can change at the retailer.</p>
        </div>
      </footer>

      <CartDrawer open={drawer === 'cart'} onClose={() => setDrawer(null)} cart={cart} setCart={setCart} orders={orders} refreshOrders={refreshOrders} />
      <ProfileDrawer open={drawer === 'profile'} onClose={() => setDrawer(null)} />
    </div>
  );
}
