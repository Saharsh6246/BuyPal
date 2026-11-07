import { money } from '../api.js';
import ProductCard from './ProductCard.jsx';

export function BudgetBar({ total, budget }) {
  if (budget == null) return null;
  const pct = Math.min(100, Math.round((total / budget) * 100));
  const over = total > budget + 0.005;
  return (
    <div>
      <div className="flex justify-between text-xs text-muted">
        <span>{money(total)} of {money(budget)} budget</span>
        <span className={over ? 'font-semibold text-wine' : 'font-semibold text-sage'}>{over ? `${money(total - budget)} over` : `${money(budget - total)} remaining`}</span>
      </div>
      <div className="mt-1.5 h-[3px] bg-rule">
        <div className={`h-full ${over ? 'bg-wine' : 'bg-bottle'}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function Recommendations({ block, cartIds, onCart, onBuyNow, rejectReasons }) {
  return (
    <section className="mt-5 animate-rise">
      {block.notes.length > 0 && (
        <ul className="mb-4 space-y-1 border-l-2 border-brass bg-paper px-4 py-3 text-[13px] text-muted">
          {block.notes.map((note) => <li key={note}>{note}</li>)}
        </ul>
      )}
      {block.cards.length === 0 ? (
        block.cheapest && <p className="text-sm text-muted">The cheapest listing found was “{block.cheapest.name}” at {money(block.cheapest.price)}.</p>
      ) : (
        <>
          <p className="eyebrow mb-3 !text-muted">
            {block.stats.considered} listings compared · {block.stats.eligible} met your requirements
          </p>
          {block.basketPlan && (
            <div className="mb-4 border border-rule bg-paper p-4">
              <p className="eyebrow">Why these baskets, in this order</p>
              <ol className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[13px]">
                {block.basketPlan.order.map((b, i) => <li key={b.basket}><span className="text-brass">{i + 1}.</span> <b>{b.label}</b></li>)}
              </ol>
              <ul className="mt-2 space-y-1 text-[13px] leading-snug text-muted">
                {block.basketPlan.lines.map((line) => <li key={line}>{line}</li>)}
              </ul>
            </div>
          )}
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {block.cards.map((card) => (
              <ProductCard key={card.product.id} card={card} category={block.category} inCart={cartIds.has(card.product.id)}
                onAdded={onCart} onBuyNow={onBuyNow} rejectReasons={rejectReasons} />
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
    <section className="mt-5 max-w-3xl animate-rise border border-rule bg-paper p-5">
      <div className="mb-3 flex items-center justify-between gap-2 border-b border-rule pb-3">
        <h3 className="serif text-2xl font-semibold">{title || 'Your cart'}</h3>
        <button type="button" onClick={onOpenCart} className="btn btn-primary !py-2">Review &amp; checkout</button>
      </div>
      <ul className="divide-y divide-rule">
        {cart.items.map((item) => (
          <li key={item.id} className="flex items-center gap-4 py-3">
            <div className="flex h-14 w-14 flex-none items-center justify-center border border-rule bg-white">
              {item.product.image ? <img src={item.product.image} alt="" className="max-h-full max-w-full object-contain" /> : null}
            </div>
            <div className="min-w-0 flex-1">
              <p className="eyebrow !text-muted">{item.role || 'Item'}</p>
              <p className="truncate text-[14px] font-semibold">{item.product.name}</p>
              {block.reasons?.[item.id] && <p className="truncate text-[12px] text-muted">{block.reasons[item.id]}</p>}
            </div>
            <div className="text-right">
              <p className="serif text-xl font-semibold">{money(item.lineTotal)}</p>
              {item.quantity > 1 && <p className="text-[11px] text-muted">{item.quantity} × {money(item.product.price)}</p>}
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-3 space-y-2 border-t border-rule pt-3">
        <div className="flex items-baseline justify-between"><span className="eyebrow !text-muted">Total</span><b className="serif text-3xl font-semibold">{money(cart.total)}</b></div>
        <BudgetBar total={cart.total} budget={cart.budget} />
        {block.verified && (
          <p className={`text-xs font-semibold ${block.verified.ok ? 'text-sage' : 'text-wine'}`}>
            {block.verified.ok ? 'Verified' : 'Not met'}: total {money(block.verified.total)} against your target of {money(block.verified.target)}
          </p>
        )}
        {block.change && <p className="text-[13px] text-muted">{block.change}</p>}
        {block.notes?.map((note) => <p key={note} className="text-xs text-brass">{note}</p>)}
        {block.converted && <p className="text-xs text-muted">Budget converted to USD at an approximate rate.</p>}
      </div>
    </section>
  );
}
