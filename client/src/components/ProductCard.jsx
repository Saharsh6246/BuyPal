import { useState } from 'react';
import { api, money } from '../api.js';

const BADGE = {
  Budget: 'bg-lime text-forest',
  Smart: 'bg-forest text-white',
  Premium: 'bg-ink text-white',
  'Top rated': 'bg-amber-100 text-amber-900',
  Stretch: 'bg-rose-100 text-rose-900',
};
const badgeClass = (label) => BADGE[label.split(' · ')[0].replace(' alt', '')] || 'bg-line text-ink';

function Placeholder() {
  return <span className="text-xs text-muted">Image unavailable</span>;
}

export default function ProductCard({ card, category, inCart, onAdded, rejectReasons }) {
  const { product } = card;
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [askReason, setAskReason] = useState(false);
  const [error, setError] = useState('');
  const [imageFailed, setImageFailed] = useState(false);

  const add = async () => {
    setBusy(true);
    setError('');
    try {
      const cart = await api.addToCart(product.id, card.label, category);
      onAdded(cart);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const send = async (payload, message) => {
    try {
      await api.feedback({ productId: product.id, strategy: card.label, category, ...payload });
      setFeedback(message);
      setAskReason(false);
    } catch (e) {
      setError(e.message);
    }
  };

  const discount = product.compareAtPrice ? Math.round((1 - product.price / product.compareAtPrice) * 100) : 0;

  return (
    <article className="flex flex-col overflow-hidden rounded-2xl border border-line bg-white shadow-[0_1px_0_rgba(0,0,0,0.02)] animate-rise">
      <div className={`px-3.5 py-2 text-[11px] font-bold uppercase tracking-wider ${badgeClass(card.label)}`}>{card.label}</div>
      <div className="flex h-44 items-center justify-center bg-canvas p-3">
        {product.image && !imageFailed ? (
          <img src={product.image} alt={product.name} loading="lazy" className="max-h-full max-w-full object-contain mix-blend-multiply" onError={() => setImageFailed(true)} />
        ) : <Placeholder />}
      </div>
      <div className="flex flex-1 flex-col gap-2.5 p-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{product.brand || 'Brand not listed'}</p>
          <h3 className="mt-0.5 line-clamp-2 font-display text-[15px] font-bold leading-snug">{product.name}</h3>
        </div>
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-display text-xl font-extrabold">{money(product.price)}</span>
          {discount >= 5 && (
            <span className="text-xs text-muted"><s>{money(product.compareAtPrice)}</s> <b className="text-forest">−{discount}%</b></span>
          )}
        </div>
        <p className="text-xs text-muted">
          {product.rating ? `★ ${product.rating.value}/5 · ${product.rating.count} reviews` : 'No ratings listed'}
          {' · '}{product.merchant || 'Retailer not listed'}
          {product.availability ? ` · ${product.availability.replace(/([a-z])([A-Z])/g, '$1 $2')}` : ''}
        </p>
        {product.specChips.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {product.specChips.map((chip) => <span key={chip} className="rounded-full bg-canvas px-2 py-0.5 text-[11px] font-medium text-ink">{chip}</span>)}
          </div>
        ) : <p className="text-xs italic text-muted">Specs not listed by the retailer</p>}

        <div className="rounded-xl bg-lime/25 p-2.5 text-[12.5px] leading-snug text-forest">
          <b>Why Buypal picked it.</b> {card.position}
        </div>
        {card.matches.length > 0 && (
          <ul className="space-y-0.5 text-[12px] text-ink">
            {card.matches.map((m) => <li key={m}><span className="text-forest">✓</span> {m}</li>)}
          </ul>
        )}
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
          <ul className="space-y-0.5">{card.pros.map((p) => <li key={p} className="text-ink"><span className="font-bold text-forest">+</span> {p}</li>)}</ul>
          <ul className="space-y-0.5">{card.cons.map((c) => <li key={c} className="text-muted"><span className="font-bold text-amber-600">−</span> {c}</li>)}</ul>
        </div>

        <div className="mt-auto flex flex-col gap-2 pt-1">
          <button type="button" onClick={add} disabled={busy || inCart}
            className="rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-forest disabled:bg-line disabled:text-muted">
            {inCart ? 'In your cart ✓' : busy ? 'Adding…' : 'Add to cart'}
          </button>
          <div className="flex items-center justify-between text-[12px]">
            {product.buyUrl && /^https?:\/\//.test(product.buyUrl)
              ? <a href={product.buyUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-forest underline-offset-2 hover:underline">View at retailer ↗</a>
              : <span className="text-muted">Retailer link unavailable</span>}
            {feedback ? <span className="text-forest">{feedback}</span> : (
              <span className="flex gap-3">
                <button type="button" className="text-muted hover:text-ink" onClick={() => send({ type: 'like' }, 'Thanks, noted ♡')}>♡ Like</button>
                <button type="button" className="text-muted hover:text-ink" onClick={() => setAskReason((v) => !v)}>Not for me</button>
              </span>
            )}
          </div>
          {askReason && (
            <div className="rounded-xl border border-line bg-canvas p-2 text-[12px]">
              <p className="mb-1 font-semibold">Why isn’t it right?</p>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(rejectReasons || {}).map(([key, label]) => (
                  <button key={key} type="button" onClick={() => send({ type: 'reject', reason: key }, 'Got it, I’ll remember')}
                    className="rounded-full border border-line bg-white px-2.5 py-1 hover:border-ink">{label}</button>
                ))}
              </div>
            </div>
          )}
          {error && <p className="text-xs text-rose-700">{error}</p>}
          <p className="text-[10.5px] text-muted">
            Price {card.verified.price ? '✓' : '—'} · Rating {card.verified.rating ? '✓' : 'not listed'} · Specs {card.verified.specs ? '✓' : 'not listed'} · from Channel3 listings
          </p>
        </div>
      </div>
    </article>
  );
}
