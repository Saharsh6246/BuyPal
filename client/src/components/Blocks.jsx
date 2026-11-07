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
        <span className={over ? 'font-semibold text-rose-700' : 'font-semibold text-forest'}>{over ? `${money(total - budget)} over` : `${money(budget - total)} left`}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line">
        <div className={`h-full rounded-full ${over ? 'bg-rose-500' : 'bg-forest'}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function Recommendations({ block, cartIds, onCart, rejectReasons }) {
  return (
    <section className="mt-3 animate-rise">
      {block.notes.length > 0 && (
        <ul className="mb-3 space-y-1 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[12.5px] text-amber-900">
          {block.notes.map((note) => <li key={note}>ⓘ {note}</li>)}
        </ul>
      )}
      {block.cards.length === 0 ? (
        block.cheapest && (
          <p className="text-sm text-muted">The cheapest listing found was “{block.cheapest.name}” at {money(block.cheapest.price)}.</p>
        )
      ) : (
        <>
          <p className="mb-2 text-xs text-muted">
            Compared {block.stats.considered} listings ({block.stats.eligible} met your requirements)
            {block.profileUsed?.dominant ? ` · tuned to your usual ${block.profileUsed.dominant} picks` : ''}
          </p>
          <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
            {block.cards.map((card) => (
              <ProductCard key={card.product.id} card={card} category={block.category} inCart={cartIds.has(card.product.id)}
                onAdded={onCart} rejectReasons={rejectReasons} />
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
    <section className="mt-3 animate-rise rounded-2xl border border-line bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="font-display text-sm font-extrabold">{title || 'Your cart'}</h3>
        <button type="button" onClick={onOpenCart} className="rounded-full bg-ink px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-forest">Review &amp; checkout →</button>
      </div>
      <ul className="divide-y divide-line">
        {cart.items.map((item) => (
          <li key={item.id} className="flex items-center gap-3 py-2.5">
            <div className="flex h-12 w-12 flex-none items-center justify-center rounded-lg bg-canvas">
              {item.product.image ? <img src={item.product.image} alt="" className="max-h-full max-w-full object-contain mix-blend-multiply" /> : null}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10.5px] font-semibold uppercase tracking-wide text-muted">{item.role || 'Item'}</p>
              <p className="truncate text-[13px] font-semibold">{item.product.name}</p>
              {block.reasons?.[item.id] && <p className="truncate text-[11.5px] text-muted">{block.reasons[item.id]}</p>}
            </div>
            <div className="text-right text-[13px]">
              <p className="font-bold">{money(item.lineTotal)}</p>
              {item.quantity > 1 && <p className="text-[11px] text-muted">{item.quantity} × {money(item.product.price)}</p>}
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-3 space-y-2 border-t border-line pt-3">
        <div className="flex items-baseline justify-between"><span className="text-sm text-muted">Total</span><b className="font-display text-lg">{money(cart.total)}</b></div>
        <BudgetBar total={cart.total} budget={cart.budget} />
        {block.verified && (
          <p className={`text-xs font-semibold ${block.verified.ok ? 'text-forest' : 'text-rose-700'}`}>
            {block.verified.ok ? '✓' : '✕'} Verified: total {money(block.verified.total)} {block.verified.ok ? 'meets' : 'does not meet'} your target of {money(block.verified.target)}
          </p>
        )}
        {block.change && <p className="text-xs text-muted">{block.change}</p>}
        {block.notes?.map((note) => <p key={note} className="text-xs text-amber-800">ⓘ {note}</p>)}
        {block.converted && <p className="text-xs text-muted">Budget converted to USD at an approximate rate.</p>}
      </div>
    </section>
  );
}
