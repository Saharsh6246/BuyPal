// Rule-based understanding of shopping messages. It is the fallback when the LLM is unavailable (no key,
// daily limit reached, rate limit) and it is fully deterministic, so it is also what the tests exercise.

const CATEGORIES = [
  ['laptop', /\b(laptops?|notebooks?|macbooks?|chromebooks?)\b/],
  ['monitor', /\b(monitors?|displays?|screens?)\b/],
  ['keyboard', /\bkeyboards?\b/],
  ['mouse', /\b(mouse|mice)\b/],
  ['headphones', /\b(headphones?|headsets?|earbuds?|earphones?)\b/],
  ['webcam', /\bwebcams?\b/],
  ['speaker', /\b(speakers?|soundbars?)\b/],
  ['tablet', /\b(tablets?|ipads?)\b/],
  ['phone', /\b(phones?|smartphones?|iphones?)\b/],
];

const FEATURES = [
  ['gaming', /\b(gaming|games?|gamer)\b/],
  ['wireless', /\b(wireless|cordless)\b/],
  ['lightweight', /\b(lightweight|light weight|portable|portability|thin and light|ultrabook)\b/],
  ['long battery', /\b(battery life|long battery|good battery|all[- ]day battery|battery)\b/],
  ['4k', /\b(4k|uhd)\b/],
  ['oled', /\boled\b/],
  ['mechanical', /\bmechanical\b/],
  ['rgb', /\brgb\b/],
  ['noise cancelling', /\bnoise[- ]cancell?ing\b/],
  ['ergonomic', /\bergonomic\b/],
];

const BRANDS = ['hp', 'dell', 'lenovo', 'asus', 'acer', 'apple', 'msi', 'samsung', 'lg', 'logitech', 'razer', 'sony', 'bose', 'microsoft', 'corsair', 'steelseries', 'benq', 'gigabyte', 'jbl', 'hyperx'];

export function parseBudget(text) {
  const t = text.toLowerCase().replace(/,/g, '');
  const multiplier = (suffix) => (/^(k)$/.test(suffix || '') ? 1000 : /^(lakh|lakhs|lac|lacs)$/.test(suffix || '') ? 100000 : 1);
  const patterns = [
    /(₹|rs\.?|inr|\$|usd)\s*(\d+(?:\.\d+)?)\s*(k|lakhs?|lacs?)?/,
    /(\d+(?:\.\d+)?)\s*(k|lakhs?|lacs?)?\s*(rupees|inr|rs|usd|dollars?)\b/,
    /(?:under|below|within|upto|up to|max(?:imum)?|budget(?:\s+of|\s+is)?|less than)\s*(\d+(?:\.\d+)?)\s*(k|lakhs?|lacs?)?(?!\s*(?:gb|tb|hz|inch|in|"|mm|kg))/,
  ];
  for (const [index, pattern] of patterns.entries()) {
    const match = t.match(pattern);
    if (!match) continue;
    let amount; let currencyWord = '';
    if (index === 0) { currencyWord = match[1]; amount = Number(match[2]) * multiplier(match[3]); }
    else if (index === 1) { currencyWord = match[3]; amount = Number(match[1]) * multiplier(match[2]); }
    else { amount = Number(match[1]) * multiplier(match[2]); }
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const currency = /₹|rs|inr|rupee/.test(currencyWord) ? 'INR' : /\$|usd|dollar/.test(currencyWord) ? 'USD' : (amount >= 10000 ? 'INR' : 'USD');
    return { amount, currency };
  }
  return null;
}

export function parseRequirements(text) {
  const t = text.toLowerCase();
  const category = (CATEGORIES.find(([, re]) => re.test(t)) || [])[0] || null;
  const features = FEATURES.filter(([, re]) => re.test(t)).map(([name]) => name);
  const wantsStudent = /\b(college|student|school|university)\b/.test(t);
  const mustHave = features.filter((f) => ['gaming', 'wireless', '4k', 'oled', 'mechanical', 'noise cancelling'].includes(f));
  const niceToHave = [...features.filter((f) => !mustHave.includes(f))];
  if (wantsStudent) { niceToHave.push('lightweight', 'long battery'); }
  const preferred = [];
  const excluded = [];
  for (const brand of BRANDS) {
    const re = new RegExp(`\\b${brand}\\b`);
    if (!re.test(t)) continue;
    if (new RegExp(`\\b(no|not|avoid|except|without)\\s+${brand}\\b`).test(t)) excluded.push(brand);
    else preferred.push(brand);
  }
  const budget = parseBudget(text);
  return {
    category,
    must_have: [...new Set(mustHave)],
    nice_to_have: [...new Set(niceToHave)],
    preferred_brands: preferred,
    excluded_brands: excluded,
    budget_max: budget?.amount ?? null,
    currency: budget?.currency ?? 'USD',
    allow_over_budget: /\b(stretch|can go higher|flexible|slightly above|a bit more)\b/.test(t),
  };
}

/** Decides what the user wants. Returns { type: 'setup' | 'edit' | 'cart' | 'search' | 'chat', ... }. */
export function heuristicPlan(text, { cartItems = 0 } = {}) {
  const t = text.toLowerCase();
  const req = parseRequirements(text);

  if (cartItems > 0 && /\b(replace|swap|change|remove|drop|delete|cheaper|reduce|lower|cut|decrease|bring down|wireless version)\b/.test(t)) {
    const itemWord = (CATEGORIES.find(([, re]) => re.test(t)) || [])[0] || null;
    const reduce = t.match(/(?:reduce|lower|cut|decrease|bring down|save)[^\d₹$]*(?:by)?\s*(?:₹|rs\.?|\$)?\s*([\d,]+(?:\.\d+)?)\s*(k)?/);
    const amount = reduce ? Number(reduce[1].replace(/,/g, '')) * (reduce[2] ? 1000 : 1) : null;
    const currency = /₹|rs\.?|inr|rupee/.test(t) ? 'INR' : (amount && amount >= 10000 ? 'INR' : 'USD');
    if (/\b(remove|delete|drop)\b/.test(t) && itemWord) return { type: 'edit', action: 'remove_item', item: itemWord };
    const replace = itemWord && /\b(replace|swap|change|wireless version|cheaper|lower price|less expensive)\b/.test(t)
      ? { action: 'replace_item', item: itemWord, must_have: [...req.must_have, ...req.nice_to_have.filter((f) => f !== 'long battery')], cheaper: /\b(cheaper|lower price|less expensive)\b/.test(t) && !amount }
      : null;
    const reduction = amount ? { action: 'reduce_total', reduce_by: amount, currency } : null;
    const steps = [replace, reduction].filter(Boolean);
    if (steps.length) return { type: 'edit', steps };
  }
  if (/\b(show|view|what'?s in|see)\b.*\bcart\b/.test(t)) return { type: 'cart' };
  if (/\b(build|complete|full|whole|entire|assemble)\b.*\b(setup|station|workstation|kit)\b|\bsetup\b.*\b(under|within|budget)\b/.test(t)) {
    return { type: 'setup', goal: text.slice(0, 200), budget: req.budget_max, currency: req.currency, ...req };
  }
  if (req.category) return { type: 'search', ...req };
  return { type: 'chat' };
}
