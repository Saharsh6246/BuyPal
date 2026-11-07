import { useEffect, useState } from 'react';
import { api } from '../api.js';

const label = (row) => {
  const where = row.scope === 'global' ? 'All categories' : row.scope;
  const what = row.dimension === 'brand' ? row.key : `${row.key} picks`;
  return { where, what };
};

export default function ProfileDrawer({ open, onClose }) {
  const [data, setData] = useState({ preferences: [], summary: [] });
  const [error, setError] = useState('');

  const load = () => api.preferences().then(setData).catch((e) => setError(e.message));
  useEffect(() => { if (open) load(); }, [open]);

  const change = async (row, score) => {
    try { setData(await api.setPreference({ scope: row.scope, dimension: row.dimension, key: row.key, score })); } catch (e) { setError(e.message); }
  };
  const reset = async () => {
    if (!window.confirm('Reset everything Buypal has learned about you?')) return;
    setData(await api.resetPreferences());
  };

  const groups = data.preferences.reduce((acc, row) => {
    (acc[row.scope] ||= []).push(row);
    return acc;
  }, {});

  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-ink/30" onClick={onClose} />}
      <aside aria-label="Learned shopping preferences" aria-hidden={!open}
        className={`fixed right-0 top-0 z-40 flex h-full w-full max-w-md flex-col bg-white shadow-2xl transition-transform duration-300 ${open ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="flex items-start justify-between border-b border-line p-5">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-muted">Your shopping profile</p>
            <h2 className="font-display text-xl font-extrabold">What Buypal is learning</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close profile" className="text-2xl leading-none text-muted hover:text-ink">×</button>
        </div>
        <div className="scroll-thin flex-1 space-y-5 overflow-y-auto p-5 text-sm">
          <p className="text-muted">Buypal learns from what you add, like, reject and buy. Nothing is hidden: review, correct or reset it here. Brand preferences can differ by category.</p>
          {data.summary.length > 0 && (
            <ul className="space-y-1 rounded-xl bg-lime/25 p-3 text-forest">{data.summary.map((line) => <li key={line}>✓ {line}</li>)}</ul>
          )}
          {data.preferences.length === 0 && <p className="rounded-xl bg-canvas p-4 text-muted">Nothing learned yet. Add a pick to your cart or tap “Like” on a recommendation to teach Buypal.</p>}
          {Object.entries(groups).map(([scope, rows]) => (
            <section key={scope}>
              <h3 className="mb-2 font-display text-xs font-extrabold uppercase tracking-wider text-muted">{scope === 'global' ? 'All categories' : scope}</h3>
              <ul className="space-y-1.5">
                {rows.map((row) => {
                  const { what } = label(row);
                  return (
                    <li key={`${row.scope}-${row.dimension}-${row.key}`} className="flex items-center justify-between rounded-xl border border-line px-3 py-2">
                      <div>
                        <p className="font-semibold capitalize">{what}</p>
                        <p className="text-[11.5px] text-muted">{row.dimension} · {row.score > 0 ? 'you lean towards this' : 'less preferred'} ({row.score > 0 ? '+' : ''}{Math.round(row.score * 10) / 10})</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button type="button" aria-label={`Decrease ${what}`} className="h-7 w-7 rounded-full border border-line hover:border-ink" onClick={() => change(row, row.score - 1)}>−</button>
                        <button type="button" aria-label={`Increase ${what}`} className="h-7 w-7 rounded-full border border-line hover:border-ink" onClick={() => change(row, row.score + 1)}>+</button>
                        <button type="button" aria-label={`Remove ${what}`} className="h-7 w-7 rounded-full text-muted hover:text-rose-700" onClick={() => change(row, 0)}>×</button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</p>}
        </div>
        <div className="border-t border-line p-5">
          <button type="button" onClick={reset} className="w-full rounded-xl border border-line py-2.5 text-sm font-semibold hover:border-rose-400 hover:text-rose-700">Reset learned preferences</button>
        </div>
      </aside>
    </>
  );
}
