const OPTIONS = [
  { key: 'price', title: 'Lowest price', note: 'The cheapest option that still meets your needs.' },
  { key: 'quality', title: 'Best quality', note: 'Performance, build and reviews come first.' },
  { key: 'balanced', title: 'Best balance', note: 'The most value for what you pay.' },
  { key: 'speed', title: 'Fastest delivery', note: 'Get it as soon as possible, from whichever store is quickest.' },
];

/** First-visit choice (cards) and the compact switcher (segmented). */
export default function PriorityPicker({ value, onChange, variant = 'cards' }) {
  if (variant === 'segmented') {
    return (
      <div role="radiogroup" aria-label="What matters most to you" className="inline-flex border border-rule bg-paper">
        {OPTIONS.map((o) => (
          <button key={o.key} type="button" role="radio" aria-checked={value === o.key} onClick={() => onChange(o.key)}
            className={`px-4 py-2 text-[11.5px] font-semibold uppercase tracking-[0.12em] transition ${value === o.key ? 'bg-ink text-canvas' : 'text-muted hover:text-ink'}`}>
            {o.title}
          </button>
        ))}
      </div>
    );
  }
  return (
    <div role="radiogroup" aria-label="What matters most to you" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {OPTIONS.map((o, i) => (
        <button key={o.key} type="button" role="radio" aria-checked={value === o.key} onClick={() => onChange(o.key)}
          className={`border bg-paper p-5 text-left transition hover:border-ink ${value === o.key ? 'border-ink' : 'border-rule'}`}>
          <span className="eyebrow">No. {i + 1}</span>
          <span className="serif mt-1 block text-2xl font-semibold">{o.title}</span>
          <span className="mt-1 block text-[13px] leading-snug text-muted">{o.note}</span>
        </button>
      ))}
    </div>
  );
}
