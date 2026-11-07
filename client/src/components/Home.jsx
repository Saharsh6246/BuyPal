import { useState } from 'react';
import { api, inr, money } from '../api.js';
import { BUCKETS } from '../buckets.js';
import { IconArrowRight, IconSearch, IconShield } from './icons.jsx';
import { DemoBadge } from './ProductCard.jsx';
import { useWallet } from '../wallet.jsx';
import { IconCoin } from './icons.jsx';
import PriorityPicker from './PriorityPicker.jsx';

const EXAMPLES = [
  'A lightweight laptop for college under ₹60,000',
  'A 20W phone charger from a store I can trust',
  'Salted butter 500 g, best price',
  'Build me a high quality yet affordable gaming setup under ₹1,00,000',
];

function Tile({ item, inCart, onAdded, onSearch }) {
  const { product } = item;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const add = async () => {
    setBusy(true);
    setError('');
    try { onAdded(await api.addToCart(product.id, null, item.category)); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const stores = (product.offers || []).length;
  return (
    <article className="card flex flex-col overflow-hidden animate-rise">
      <div className="relative flex h-44 items-center justify-center border-b border-rule bg-paper p-4">
        {product.image ? <img src={product.image} alt={product.name} loading="lazy" className="max-h-full max-w-full object-contain" /> : <span className="text-xs text-muted">Image unavailable</span>}
        <span className="chip absolute left-3 top-3">{item.label}</span>
        {product.demo && <span className="absolute right-3 top-3"><DemoBadge /></span>}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <h3 className="display line-clamp-2 text-[17px] font-medium leading-snug text-navy">{product.name}</h3>
        <p className="num flex items-baseline gap-2"><span className="display text-2xl font-semibold text-navy">{money(product.price)}</span><span className="text-xs text-muted">{inr(product.price)}</span>{product.compareAtPrice && <s className="text-xs text-muted">{money(product.compareAtPrice)}</s>}</p>
        <p className="text-[12.5px] leading-snug text-muted">{item.reason}</p>
        <p className="text-xs text-muted">{product.merchant || 'Retailer not listed'}{stores > 1 ? ` · ${stores} stores` : ''}</p>
        <div className="mt-auto flex items-center justify-between pt-3">
          <button type="button" className="link text-[13px]" onClick={() => onSearch(item.category)}>Compare options</button>
          <button type="button" className="btn btn-outline !px-3 !py-1.5 !text-[13px]" disabled={busy || inCart} onClick={add}>{inCart ? 'In cart' : busy ? '…' : 'Add'}</button>
        </div>
        {error && <p className="text-xs text-danger">{error}</p>}
      </div>
    </article>
  );
}

export default function Home({ home, loading, priority, onPriority, cartIds, onCart, onSearch }) {
  const [draft, setDraft] = useState('');
  const { wallet, openWallet } = useWallet();
  const submit = (e) => { e.preventDefault(); if (draft.trim().length >= 2) onSearch(draft); };

  return (
    <div className="pb-20">
      <section className="border-b border-rule bg-paper">
        <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1.15fr_0.85fr] lg:py-20">
          <div className="animate-rise">
            <p className="eyebrow">Personal shopping agent</p>
            <h1 className="display mt-3 text-[40px] font-semibold leading-[1.06] text-navy sm:text-6xl">Find the best version of anything you want to buy.</h1>
            <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-muted">Describe it in your own words. Buypal compares stores, explains every pick, and arranges the options around how you shop. You finish the purchase at the retailer you choose.</p>
            <form onSubmit={submit} className="field mt-8 flex max-w-2xl items-center gap-2 p-1.5 pl-4">
              <IconSearch size={20} className="flex-none text-muted" />
              <label htmlFor="home-search" className="sr-only">What would you like to buy?</label>
              <input id="home-search" value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={1000} autoComplete="off"
                placeholder="Describe what you need, e.g. organic honey 250 g" className="min-w-0 flex-1 bg-transparent px-1 py-3 text-[16px] outline-none placeholder:text-muted/70" />
              <button type="submit" className="btn btn-primary !py-3" disabled={draft.trim().length < 2}>Search</button>
            </form>
            {wallet && (
              <p className="mt-4 flex max-w-2xl items-center gap-2 text-[13.5px] text-muted"><IconCoin size={18} className="flex-none text-azure" />You have <b className="num text-navy">{wallet.balance} {wallet.unit.name}</b>. A search costs {wallet.costs.search}. Earn more by paying with PayPal. <button type="button" className="link" onClick={() => openWallet()}>Open wallet</button></p>
            )}
            <div className="mt-4 flex max-w-2xl flex-wrap gap-2">
              {EXAMPLES.map((example) => (
                <button key={example} type="button" onClick={() => onSearch(example)} className="chip !font-medium !text-muted transition hover:border-azure hover:!text-azure">{example}</button>
              ))}
            </div>
          </div>

          <aside className="card p-6 shadow-[0_8px_30px_-12px_rgba(10,31,77,0.18)]" aria-label="How Buypal ranks products">
            <p className="eyebrow">How Buypal chooses</p>
            <h2 className="display mt-1 text-2xl font-semibold text-navy">Six ways to decide</h2>
            <ul className="mt-4 divide-y divide-rule">
              {Object.values(BUCKETS).map((b) => (
                <li key={b.label} className="flex items-start gap-3 py-3">
                  <span className="mt-1.5 h-2.5 w-2.5 flex-none rounded-full" style={{ background: b.color }} />
                  <span><span className="block text-[14.5px] font-semibold text-navy">{b.label}</span><span className="block text-[13px] leading-snug text-muted">{b.blurb}</span></span>
                </li>
              ))}
            </ul>
            <p className="mt-3 flex items-start gap-2 border-t border-rule pt-3 text-xs leading-snug text-muted"><IconShield size={16} className="mt-0.5 flex-none text-mint" />Ranked by transparent rules on real listing data. The AI explains the results but never ranks products or touches payments.</p>
          </aside>
        </div>
      </section>

      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <section className="mt-10">
          {priority ? (
            <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
              <div><p className="eyebrow">Your priority</p><p className="display text-xl font-semibold text-navy">What matters most to you</p></div>
              <PriorityPicker variant="segmented" value={priority} onChange={onPriority} />
            </div>
          ) : (
            <div className="card p-6">
              <p className="eyebrow">Before you begin</p>
              <h2 className="display mt-1 text-2xl font-semibold text-navy">What matters most to you?</h2>
              <p className="mb-4 mt-1 text-[14px] text-muted">Buypal leads with this every time. You can change it whenever you like.</p>
              <PriorityPicker value={priority} onChange={onPriority} />
            </div>
          )}
        </section>

        {home?.recent?.length > 0 && (
          <section className="mt-8">
            <p className="eyebrow !text-muted">Continue where you left off</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {home.recent.map((q) => <button key={q} type="button" onClick={() => onSearch(q)} className="chip transition hover:border-azure hover:text-azure">{q}</button>)}
            </div>
          </section>
        )}

        {loading && !home && (
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4" aria-label="Loading recommendations">
            {[0, 1, 2, 3].map((i) => <div key={i} className="card h-72 animate-pulse bg-mist" />)}
          </div>
        )}
        {home?.sections.map((section) => (
          <section key={section.id} className="mt-12">
            <div className="mb-5 flex items-end justify-between gap-4">
              <div>
                <h2 className="display text-2xl font-semibold text-navy sm:text-[28px]">{section.title}</h2>
                <p className="mt-1 text-[14px] text-muted">{section.subtitle}</p>
              </div>
              <IconArrowRight size={20} className="hidden text-rule-strong sm:block" />
            </div>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {section.items.map((item) => <Tile key={`${section.id}-${item.product.id}`} item={item} inCart={cartIds.has(item.product.id)} onAdded={onCart} onSearch={onSearch} />)}
            </div>
          </section>
        ))}
        {home && home.sections.length === 0 && !loading && <p className="mt-12 text-center text-muted">Recommendations will appear here once you search for something.</p>}
      </div>

      <footer className="mx-auto mt-20 max-w-7xl border-t border-rule px-4 pt-6 text-xs leading-relaxed text-muted sm:px-6">
        Prices and availability are shown as listed by the retailer and can change. Buypal compares and recommends; you complete purchases at the retailer. The in-app checkout is a PayPal Sandbox demonstration: no real money moves and no retailer order is created.
      </footer>
    </div>
  );
}
