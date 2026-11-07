import { useState } from 'react';
import { api, money } from '../api.js';
import PriorityPicker from './PriorityPicker.jsx';

const EXAMPLES = [
  'A lightweight laptop for college under ₹60,000',
  'A gaming laptop under $900 with a good display',
  'Build me a complete gaming setup under ₹1,00,000',
  'A wireless mouse under $30',
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
  const offers = (product.offers || []).length;
  return (
    <article className="flex flex-col border border-rule bg-paper animate-rise">
      <div className="flex h-40 items-center justify-center border-b border-rule bg-white p-3">
        {product.image ? <img src={product.image} alt={product.name} loading="lazy" className="max-h-full max-w-full object-contain" /> : <span className="text-xs text-muted">Image unavailable</span>}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <p className="eyebrow">{item.label}</p>
        <h3 className="serif line-clamp-2 text-[19px] font-semibold leading-tight">{product.name}</h3>
        <p className="serif text-2xl font-semibold">{money(product.price)} {product.compareAtPrice && <s className="ml-1 text-sm font-normal text-muted">{money(product.compareAtPrice)}</s>}</p>
        <p className="text-[12px] leading-snug text-muted">{item.reason}</p>
        <p className="text-[11.5px] text-muted">{product.merchant || 'Retailer not listed'}{offers > 1 ? ` · ${offers} retailers` : ''}</p>
        <div className="mt-auto flex items-center justify-between pt-3 text-[12px]">
          <button type="button" className="link" onClick={() => onSearch(`best ${item.category}`)}>Find the best {item.category}</button>
          <button type="button" className="btn btn-outline !px-3 !py-1.5" disabled={busy || inCart} onClick={add}>{inCart ? 'In cart' : busy ? '…' : 'Add'}</button>
        </div>
        {error && <p className="text-xs text-wine">{error}</p>}
      </div>
    </article>
  );
}

export default function Home({ home, loading, priority, onPriority, cartIds, onCart, onSearch, rejectReasons }) {
  const [draft, setDraft] = useState('');
  const submit = (e) => { e.preventDefault(); if (draft.trim().length >= 2) onSearch(draft); };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-10 sm:px-6">
      <section className="mx-auto max-w-3xl text-center animate-rise">
        <p className="eyebrow">Your personal shopping desk</p>
        <h1 className="serif mt-3 text-5xl font-semibold leading-[1.05] sm:text-7xl">What shall we find<br className="hidden sm:block" /> for you today?</h1>
        <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-muted">Name anything you would like to buy. Buypal compares real listings across retailers and presents the best on price, the best on quality, and the best overall, led by what matters to you.</p>
        <form onSubmit={submit} className="field mx-auto mt-8 flex max-w-2xl items-center gap-2 p-1.5">
          <label htmlFor="home-search" className="sr-only">What would you like to buy?</label>
          <input id="home-search" value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={1000} autoComplete="off"
            placeholder="A laptop for college under ₹80,000 with good battery life" className="min-w-0 flex-1 bg-transparent px-3 py-3 text-[15px] outline-none placeholder:text-muted/70" />
          <button type="submit" className="btn btn-primary" disabled={draft.trim().length < 2}>Search</button>
        </form>
        <ul className="mx-auto mt-5 max-w-2xl space-y-1 text-left text-[13.5px]">
          {EXAMPLES.map((example) => (
            <li key={example}><button type="button" onClick={() => onSearch(example)} className="group flex w-full items-center justify-between border-b border-rule py-2 text-muted transition hover:text-ink"><span>{example}</span><span className="text-brass transition group-hover:translate-x-0.5">→</span></button></li>
          ))}
        </ul>
      </section>

      <section className="mx-auto mt-12 max-w-4xl border-y border-rule py-8">
        {priority ? (
          <div className="flex flex-col items-center gap-3 text-center sm:flex-row sm:justify-between sm:text-left">
            <div><p className="eyebrow">What matters most to you</p><p className="serif text-2xl font-semibold">Your priority</p></div>
            <PriorityPicker variant="segmented" value={priority} onChange={onPriority} />
          </div>
        ) : (
          <div>
            <div className="mb-4 text-center"><p className="eyebrow">Before we begin</p><h2 className="serif text-4xl font-semibold">What matters most to you?</h2><p className="mt-1 text-[14px] text-muted">Buypal will lead with this every time. You can change it whenever you like.</p></div>
            <PriorityPicker value={priority} onChange={onPriority} />
          </div>
        )}
      </section>

      {home?.recent?.length > 0 && (
        <section className="mt-10">
          <p className="eyebrow mb-3 !text-muted">Continue where you left off</p>
          <div className="flex flex-wrap gap-2">
            {home.recent.map((q) => <button key={q} type="button" onClick={() => onSearch(q)} className="border border-rule bg-paper px-3 py-1.5 text-[13px] hover:border-ink">{q}</button>)}
          </div>
        </section>
      )}

      {loading && !home && (
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4" aria-label="Loading recommendations">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-72 animate-pulse border border-rule bg-paper" />)}
        </div>
      )}
      {home?.sections.map((section) => (
        <section key={section.id} className="mt-14">
          <div className="mb-5 border-b border-rule pb-3">
            <h2 className="serif text-4xl font-semibold">{section.title}</h2>
            <p className="mt-1 text-[13.5px] text-muted">{section.subtitle}</p>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {section.items.map((item) => <Tile key={`${section.id}-${item.product.id}`} item={item} inCart={cartIds.has(item.product.id)} onAdded={onCart} onSearch={onSearch} rejectReasons={rejectReasons} />)}
          </div>
        </section>
      ))}
      {home && home.sections.length === 0 && !loading && <p className="mt-12 text-center text-muted">Recommendations will appear here once you search for something.</p>}
    </div>
  );
}
