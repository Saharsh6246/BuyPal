import { money } from '../api.js';
import ProductCard from './ProductCard.jsx';

export function BudgetBar({ total, budget }) {
  if (budget == null) return null;
  const pct = Math.min(100, Math.round((total / budget) * 100));
  const over = total > budget + 0.005;
  return (
    <div>
      <div className="flex justify-between text-xs text-muted">
        <span className="num">{money(total)} of {money(budget)} budget</span>
        <span className={`num font-semibold ${over ? 'text-danger' : 'text-mint'}`}>{over ? `${money(total - budget)} over` : `${money(budget - total)} remaining`}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-rule">
        <div className={`h-full rounded-full ${over ? 'bg-danger' : 'bg-azure'}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function OutOfPoints({ block, onOpenWallet }) {
  return (
    <section className="card mt-4 flex max-w-3xl flex-col gap-3 border-azure/30 bg-azure/5 p-5 animate-rise sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h3 className="display text-lg font-semibold text-navy">You are out of {block.unit}</h3>
        <p className="mt-0.5 text-[13.5px] text-muted">This needs {block.needed} and you have {block.balance}. Pay with PayPal to earn more: top up instantly, or claim a PayPal checkout you made at a retailer.</p>
      </div>
      <button type="button" onClick={onOpenWallet} className="btn btn-primary flex-none">Open wallet</button>
    </section>
  );
}

export function Notes({ notes }) {
  if (!notes?.length) return null;
  return <ul className="mb-4 space-y-1 rounded-lg border border-amber/30 bg-amber/5 px-4 py-3 text-[13px] text-amber">{notes.map((n) => <li key={n}>{n}</li>)}</ul>;
}

export function Recommendations({ block, cartIds, onCart, rejectReasons }) {
  return (
    <section className="mt-4 animate-rise">
      <Notes notes={block.notes} />
      {block.cards.length === 0 ? (
        block.cheapest && <p className="text-sm text-muted">The cheapest listing found was “{block.cheapest.name}” at {money(block.cheapest.price)}.</p>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[13px] text-muted"><b className="text-navy">{block.stats.considered}</b> listings compared · <b className="text-navy">{block.stats.eligible}</b> met your requirements</p>
          </div>
          {block.basketPlan && (
            <details className="card mb-4 px-4 py-3 text-[13px]">
              <summary className="cursor-pointer list-none font-semibold text-navy">Why these cards, in this order <span className="font-normal text-azure">· details</span></summary>
              <ul className="mt-2 space-y-1 leading-snug text-muted">{block.basketPlan.lines.map((line) => <li key={line}>{line}</li>)}</ul>
            </details>
          )}
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {block.cards.map((card) => (
              <ProductCard key={card.product.id} card={card} category={block.category} inCart={cartIds.has(card.product.id)} onAdded={onCart} rejectReasons={rejectReasons} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

export function CartBlock({ block, onOpenCart, title }) {
  const { cart } = block;
  return (
    <section className="card mt-4 max-w-3xl p-5 animate-rise">
      <div className="mb-3 flex items-center justify-between gap-2 border-b border-rule pb-3">
        <h3 className="display text-xl font-semibold text-navy">{title || 'Your cart'}</h3>
        <button type="button" onClick={onOpenCart} className="btn btn-primary !py-2">Review cart</button>
      </div>
      <ul className="divide-y divide-rule">
        {cart.items.map((item) => (
          <li key={item.id} className="flex items-center gap-4 py-3">
            <div className="flex h-14 w-14 flex-none items-center justify-center rounded-lg border border-rule bg-paper">
              {item.product.image ? <img src={item.product.image} alt="" className="max-h-full max-w-full object-contain" /> : null}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">{item.role || 'Item'}</p>
              <p className="truncate text-[14px] font-semibold text-navy">{item.product.name}</p>
              {block.reasons?.[item.id] && <p className="truncate text-xs text-muted">{block.reasons[item.id]}</p>}
            </div>
            <div className="num text-right">
              <p className="display text-lg font-semibold text-navy">{money(item.lineTotal)}</p>
              {item.quantity > 1 && <p className="text-[11px] text-muted">{item.quantity} × {money(item.product.price)}</p>}
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-3 space-y-2 border-t border-rule pt-3">
        <div className="flex items-baseline justify-between"><span className="text-sm text-muted">Total</span><b className="display num text-2xl font-semibold text-navy">{money(cart.total)}</b></div>
        <BudgetBar total={cart.total} budget={cart.budget} />
        {block.verified && (
          <p className={`text-xs font-semibold ${block.verified.ok ? 'text-mint' : 'text-danger'}`}>
            {block.verified.ok ? 'Verified' : 'Not met'}: total {money(block.verified.total)} against your target of {money(block.verified.target)}
          </p>
        )}
        {block.change && <p className="text-[13px] text-muted">{block.change}</p>}
        {block.notes?.map((note) => <p key={note} className="text-xs text-amber">{note}</p>)}
        {block.converted && <p className="text-xs text-muted">Budget converted to USD at an approximate rate.</p>}
      </div>
    </section>
  );
}
