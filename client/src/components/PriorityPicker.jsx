const OPTIONS = [
  { key: 'price', title: 'Lowest price', note: 'The cheapest option that still meets your needs.' },
  { key: 'quality', title: 'Best quality', note: 'Performance, build and reviews come first.' },
  { key: 'balanced', title: 'Best balance', note: 'The most value for what you pay.' },
];

/** First-visit choice (cards) and the compact switcher (segmented). */
export default function PriorityPicker({ value, onChange, variant = 'cards' }) {
  if (variant === 'segmented') {
    return (
      <div role="radiogroup" aria-label="What matters most to you" className="inline-flex rounded-xl border border-rule-strong bg-paper p-1">
        {OPTIONS.map((o) => (
          <button key={o.key} type="button" role="radio" aria-checked={value === o.key} onClick={() => onChange(o.key)}
            className={`rounded-lg px-4 py-1.5 text-[13px] font-semibold transition ${value === o.key ? 'bg-navy text-white' : 'text-muted hover:text-navy'}`}>
            {o.title}
          </button>
        ))}
      </div>
    );
  }
  return (
    <div role="radiogroup" aria-label="What matters most to you" className="grid gap-3 sm:grid-cols-3">
      {OPTIONS.map((o) => {
        const selected = value === o.key;
        return (
          <button key={o.key} type="button" role="radio" aria-checked={selected} onClick={() => onChange(o.key)}
            className={`card flex items-start gap-3 p-4 text-left transition hover:border-azure ${selected ? '!border-azure ring-2 ring-azure/20' : ''}`}>
            <span className={`mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full border-2 ${selected ? 'border-azure' : 'border-rule-strong'}`}>
              {selected && <span className="h-2.5 w-2.5 rounded-full bg-azure" />}
            </span>
            <span>
              <span className="display block text-lg font-semibold text-navy">{o.title}</span>
              <span className="mt-0.5 block text-[13px] leading-snug text-muted">{o.note}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
