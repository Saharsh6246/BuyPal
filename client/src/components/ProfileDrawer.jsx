import { useEffect, useState } from 'react';
import { api } from '../api.js';
import PriorityPicker from './PriorityPicker.jsx';

export default function ProfileDrawer({ open, onClose, priority, onPriority, onReset }) {
  const [data, setData] = useState({ preferences: [], summary: [] });
  const [error, setError] = useState('');

  const [insights, setInsights] = useState(null);
  const load = () => {
    api.preferences().then(setData).catch((e) => setError(e.message));
    api.insights().then(setInsights).catch(() => {});
  };
  useEffect(() => { if (open) load(); }, [open, priority]);
  const BASKETS = [['Budget', 'Best price'], ['Smart', 'Best overall'], ['Premium', 'Best quality']];

  const change = async (row, score) => {
    try { setData(await api.setPreference({ scope: row.scope, dimension: row.dimension, key: row.key, score })); } catch (e) { setError(e.message); }
  };
  const reset = async () => {
    if (!window.confirm('Reset everything Buypal has learned from your searches and choices? Your priority setting is kept.')) return;
    setData(await api.resetPreferences());
    onReset?.();
  };

  const groups = data.preferences.reduce((acc, row) => {
    (acc[row.scope] ||= []).push(row);
    return acc;
  }, {});

  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-navy/40" onClick={onClose} />}
      <aside aria-label="Your shopping profile" aria-hidden={!open}
        className={`fixed right-0 top-0 z-40 flex h-full w-full max-w-md flex-col border-l border-rule bg-paper transition-transform duration-300 ${open ? 'translate-x-0' : 'invisible translate-x-full'}`}>
        <div className="flex items-start justify-between border-b border-rule p-5">
          <div>
            <p className="eyebrow">Your shopping profile</p>
            <h2 className="display text-3xl font-semibold">What Buypal has learned</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close profile" className="text-2xl leading-none text-muted hover:text-ink">×</button>
        </div>
        <div className="scroll-thin flex-1 space-y-6 overflow-y-auto p-5 text-sm">
          <section>
            <h3 className="eyebrow mb-2 !text-muted">What matters most</h3>
            <PriorityPicker variant="segmented" value={priority} onChange={onPriority} />
            <p className="mt-2 text-[12.5px] text-muted">This decides which pick Buypal leads with, and what it recommends on your home page.</p>
          </section>
          {insights && (
            <section>
              <h3 className="eyebrow mb-2 !text-muted">Buypal’s read on you</h3>
              {insights.totalPicks === 0 ? (
                <p className="border border-rule bg-canvas p-4 text-muted">Choose a few picks and Buypal will start arranging its baskets around you.</p>
              ) : (
                <div className="space-y-3 border border-rule bg-canvas p-4">
                  <ul className="space-y-1.5">
                    {BASKETS.map(([key, label]) => {
                      const n = insights.basketTally[key] || 0;
                      return (
                        <li key={key} className="flex items-center gap-3 text-[13px]">
                          <span className="w-32 flex-none">{label}</span>
                          <span className="h-[5px] flex-1 bg-rule"><span className="block h-full bg-azure" style={{ width: `${Math.round((n / insights.totalPicks) * 100)}%` }} /></span>
                          <span className="w-6 text-right text-muted">{n}</span>
                        </li>
                      );
                    })}
                  </ul>
                  <ul className="space-y-1 text-[13px] leading-snug">{insights.lines.map((line) => <li key={line}>{line}</li>)}</ul>
                  <p className="text-[11.5px] text-muted">Built only from your own choices and orders. It decides which baskets appear first and which get a runner-up.</p>
                </div>
              )}
            </section>
          )}
          {data.summary.length > 0 && <ul className="space-y-1 border-l-2 border-azure bg-canvas px-4 py-3 text-[13px]">{data.summary.map((line) => <li key={line}>{line}</li>)}</ul>}
          <p className="text-[13px] leading-relaxed text-muted">Buypal learns from what you search, add, like, reject and buy. Nothing is hidden: review, correct or reset it below. Brand preferences can differ by category.</p>
          {data.preferences.length === 0 && <p className="border border-rule bg-canvas p-4 text-muted">Nothing learned yet. Add a pick to your cart or choose “Like” on a recommendation.</p>}
          {Object.entries(groups).map(([scope, rows]) => (
            <section key={scope}>
              <h3 className="eyebrow mb-2 !text-muted">{scope === 'global' ? 'All categories' : scope}</h3>
              <ul className="space-y-1.5">
                {rows.map((row) => (
                  <li key={`${row.scope}-${row.dimension}-${row.key}`} className="flex items-center justify-between border border-rule px-3 py-2">
                    <div>
                      <p className="display text-lg font-semibold capitalize">{row.dimension === 'brand' ? row.key : `${{ Budget: 'Price', Premium: 'Quality', Smart: 'Overall value' }[row.key] || row.key} focus`}</p>
                      <p className="text-[11.5px] text-muted">{row.dimension} · {row.score > 0 ? 'you lean towards this' : 'less preferred'} ({row.score > 0 ? '+' : ''}{Math.round(row.score * 10) / 10})</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button type="button" aria-label="Decrease" className="h-7 w-7 border border-rule hover:border-ink" onClick={() => change(row, row.score - 1)}>−</button>
                      <button type="button" aria-label="Increase" className="h-7 w-7 border border-rule hover:border-ink" onClick={() => change(row, row.score + 1)}>+</button>
                      <button type="button" aria-label="Remove" className="h-7 w-7 text-muted hover:text-danger" onClick={() => change(row, 0)}>×</button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {error && <p className="border-l-2 border-danger bg-paper px-3 py-2 text-xs text-danger">{error}</p>}
        </div>
        <div className="border-t border-rule p-5">
          <button type="button" onClick={reset} className="btn btn-outline w-full">Reset what Buypal has learned</button>
        </div>
      </aside>
    </>
  );
}
