import { useState } from 'react';
import { api, inr, money } from '../api.js';
import { bucketOf } from '../buckets.js';
import { IconCheck, IconExternal, IconStar } from './icons.jsx';

const isLink = (url) => /^https?:\/\//.test(url || '');

export function DemoBadge() {
  return <span title="Simulated prices and ratings from the demo store feed. Not a real retailer listing." className="rounded-md border border-amber/40 bg-amber/10 px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-amber">Demo data</span>;
}

export function OfferList({ product }) {
  const offers = (product.offers || []).filter((o) => o.merchant);
  if (offers.length < 2) return null;
  return (
    <details className="group text-[13px]">
      <summary className="cursor-pointer list-none font-semibold text-azure hover:underline">Compare {offers.length} stores</summary>
      <ul className="mt-2 divide-y divide-rule overflow-hidden rounded-lg border border-rule">
        {offers.map((offer, index) => (
          <li key={`${offer.merchant}-${index}`} className="flex items-center justify-between gap-3 bg-paper px-3 py-2">
            <span className="min-w-0 truncate">{offer.merchant}{index === 0 && <span className="ml-2 rounded bg-mint/10 px-1.5 py-0.5 text-[10.5px] font-semibold text-mint">Lowest</span>}</span>
            <span className="flex flex-none items-center gap-3">
              <b className="num font-semibold text-navy">{money(offer.price)}</b>
              {isLink(offer.url) && <a href={offer.url} target="_blank" rel="noopener noreferrer" className="link text-xs">View</a>}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

export default function ProductCard({ card, category, inCart, onAdded, rejectReasons }) {
  const { product } = card;
  const bucket = bucketOf(card);
  const strategy = card.strategies[0];
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [askReason, setAskReason] = useState(false);
  const [error, setError] = useState('');
  const [imageFailed, setImageFailed] = useState(false);

  const add = async () => {
    setBusy(true);
    setError('');
    try { onAdded(await api.addToCart(product.id, strategy, category)); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const send = async (payload, message) => {
    try {
      await api.feedback({ productId: product.id, strategy, category, ...payload });
      setFeedback(message);
      setAskReason(false);
    } catch (e) { setError(e.message); }
  };
  // Opening the retailer page counts as choosing this card, so the baskets learn from it.
  const clicked = () => { api.feedback({ type: 'click', productId: product.id, strategy, category }).catch(() => {}); };

  const discount = product.compareAtPrice ? Math.round((1 - product.price / product.compareAtPrice) * 100) : 0;
  const retailerLink = isLink(product.buyUrl);

  return (
    <article className="card flex flex-col overflow-hidden animate-rise">
      <div className="flex items-center justify-between gap-2 border-b border-rule px-4 py-2.5">
        <span className="inline-flex items-center gap-2 text-[13px] font-semibold text-navy">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: bucket.color }} />{card.label}
        </span>
        {product.demo && <DemoBadge />}
      </div>

      <div className="flex h-48 items-center justify-center border-b border-rule bg-paper p-4">
        {product.image && !imageFailed
          ? <img src={product.image} alt={product.name} loading="lazy" className="max-h-full max-w-full object-contain" onError={() => setImageFailed(true)} />
          : <span className="text-xs text-muted">Image unavailable</span>}
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div>
          {product.brand && <p className="text-xs font-semibold uppercase tracking-wide text-muted">{product.brand}</p>}
          <h3 className="display line-clamp-2 text-[18px] font-medium leading-snug text-navy">{product.name}</h3>
        </div>

        <div className="num flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="display text-[28px] font-semibold leading-none text-navy">{money(product.price)}</span>
          <span className="text-xs text-muted">{inr(product.price)}</span>
          {discount >= 5 && <span className="text-xs"><s className="text-muted">{money(product.compareAtPrice)}</s> <b className="rounded bg-mint/10 px-1.5 py-0.5 text-mint">{discount}% off</b></span>}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
          {product.rating
            ? <span className="inline-flex items-center gap-1 font-semibold text-navy"><IconStar className="text-amber" size={14} />{product.rating.value}<span className="font-normal text-muted">({product.rating.count.toLocaleString()})</span></span>
            : <span>No ratings listed</span>}
          <span>{product.merchant || 'Retailer not listed'}</span>
        </div>

        <OfferList product={product} />

        {product.specChips.length > 0
          ? <div className="flex flex-wrap gap-1.5">{product.specChips.map((chip) => <span key={chip} className="rounded-md bg-mist px-2 py-0.5 text-xs font-medium text-navy">{chip}</span>)}</div>
          : product.features?.length > 0 && <p className="text-[12.5px] leading-snug text-muted">{[...(product.attributes || []), ...product.features].slice(0, 4).join(' · ')}</p>}

        <div className="rounded-lg bg-mist p-3 text-[13px] leading-relaxed text-ink">
          <span className="font-semibold text-navy">Why this pick. </span>{card.position}
        </div>

        {(card.pros.length > 0 || card.cons.length > 0 || card.matches.length > 0) && (
          <details className="text-[13px]">
            <summary className="cursor-pointer list-none font-semibold text-azure hover:underline">Pros, cons and fit</summary>
            <div className="mt-2 space-y-2">
              {card.matches.length > 0 && <ul className="space-y-1 text-mint">{card.matches.map((m) => <li key={m} className="flex gap-1.5"><IconCheck size={15} className="mt-0.5 flex-none" />{m}</li>)}</ul>}
              <div className="grid grid-cols-2 gap-x-4">
                <ul className="space-y-1">{card.pros.map((p) => <li key={p} className="flex gap-1.5"><span className="font-bold text-mint">+</span>{p}</li>)}</ul>
                <ul className="space-y-1 text-muted">{card.cons.map((c) => <li key={c} className="flex gap-1.5"><span className="font-bold text-danger">−</span>{c}</li>)}</ul>
              </div>
            </div>
          </details>
        )}

        <div className="mt-auto space-y-2.5 pt-1">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {retailerLink
              ? <a href={product.buyUrl} target="_blank" rel="noopener noreferrer" onClick={clicked} className="btn btn-primary">Buy at {product.merchant || 'retailer'} <IconExternal size={16} /></a>
              : <span className="btn btn-outline !cursor-default !border-dashed !text-muted">No retailer page</span>}
            <button type="button" className="btn btn-outline" disabled={busy || inCart} onClick={add}>{inCart ? 'In cart' : busy ? 'Adding…' : 'Add to cart'}</button>
          </div>
          <div className="flex items-center justify-between text-[13px]">
            <span className="text-xs text-muted">{product.demo ? 'Simulated listing' : `via ${product.source || 'retailer'}`}</span>
            {feedback ? <span className="font-medium text-mint">{feedback}</span> : (
              <span className="flex gap-4 text-muted">
                <button type="button" className="hover:text-navy" onClick={() => send({ type: 'like' }, 'Noted, thank you')}>Like</button>
                <button type="button" className="hover:text-navy" onClick={() => setAskReason((v) => !v)}>Not for me</button>
              </span>
            )}
          </div>
          {askReason && (
            <div className="rounded-lg border border-rule bg-canvas p-3 text-[13px]">
              <p className="mb-2 font-semibold text-navy">What put you off?</p>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(rejectReasons || {}).map(([key, label]) => (
                  <button key={key} type="button" onClick={() => send({ type: 'reject', reason: key }, 'Understood, noted')} className="chip transition hover:border-azure hover:text-azure">{label}</button>
                ))}
              </div>
            </div>
          )}
          {error && <p className="text-xs text-danger">{error}</p>}
        </div>
      </div>
    </article>
  );
}
