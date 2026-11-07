import { useState } from 'react';
import { api, inr, money } from '../api.js';
import { BudgetBar } from './Blocks.jsx';
import { IconClose, IconExternal } from './icons.jsx';

const isLink = (url) => /^https?:\/\//.test(url || '');

export default function BasketDrawer({ view, onClose }) {
  const [opened, setOpened] = useState({});
  const [bought, setBought] = useState({});
  const [copied, setCopied] = useState(false);
  const open = Boolean(view);
  const basket = view?.basket;
  const block = view?.block;

  const click = (item) => {
    setOpened((o) => ({ ...o, [item.product.id]: true }));
    api.feedback({ type: 'click', productId: item.product.id, strategy: basket.keys[0], category: item.role }).catch(() => {});
  };
  const markBought = (item, value) => {
    setBought((b) => ({ ...b, [item.product.id]: value }));
    if (value) api.feedback({ type: 'bought', productId: item.product.id, strategy: basket.keys[0], category: item.role }).catch(() => {});
  };
  const openAll = () => {
    // Browsers may block several pop-ups at once; each link also works on its own.
    basket.items.filter((i) => isLink(i.product.buyUrl)).forEach((i) => window.open(i.product.buyUrl, '_blank', 'noopener,noreferrer'));
    setOpened(Object.fromEntries(basket.items.map((i) => [i.product.id, true])));
  };
  const copyList = async () => {
    const lines = basket.items.map((i) => `- ${i.role}: ${i.product.name} (${i.product.merchant || 'retailer'}) ${money(i.product.price)}${i.quantity > 1 ? ` x${i.quantity}` : ''}${isLink(i.product.buyUrl) ? `\n  ${i.product.buyUrl}` : ''}`);
    const text = `${basket.label} setup${block.goal ? `: ${block.goal}` : ''}\n${lines.join('\n')}\nTotal ${money(basket.total)} (budget ${money(block.budget)})`;
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { window.prompt('Copy your list:', text); }
  };

  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-navy/40" onClick={onClose} />}
      <aside aria-label="Basket details" aria-hidden={!open}
        className={`fixed right-0 top-0 z-40 flex h-full w-full max-w-2xl flex-col bg-paper shadow-[-20px_0_60px_-30px_rgba(10,31,77,0.4)] transition-transform duration-300 ${open ? 'translate-x-0' : 'invisible translate-x-full'}`}>
        {basket && (
          <>
            <div className="flex items-start justify-between border-b border-rule px-6 py-5">
              <div>
                <p className="eyebrow">{basket.label} basket</p>
                <h2 className="display text-2xl font-semibold capitalize text-navy">{block.goal || 'Your setup'}</h2>
              </div>
              <button type="button" onClick={onClose} aria-label="Close basket" className="rounded-lg p-1.5 text-muted hover:bg-mist hover:text-navy"><IconClose size={22} /></button>
            </div>
            <div className="scroll-thin flex-1 space-y-5 overflow-y-auto p-6">
              <div className="rounded-xl bg-mist p-4">
                <div className="flex items-baseline justify-between"><span className="text-sm text-muted">Basket total</span><span className="num display text-4xl font-semibold text-navy">{money(basket.total)} <span className="font-sans text-sm font-normal text-muted">{inr(basket.total)}</span></span></div>
                <div className="mt-2"><BudgetBar total={basket.total} budget={block.budget} /></div>
              </div>

              <ul className="divide-y divide-rule rounded-xl border border-rule">
                {basket.items.map((item) => {
                  const p = item.product;
                  const others = (p.offers || []).filter((o) => isLink(o.url) && o.merchant !== p.merchant).slice(0, 2);
                  return (
                    <li key={p.id} className="flex gap-4 p-4">
                      <div className="flex h-20 w-20 flex-none items-center justify-center rounded-lg border border-rule bg-paper">
                        {p.image ? <img src={p.image} alt="" className="max-h-full max-w-full object-contain" /> : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted">{item.role}{item.quantity > 1 ? ` × ${item.quantity}` : ''}</p>
                        <p className="display text-[17px] font-medium leading-snug text-navy">{p.name}</p>
                        <p className="mt-0.5 text-[12.5px] text-muted">{item.reason}</p>
                        <p className="num mt-1.5 text-sm"><b className="display text-xl font-semibold text-navy">{money(p.price * item.quantity)}</b> <span className="text-muted">at {p.merchant || 'retailer'}</span></p>
                        <div className="mt-3 flex flex-wrap items-center gap-3">
                          {isLink(p.buyUrl)
                            ? <a href={p.buyUrl} target="_blank" rel="noopener noreferrer" onClick={() => click(item)} className="btn btn-primary !py-2">Buy at {p.merchant || 'retailer'} <IconExternal size={16} /></a>
                            : <span className="text-xs italic text-muted">No retailer link for this listing</span>}
                          {opened[p.id] && (
                            <label className="flex items-center gap-1.5 text-[13px] text-navy">
                              <input type="checkbox" checked={Boolean(bought[p.id])} onChange={(e) => markBought(item, e.target.checked)} className="h-4 w-4 accent-azure" />
                              I bought this
                            </label>
                          )}
                        </div>
                        {others.length > 0 && (
                          <p className="mt-2 text-xs text-muted">Also at: {others.map((o, i) => <span key={o.url}>{i > 0 && ', '}<a href={o.url} target="_blank" rel="noopener noreferrer" className="link">{o.merchant} {money(o.price)}</a></span>)}</p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>

              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn btn-outline" onClick={openAll}>Open all retailer links</button>
                <button type="button" className="btn btn-outline" onClick={copyList}>{copied ? 'Copied' : 'Copy shopping list'}</button>
              </div>
              <p className="rounded-lg border border-rule bg-canvas px-4 py-3 text-[12.5px] leading-relaxed text-muted">
                Buypal finds, compares and assembles the setup. You complete each purchase on the retailer’s own site, because no public API lets an outside app place orders at stores like Amazon or Walmart. Prices and stock can change there, and the total may differ slightly after tax and shipping.
              </p>
            </div>
          </>
        )}
      </aside>
    </>
  );
}
