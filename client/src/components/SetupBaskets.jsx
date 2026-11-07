import { useState } from 'react';
import { api, inr, money } from '../api.js';
import { BUCKETS } from '../buckets.js';
import { BudgetBar, Notes } from './Blocks.jsx';

const COLORS = { Smart: BUCKETS.Smart.color, Premium: BUCKETS.Premium.color, Budget: BUCKETS.Budget.color };

export default function SetupBaskets({ block, onOpen, onUseAsCart }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const use = async (basket) => {
    setBusy(basket.id);
    setError('');
    try {
      const cart = await api.selectSetup(basket.items.map((i) => ({ productId: i.product.id, role: i.role, quantity: i.quantity })), basket.keys[0], block.goal, block.budget);
      onUseAsCart(cart);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  return (
    <section className="mt-4 animate-rise">
      <Notes notes={block.notes} />
      <details className="card mb-4 px-4 py-3 text-[13px]" open>
        <summary className="cursor-pointer list-none font-semibold text-navy">Why these setups, in this order</summary>
        <ul className="mt-2 space-y-1 leading-snug text-muted">{block.plan.lines.map((l) => <li key={l}>{l}</li>)}</ul>
      </details>
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {block.baskets.map((basket) => (
          <article key={basket.id} className="card flex flex-col overflow-hidden">
            <div className="flex items-center gap-2 border-b border-rule px-5 py-3">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: COLORS[basket.keys[0]] || '#5b6785' }} />
              <span className="text-[13px] font-semibold text-navy">{basket.label}</span>
            </div>
            <div className="flex flex-1 flex-col p-5">
              <p className="num display text-4xl font-semibold leading-none text-navy">{money(basket.total)}</p>
              <p className="mt-1 text-xs text-muted">{inr(basket.total)}</p>
              <div className="mt-3"><BudgetBar total={basket.total} budget={block.budget} /></div>
              <p className="mt-3 text-[13px] leading-snug text-muted">{basket.blurb}</p>
              <ul className="mt-4 divide-y divide-rule border-y border-rule text-[13px]">
                {basket.items.map((item) => (
                  <li key={item.product.id} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="min-w-0">
                      <span className="block text-[11px] font-semibold uppercase tracking-wide text-muted">{item.role}{item.quantity > 1 ? ` × ${item.quantity}` : ''}</span>
                      <span className="block truncate font-medium text-navy">{item.product.name}</span>
                      <span className="block text-xs text-muted">{item.product.merchant || 'Retailer'}</span>
                    </span>
                    <b className="num flex-none font-semibold text-navy">{money(item.product.price * item.quantity)}</b>
                  </li>
                ))}
              </ul>
              <div className="mt-auto grid grid-cols-2 gap-2 pt-5">
                <button type="button" className="btn btn-primary" onClick={() => onOpen(basket)}>Open basket</button>
                <button type="button" className="btn btn-outline" disabled={busy === basket.id} onClick={() => use(basket)}>{busy === basket.id ? '…' : 'Use as cart'}</button>
              </div>
            </div>
          </article>
        ))}
      </div>
      {error && <p className="mt-3 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">{error}</p>}
    </section>
  );
}
