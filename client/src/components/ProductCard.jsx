import { useState } from 'react';
import { api, money } from '../api.js';

const ACCENT = { Budget: 'border-t-bottle text-bottle', Smart: 'border-t-brass text-brass', Premium: 'border-t-ink text-ink', 'Top rated': 'border-t-sage text-sage', Stretch: 'border-t-wine text-wine' };
const accent = (card) => ACCENT[card.strategies[0].replace(' alt', '')] || 'border-t-muted text-muted';

export function OfferList({ product }) {
  const offers = product.offers || [];
  if (offers.length < 2) return null;
  return (
    <details className="group text-[12.5px]">
      <summary className="cursor-pointer list-none text-muted hover:text-ink">
        <span className="link">Compare {offers.length} retailers</span>
      </summary>
      <ul className="mt-2 divide-y divide-rule border border-rule bg-paper">
        {offers.map((offer, index) => (
          <li key={`${offer.merchant}-${index}`} className="flex items-center justify-between gap-3 px-3 py-2">
            <span className="truncate">{offer.merchant || 'Retailer'}{index === 0 && <span className="ml-2 text-[10px] font-semibold uppercase tracking-widest text-bottle">Lowest</span>}</span>
            <span className="flex flex-none items-center gap-3">
              <b className="serif text-[17px]">{money(offer.price)}</b>
              {/^https?:\/\//.test(offer.url) && <a href={offer.url} target="_blank" rel="noopener noreferrer" className="link text-[11.5px]">View</a>}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

export default function ProductCard({ card, category, inCart, onAdded, onBuyNow, rejectReasons }) {
  const { product } = card;
  const strategy = card.strategies[0];
  const [busy, setBusy] = useState('');
  const [feedback, setFeedback] = useState('');
  const [askReason, setAskReason] = useState(false);
  const [error, setError] = useState('');
  const [imageFailed, setImageFailed] = useState(false);

  const add = async (buyNow) => {
    setBusy(buyNow ? 'buy' : 'add');
    setError('');
    try {
      const cart = inCart ? null : await api.addToCart(product.id, strategy, category);
      if (cart) onAdded(cart);
      if (buyNow) onBuyNow(cart);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  const send = async (payload, message) => {
    try {
      await api.feedback({ productId: product.id, strategy, category, ...payload });
      setFeedback(message);
      setAskReason(false);
    } catch (e) {
      setError(e.message);
    }
  };

  const discount = product.compareAtPrice ? Math.round((1 - product.price / product.compareAtPrice) * 100) : 0;

  return (
    <article className={`flex flex-col border border-rule border-t-[3px] bg-paper animate-rise ${accent(card)}`}>
      <div className="flex items-center justify-between px-4 pt-3">
        <span className="eyebrow !text-inherit">{card.label}</span>
        {product.rating && <span className="text-[12px] text-muted">{product.rating.value} / 5 · {product.rating.count}</span>}
      </div>
      <div className="mx-4 mt-3 flex h-44 items-center justify-center border border-rule bg-white p-3">
        {product.image && !imageFailed
          ? <img src={product.image} alt={product.name} loading="lazy" className="max-h-full max-w-full object-contain" onError={() => setImageFailed(true)} />
          : <span className="text-xs text-muted">Image unavailable</span>}
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4 text-ink">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">{product.brand || 'Brand not listed'}</p>
          <h3 className="serif mt-0.5 line-clamp-2 text-[19px] font-semibold leading-tight">{product.name}</h3>
        </div>
        <div className="flex items-baseline gap-3">
          <span className="serif text-3xl font-semibold">{money(product.price)}</span>
          {discount >= 5 && <span className="text-xs text-muted"><s>{money(product.compareAtPrice)}</s> <b className="text-bottle">{discount}% off</b></span>}
        </div>
        <p className="text-[12px] text-muted">
          {product.merchant || 'Retailer not listed'}
          {product.availability ? ` · ${product.availability.replace(/([a-z])([A-Z])/g, '$1 $2')}` : ''}
          {!product.rating && ' · No ratings listed'}
        </p>
        <OfferList product={product} />
        {product.specChips.length > 0
          ? <p className="border-y border-rule py-2 text-[12.5px] leading-relaxed">{product.specChips.join('  ·  ')}</p>
          : <p className="border-y border-rule py-2 text-[12.5px] italic text-muted">Specifications not listed by the retailer</p>}

        <p className="text-[13px] leading-relaxed"><span className="serif text-[15px] font-semibold italic">Why this one. </span>{card.position}</p>
        {card.matches.length > 0 && <ul className="space-y-0.5 text-[12.5px] text-sage">{card.matches.map((m) => <li key={m}>— {m}</li>)}</ul>}
        {(card.pros.length > 0 || card.cons.length > 0) && (
          <div className="grid grid-cols-2 gap-x-4 text-[12.5px] leading-snug">
            <ul className="space-y-1">{card.pros.map((p) => <li key={p}><b className="text-sage">+</b> {p}</li>)}</ul>
            <ul className="space-y-1 text-muted">{card.cons.map((c) => <li key={c}><b className="text-wine">−</b> {c}</li>)}</ul>
          </div>
        )}

        <div className="mt-auto space-y-2 pt-1">
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => add(true)}>{busy === 'buy' ? 'One moment…' : 'Buy now'}</button>
            <button type="button" className="btn btn-outline" disabled={!!busy || inCart} onClick={() => add(false)}>{inCart ? 'In cart' : busy === 'add' ? 'Adding…' : 'Add to cart'}</button>
          </div>
          <div className="flex items-center justify-between text-[12px]">
            {product.buyUrl && /^https?:\/\//.test(product.buyUrl) ? <a href={product.buyUrl} target="_blank" rel="noopener noreferrer" className="link">View at retailer</a> : <span className="text-muted">Retailer link unavailable</span>}
            {feedback ? <span className="text-sage">{feedback}</span> : (
              <span className="flex gap-4 text-muted">
                <button type="button" className="hover:text-ink" onClick={() => send({ type: 'like' }, 'Noted, thank you')}>Like</button>
                <button type="button" className="hover:text-ink" onClick={() => setAskReason((v) => !v)}>Not for me</button>
              </span>
            )}
          </div>
          {askReason && (
            <div className="border border-rule bg-canvas p-2.5 text-[12px]">
              <p className="mb-1.5 font-semibold">What put you off?</p>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(rejectReasons || {}).map(([key, label]) => (
                  <button key={key} type="button" onClick={() => send({ type: 'reject', reason: key }, 'Understood, noted')} className="border border-rule bg-paper px-2.5 py-1 hover:border-ink">{label}</button>
                ))}
              </div>
            </div>
          )}
          {error && <p className="text-xs text-wine">{error}</p>}
          <p className="text-[10.5px] uppercase tracking-wider text-muted">
            Price verified · Rating {card.verified.rating ? 'verified' : 'not listed'} · Specs {card.verified.specs ? 'from listing' : 'not listed'}
          </p>
        </div>
      </div>
    </article>
  );
}
