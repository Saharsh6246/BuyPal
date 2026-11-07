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
    /(?:under|below|within|upto|up to|max(?:imum)?|budget(?:\s+of|\s+is)?|less than)\s*(\d+(?:\.\d+)?)(?![\d.])\s*(k|lakhs?|lacs?)?(?!\s*(?:gb|tb|hz|inch|in|"|mm|kg|g|gm|ml|l|ltr|litres?|min|mins|minutes?|hours?|hrs?|pack))/,
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

const FILLER = new Set(['as', 'possible', 'whichever', 'store', 'stores', 'quickest', 'any', 'one', 'hi', 'hello', 'hey', 'there', 'thanks', 'thank', 'help', 'ok', 'okay', 'i', 'want', 'need', 'to', 'buy', 'get', 'order', 'please', 'a', 'an', 'the', 'some', 'for', 'me', 'my', 'under', 'below', 'within', 'in', 'of', 'and', 'with', 'delivered', 'delivery', 'deliver', 'minutes', 'minute', 'min', 'mins', 'hours', 'hour', 'now', 'asap', 'urgent', 'urgently', 'instant', 'instantly', 'quick', 'quickly', 'today', 'tonight', 'tomorrow', 'fast', 'fastest', 'cheap', 'cheapest', 'best', 'good', 'find', 'looking', 'look', 'show', 'can', 'you', 'would', 'like', 'online', 'is', 'it', 'on', 'at', 'that', 'this', 'rs', 'inr', 'usd', 'rupees', 'dollars', 'budget', 'right', 'up', 'upto', 'max', 'less', 'than', 'lakh', 'k']);

/** Product words left once budget, urgency and filler are removed. Used when the message names an item Buypal has no keyword for. */
export function extractQuery(text) {
  const cleaned = text.toLowerCase().replace(/[₹$]\s*[\d,.]+\s*(k|lakhs?)?/g, ' ').replace(/[\d,.]+\s*(rupees|inr|rs|usd|dollars?)\b/g, ' ').replace(/\d+\s*(min|mins|minutes?|hours?|hrs?)\b/g, ' ').replace(/\b\d{4,}\b/g, ' ');
  const words = (cleaned.match(/[a-z0-9]+/g) || []).filter((w) => !FILLER.has(w));
  return words.slice(0, 7).join(' ');
}

export function parseRequirements(text) {
  const t = text.toLowerCase();
  const generic = extractQuery(text);
  const noun = generic.split(' ').filter((w) => /^[a-z]{3,}$/.test(w) && !['kgs', 'ltr', 'gms', 'pack', 'litre', 'litres'].includes(w)).slice(-1)[0] || null;
  // "phone charger" is a charger, not a phone: an accessory noun wins over the device it is for.
  const accessory = t.match(/\b(chargers?|cables?|cases?|covers?|adapters?|stands?|bags?|sleeves?|straps?|protectors?)\b/)?.[1]?.replace(/s$/, '');
  const category = accessory || (CATEGORIES.find(([, re]) => re.test(t)) || [])[0] || (noun && noun.length > 2 ? noun : null);
  const features = FEATURES.filter(([, re]) => re.test(t)).map(([name]) => name);
  const wantsStudent = /\b(college|student|school|university)\b/.test(t);
  const mustHave = features.filter((f) => ['gaming', 'wireless', '4k', 'oled', 'mechanical', 'noise cancelling'].includes(f));
  // A stated pack size ("500g", "1 litre") is an essential requirement, so different sizes are never mixed up.
  const size = t.match(/(\d+(?:\.\d+)?)\s?(kg|gm|g|ml|ltr|litres?|liters?|l)\b/);
  if (size) mustHave.push(`${size[1]} ${size[2]}`);
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
    search_query: generic || null,
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
    const quality = /\b(high[- ]quality|best quality|premium|top[- ]notch|best)\b/.test(t);
    const price = /\b(cheap|cheapest|affordable|budget|low cost|inexpensive|save money|lowest price)\b/.test(t);
    const priority_hint = quality && price ? 'balanced' : quality ? 'quality' : price ? 'price' : undefined;
    return { type: 'setup', goal: text.slice(0, 200), budget: req.budget_max, currency: req.currency, priority_hint, ...req };
  }
  if (/^\s*(hi|hello|hey|thanks|thank you|help|ok|okay)\b[\s!.?]*$/.test(t)) return { type: 'chat' };
  if (req.category) return { type: 'search', ...req };
  return { type: 'chat' };
}
