import { fmtUsd } from '../lib/money.js';
import { parseSize, performanceScore, specChips } from './specs.js';

// Deterministic recommendation engine. The LLM never ranks products: it only gets the results of this file.

const CATEGORY_WORDS = {
  laptop: ['laptop', 'notebook', 'chromebook', 'macbook'],
  monitor: ['monitor', 'display'],
  keyboard: ['keyboard'],
  mouse: ['mouse', 'mice'],
  headphones: ['headphone', 'headset', 'earbud', 'earphone'],
  phone: ['phone', 'smartphone', 'iphone', 'galaxy'],
  tablet: ['tablet', 'ipad'],
  webcam: ['webcam', 'camera'],
  speaker: ['speaker', 'soundbar'],
  'mouse pad': ['mouse pad', 'mousepad', 'desk mat'],
  'laptop stand': ['stand'],
};
const MAIN_DEVICES = new Set(['laptop', 'monitor', 'phone', 'tablet']);
const ACCESSORY_WORDS = /\b(case|sleeve|bag|backpack|stand|charger|skin|cover|adapter|replacement|screen protector|sticker|decal|dock|riser|cooling pad|battery pack|parts?)\b/i;

const TERM_RULES = [
  [/^(wireless|cordless)$/, (p, t) => {
    const name = p.name.toLowerCase();
    if (/\bwired\b/.test(name) && !/wireless|bluetooth/.test(name)) return false;
    return /wireless|bluetooth|2\.4\s?ghz/.test(t);
  }],
  [/^bluetooth$/, (p, t) => /bluetooth/.test(t)],
  [/^gaming$/, (p, t) => {
    const isComputer = /laptop|notebook|computer|desktop/.test(`${p.category?.path?.join(' ') || ''} ${p.name}`.toLowerCase());
    // A gaming computer needs evidence (a dedicated GPU, a fast display or a known gaming line), not just the word in the title.
    if (isComputer && /chromebook/i.test(p.name)) return false;
    if (isComputer) return p.specs.gpu != null || (p.specs.refreshHz != null && p.specs.refreshHz >= 120) || /legion|\brog\b|predator|nitro|victus|omen|alienware|\btuf\b|\bloq\b/.test(t);
    return /gaming|rgb|rtx|gtx/.test(t);
  }],
  [/^(lightweight|light|portable|ultraportable|thin)$/, (p, t) => (p.specs.weightKg != null && p.specs.weightKg <= 1.8) || /lightweight|ultraportable|ultralight|thin and light|ultrabook|thin & light|slim/.test(t)],
  [/^(long battery|battery|battery life|long battery life)$/, (p, t) => (p.specs.batteryHours != null && p.specs.batteryHours >= 10) || /long battery|all-day battery|all day battery/.test(t)],
  [/^(4k|uhd)$/, (p, t) => /4k|2160p|uhd/.test(t)],
  [/^(1440p|qhd|2k)$/, (p, t) => /1440p|qhd|2k|2560/.test(t)],
  [/^oled$/, (p, t) => /oled/.test(t)],
  [/^mechanical$/, (p, t) => /mechanical/.test(t)],
  [/^(rgb|backlit)$/, (p, t) => /rgb|backlit|backlight/.test(t)],
  [/^(noise cancelling|noise cancellation|anc)$/, (p, t) => /noise[- ]cancel|\banc\b/.test(t)],
  [/^ergonomic$/, (p, t) => /ergonomic/.test(t)],
  [/^touch(screen)?$/, (p, t) => /touch ?screen|touch display/.test(t)],
  [/^ssd$/, (p, t) => /ssd|nvme/.test(t)],
];

export function matchTerm(term, product) {
  const clean = String(term).toLowerCase().trim();
  const text = (product.searchText || '').toLowerCase();
  for (const [pattern, test] of TERM_RULES) if (pattern.test(clean)) return Boolean(test(product, text));
  const ram = clean.match(/^(\d+)\s?gb\s*(?:of\s*)?ram$/);
  if (ram) return product.specs.ramGb != null && product.specs.ramGb >= Number(ram[1]);
  const storage = clean.match(/^(\d+)\s?(gb|tb)\s*(?:ssd|storage)?$/);
  if (storage) return product.specs.storageGb != null && product.specs.storageGb >= Number(storage[1]) * (storage[2] === 'tb' ? 1000 : 1);
  const hz = clean.match(/^(\d+)\s?hz$/);
  if (hz) return product.specs.refreshHz != null && product.specs.refreshHz >= Number(hz[1]);
  if (/^\d+(?:\.\d+)?\s?(kg|gm|g|ml|ltr|litres?|liters?|l)$/.test(clean)) {
    const wanted = parseSize(clean);
    const have = parseSize(product.name) || parseSize((product.attributes || []).join(' '));
    return Boolean(wanted && have && wanted.unit === have.unit && Math.abs(wanted.qty - have.qty) / wanted.qty < 0.02);
  }
  const tokens = clean.split(/\s+/).filter((token) => token.length >= 3);
  return tokens.length > 0 && tokens.every((token) => text.includes(token));
}

const categoryWords = (category) => CATEGORY_WORDS[category] || [category];

function isRelevant(product, req) {
  if (!req.category) return true;
  const words = categoryWords(req.category);
  const haystack = `${product.category?.path?.join(' ') || ''} ${product.category?.title || ''} ${product.name}`.toLowerCase();
  if (!words.some((word) => haystack.includes(word))) return false;
  if (MAIN_DEVICES.has(req.category) && ACCESSORY_WORDS.test(product.name)) return false;
  return true;
}

const qualityOf = (product) => {
  if (!product.rating) return null;
  const { value, count } = product.rating;
  const bayes = (value * count + 4 * 20) / (count + 20);
  return Math.max(0, Math.min(1, (bayes - 3) / 2));
};
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : 0;
};

/** Public product shape sent to the browser (no raw search text). */
export function publicProduct(product) {
  const { searchText, ...rest } = product;
  return { ...rest, specChips: specChips(product.specs) };
}

// Sanity floors (USD). Listings far below these are almost always parts, accessories, refurbished lots or mislabelled items.
const PLAUSIBLE_FLOOR = { laptop: 150, monitor: 50, keyboard: 6, mouse: 4, headphones: 6, phone: 70, tablet: 45, webcam: 8, speaker: 8 };
export function plausibleFloor(req) {
  if (req.category === 'laptop' && req.gaming) return 400;
  return PLAUSIBLE_FLOOR[req.category] ?? 0;
}

export function filterCandidates(products, req) {
  const notes = [];
  const floor = plausibleFloor(req);
  let pool = products.filter((p) => p.price != null && p.price >= floor && p.currency === 'USD' && !/out|sold|discontinued/i.test(p.availability || ''));
  const excluded = (req.excludedBrands || []).map((b) => b.toLowerCase());
  if (excluded.length) pool = pool.filter((p) => !excluded.includes((p.brand || '').toLowerCase()));

  // Everyday consumables: the real-retailer catalogue (Channel3) does not carry them, and its "bread"/"flour" hits are
  // appliances and kitchen towels. When the store feed recognises the item, compare only like with like.
  const CONSUMABLE = ['grocery', 'snacks', 'household', 'personal', 'baby', 'pet'];
  if (pool.some((p) => p.demo && CONSUMABLE.includes(p.category?.path?.[1]))) {
    const before = pool.length;
    pool = pool.filter((p) => p.demo);
    if (pool.length < before) notes.push('Everyday items are compared across the demo store feed. Real retailer listings for this item are not available in the connected catalogue.');
  }

  const relevant = pool.filter((p) => isRelevant(p, req));
  if (relevant.length >= 3 || relevant.length === pool.length) pool = relevant;
  else if (relevant.length > 0) pool = relevant;
  else notes.push(`Few results were clearly labelled as "${req.category}", so some may be loosely related.`);

  if (MAIN_DEVICES.has(req.category) && pool.length >= 6) {
    const floor = median(pool.map((p) => p.price)) * 0.25;
    pool = pool.filter((p) => p.price >= floor);
  }

  // Comparing a 100 g pack with a 500 g pack is meaningless. If the user did not ask for a size, compare the most widely stocked one.
  const askedSize = (req.mustHave || []).some((t) => /^\d+(?:\.\d+)?\s?(kg|gm|g|ml|ltr|litres?|liters?|l)$/i.test(t));
  if (!askedSize) {
    const sized = pool.map((p) => ({ p, size: parseSize(p.name) })).filter((x) => x.size);
    const sizes = [...new Set(sized.map((x) => `${x.size.unit}:${x.size.qty}`))];
    if (sized.length >= 4 && sizes.length >= 2 && new Set(sized.map((x) => x.size.unit)).size === 1) {
      const counts = new Map();
      sized.forEach((x) => counts.set(`${x.size.unit}:${x.size.qty}`, (counts.get(`${x.size.unit}:${x.size.qty}`) || 0) + 1));
      const [bestKey] = [...counts].sort((a, b) => b[1] - a[1] || Number(a[0].split(':')[1]) - Number(b[0].split(':')[1]))[0];
      const keep = new Set(sized.filter((x) => `${x.size.unit}:${x.size.qty}` === bestKey).map((x) => x.p.id));
      pool = pool.filter((p) => keep.has(p.id));
      const qty = Number(bestKey.split(':')[1]);
      notes.push(`Compared ${bestKey.startsWith('g') ? (qty >= 1000 ? `${qty / 1000} kg` : `${qty} g`) : (qty >= 1000 ? `${qty / 1000} litre` : `${qty} ml`)} packs, the most widely stocked size. Name a size to compare others.`);
    }
  }
  return { pool, notes };
}

function featuresFor(product, req) {
  const mustMissing = (req.mustHave || []).filter((term) => !matchTerm(term, product));
  const niceMatched = (req.niceToHave || []).filter((term) => matchTerm(term, product));
  const mustMatched = (req.mustHave || []).filter((term) => !mustMissing.includes(term));
  const weightTotal = (req.mustHave || []).length + 0.5 * (req.niceToHave || []).length;
  const fit = weightTotal === 0 ? 0.5 : (mustMatched.length + 0.5 * niceMatched.length) / weightTotal;
  const gaming = Boolean(req.gaming);
  return {
    mustMissing, mustMatched, niceMatched, fit,
    quality: qualityOf(product),
    perf: performanceScore(product.specs, { gaming }),
    discount: product.compareAtPrice ? 1 - product.price / product.compareAtPrice : 0,
  };
}

const EMPTY_PROFILE = { brand: {}, strategy: {}, budgetSensitivity: 0, dominant: null, tally: {} };

export const deliveryText = (minutes) => (minutes < 60 ? `${minutes} minutes` : minutes < 1440 ? `${Math.round(minutes / 60)} hours` : `${Math.round(minutes / 1440)} day(s)`);
/** What the shopper really pays for the listing: item price plus its delivery fee (when the provider reports one). */
export const landedPrice = (product) => product.price + (product.delivery?.feeUsd || 0);
/** 1 = within minutes, 0 = a week away. Log scale, because 10 vs 20 minutes matters more than 3 vs 4 days. */
const speedOf = (product) => {
  if (!product.delivery) return null;
  const m = Math.max(5, product.delivery.minutes);
  return Math.max(0, Math.min(1, 1 - Math.log10(m / 5) / Math.log10(7200 / 5)));
};

/**
 * Filters and scores candidates. Returns every eligible option with its Budget / Premium / Smart scores.
 * Used by the recommendation cards and by the multi-product cart builder.
 */
export function rankOptions(products, req, profile = EMPTY_PROFILE) {
  const { pool, notes } = filterCandidates(products, req);
  const budget = req.budgetMax ?? Infinity;
  const stats = { found: products.length, considered: pool.length, eligible: 0 };
  const empty = { pool, notes, stats, budget, within: [], over: [], eligible: [], med: 0, minP: 0 };
  if (pool.length === 0) return empty;

  let within = pool.filter((p) => p.price <= budget);
  const over = pool.filter((p) => p.price > budget);
  if (within.length === 0) return { ...empty, over };

  if (req.maxDeliveryMinutes) {
    const fast = within.filter((p) => p.delivery && p.delivery.minutes <= req.maxDeliveryMinutes);
    if (fast.length) within = fast;
    else notes.push(`No store in the available data can deliver within ${deliveryText(req.maxDeliveryMinutes)}, so these are the fastest options found. Listings from providers that do not report delivery times cannot be confirmed as fast.`);
  }

  const entries = within.map((product) => ({ product, ...featuresFor(product, req) }));
  let eligible = entries.filter((e) => e.mustMissing.length === 0);
  if (eligible.length === 0) {
    const fewest = Math.min(...entries.map((e) => e.mustMissing.length));
    eligible = entries.filter((e) => e.mustMissing.length === fewest);
    notes.push('No listing clearly confirms every requirement, so these are the closest matches. Check the "missing" notes on each card.');
  }
  stats.eligible = eligible.length;

  const prices = eligible.map((e) => landedPrice(e.product));
  const minP = Math.min(...prices);
  const span = Math.max(...prices) - minP || 1;
  const lambda = Math.max(0.1, 0.3 + 0.24 * profile.budgetSensitivity);
  const brandBonus = (p) => {
    const pref = profile.brand[(p.brand || '').toLowerCase()] || 0;
    const wanted = (req.preferredBrands || []).some((b) => b.toLowerCase() === (p.brand || '').toLowerCase()) ? 0.08 : 0;
    return pref * 0.02 + wanted;
  };

  for (const entry of eligible) {
    const priceNorm = (landedPrice(entry.product) - minP) / span;
    const q = entry.quality ?? 0.5;
    const perfOrQuality = entry.perf ?? q;
    entry.priceNorm = priceNorm;
    entry.speed = speedOf(entry.product);
    entry.composite = 0.4 * perfOrQuality + 0.3 * q + 0.3 * entry.fit + brandBonus(entry.product);
    entry.scores = {
      Budget: 0.6 * (1 - priceNorm) + 0.25 * entry.fit + 0.15 * q + 0.05 * Math.min(entry.discount, 0.3) / 0.3 + brandBonus(entry.product),
      Premium: 0.4 * (entry.perf ?? priceNorm) + 0.3 * q + 0.2 * entry.fit + 0.1 * priceNorm + brandBonus(entry.product),
      Smart: entry.composite - lambda * priceNorm,
      Fastest: entry.speed == null ? -1 : 0.65 * entry.speed + 0.2 * (1 - priceNorm) + 0.15 * q + brandBonus(entry.product),
    };
  }
  return { pool, notes, stats, budget, within, over, eligible, med: median(prices), minP };
}

/**
 * Builds the adaptive set of recommendation cards.
 * `profile` comes from preferences.getProfile; it changes ordering, brand weighting and how many cards of one strategy appear.
 */
export function buildRecommendations(products, req, profile = EMPTY_PROFILE) {
  const { notes, stats, budget, within, over, eligible, med, minP, pool } = rankOptions(products, req, profile);
  if (pool.length === 0) return { cards: [], notes, stats };
  if (within.length === 0) {
    notes.push(`Nothing in these results fits within ${fmtUsd(budget)}. The cheapest listing was ${fmtUsd(Math.min(...pool.map((p) => p.price)))}.`);
    return { cards: [], notes, stats, cheapest: publicProduct([...pool].sort((a, b) => a.price - b.price)[0]) };
  }

  const best = (list, strategy, skip = new Set()) =>
    [...list].filter((e) => !skip.has(e.product.id)).sort((a, b) => b.scores[strategy] - a.scores[strategy])[0] || null;

  // Prefer products with a meaningful number of good reviews, so the cheapest pick is not an unrated no-name listing.
  const reviewed = eligible.filter((e) => e.quality !== null && e.quality >= 0.3 && e.product.rating.count >= 10);
  const budgetPool = reviewed.length >= 2 ? reviewed : eligible.filter((e) => e.quality === null || e.quality >= 0.3);
  const withDelivery = eligible.filter((e) => e.speed != null);
  const picks = {
    Budget: best(budgetPool.length ? budgetPool : eligible, 'Budget'),
    Premium: best(eligible, 'Premium'),
    Smart: best(eligible, 'Smart'),
    Fastest: withDelivery.length ? best(withDelivery, 'Fastest') : null,
  };

  const byProduct = new Map();
  const addRole = (entry, role) => {
    if (!entry) return;
    const record = byProduct.get(entry.product.id) || { entry, roles: [] };
    if (!record.roles.includes(role)) record.roles.push(role);
    byProduct.set(entry.product.id, record);
  };
  // Which baskets to show, and in what order, adapts to this shopper: stated priority, what they chose before and the urgency of this request.
  const affinityOf = (basket) => (profile.strategy[basket] ?? 0) + (basket === 'Fastest' && req.maxDeliveryMinutes ? 10 : 0);
  const defaultOrder = ['Budget', 'Smart', 'Premium', 'Fastest'];
  const basketOrder = defaultOrder.filter((b) => picks[b]).sort((a, b) => affinityOf(b) - affinityOf(a) || defaultOrder.indexOf(a) - defaultOrder.indexOf(b));
  basketOrder.forEach((role) => addRole(picks[role], role));

  // Adaptive extras based on what this user usually chooses, and on what the data shows.
  // The basket the shopper favours gets a runner-up even if that makes a fifth card.
  if (profile.dominant && byProduct.size < 5) {
    const runnerUp = best(eligible, profile.dominant, new Set(byProduct.keys()));
    if (runnerUp && (runnerUp.scores[profile.dominant] ?? -1) > -1) addRole(runnerUp, `${profile.dominant} alt`);
  }
  const topRated = [...eligible].filter((e) => e.product.rating?.count >= 30 && e.quality !== null)
    .sort((a, b) => b.quality - a.quality)[0];
  const maxPickQuality = Math.max(...Object.values(picks).filter(Boolean).map((e) => e.quality ?? 0));
  if (topRated && !byProduct.has(topRated.product.id) && topRated.quality >= maxPickQuality + 0.05 && byProduct.size < 4) addRole(topRated, 'Top rated');
  if (req.allowOverBudget && byProduct.size < 4) {
    const stretch = over.filter((p) => p.price <= budget * 1.3).map((product) => ({ product, ...featuresFor(product, req) }))
      .filter((e) => e.mustMissing.length === 0)
      .sort((a, b) => (b.perf ?? b.quality ?? 0) - (a.perf ?? a.quality ?? 0))[0];
    if (stretch) { stretch.scores = {}; addRole(stretch, 'Stretch'); }
  }

  const affinity = (roles) => Math.max(...roles.map((r) => affinityOf(r.replace(' alt', ''))));
  const order = defaultOrder;
  const rankOf = (roles) => { const i = order.indexOf(roles[0]); return i === -1 ? 99 : i; };
  const records = [...byProduct.values()].sort((a, b) => affinity(b.roles) - affinity(a.roles) || rankOf(a.roles) - rankOf(b.roles));

  const ctx = { budget, picks, eligible, med, minP, profile, req };
  const cards = records.slice(0, 5).map(({ entry, roles }) => makeCard(entry, roles, ctx));
  return { cards, notes, stats, basketPlan: explainBaskets({ picks, basketOrder, profile, req, affinityOf }) };
}

const DISPLAY = { Fastest: 'Quickest delivery', 'Fastest alt': 'Also quick to arrive', Budget: 'Best price', Smart: 'Best overall', Premium: 'Best quality', 'Budget alt': 'Also strong on price', 'Smart alt': 'Also strong overall', 'Premium alt': 'Also strong on quality', 'Top rated': 'Top rated', Stretch: 'Stretch pick' };
const STYLE = { Budget: 'price', Smart: 'overall value', Premium: 'quality', Fastest: 'speed' };
const BASKET_NAME = { Budget: 'Best price', Smart: 'Best overall', Premium: 'Best quality', Fastest: 'Quickest delivery' };

/** Plain-language account of why these baskets, in this order, for this shopper. */
function explainBaskets({ picks, basketOrder, profile, req, affinityOf }) {
  const lines = [];
  if (req.maxDeliveryMinutes) lines.push(`You need it within ${deliveryText(req.maxDeliveryMinutes)}, so Quickest delivery leads.`);
  if (profile.priority) lines.push(`Your priority is ${{ price: 'the lowest price', quality: 'the best quality', balanced: 'the best balance', speed: 'the fastest delivery' }[profile.priority]}, which pushes ${BASKET_NAME[{ price: 'Budget', quality: 'Premium', balanced: 'Smart', speed: 'Fastest' }[profile.priority]]} up.`);
  const tally = Object.entries(profile.tally || {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  if (tally.length) lines.push(`From your past choices: ${tally.map(([b, n]) => `${BASKET_NAME[b] || b} ×${n}`).join(', ')}. Baskets you pick more often come first and get a runner-up.`);
  if (!picks.Fastest) lines.push('No quickest-delivery basket this time: none of the matching listings report a delivery time.');
  if (!lines.length) lines.push('No history yet. Baskets are in the default order and will adapt as you choose and buy.');
  return { order: basketOrder.map((b) => ({ basket: b, label: BASKET_NAME[b], weight: Math.round(affinityOf(b) * 10) / 10 })), lines };
}
const roleLabel = (roles) => roles.map((r) => DISPLAY[r] || r).join(' · ');

function makeCard(entry, roles, ctx) {
  const { product } = entry;
  const { budget, picks, eligible, minP, profile, req } = ctx;
  const cheapest = picks.Budget?.product;
  const premium = picks.Premium?.product;
  const n = eligible.length;
  const positions = [];
  const pros = [];
  const cons = [];

  if (roles.includes('Budget')) positions.push(`Lowest ${product.delivery ? 'total cost, item plus delivery' : 'price'} (${fmtUsd(landedPrice(product))}) among ${n} listing${n === 1 ? '' : 's'} that meet your requirements.`);
  if (roles.includes('Fastest')) {
    const cheaper = picks.Budget && picks.Budget.product.id !== product.id ? landedPrice(product) - landedPrice(picks.Budget.product) : 0;
    positions.push(`Quickest delivery: about ${product.delivery.label} from ${product.merchant}${cheaper > 0.005 ? `, for ${fmtUsd(cheaper)} more than the cheapest basket` : ''}.`);
  }
  if (roles.includes('Premium')) {
    const rank = [...eligible].sort((a, b) => (b.perf ?? b.priceNorm) - (a.perf ?? a.priceNorm)).findIndex((e) => e.product.id === product.id) + 1;
    positions.push(entry.perf != null
      ? (rank === 1 ? `Strongest listed specs within budget (#1 of ${n} on CPU/GPU/RAM/storage).` : `High-performance pick within budget (#${rank} of ${n} on listed CPU/GPU/RAM/storage), balanced with ratings.`)
      : 'Best combination of ratings and price tier within budget. The listing has too few specs to rank performance.');
  }
  if (roles.includes('Smart')) {
    if (premium && premium.id !== product.id) {
      const saved = premium.price - product.price;
      const premiumEntry = picks.Premium;
      const ratio = premiumEntry.composite > 0 ? Math.round((entry.composite / premiumEntry.composite) * 100) : null;
      positions.push(saved > 0
        ? `Best overall: ${fmtUsd(saved)} (${Math.round((saved / premium.price) * 100)}%) cheaper than the best-quality pick${ratio && ratio >= 60 && ratio < 100 ? ` while scoring ${ratio}% as well on fit, ratings and specs` : ''}.`
        : 'Best balance of price, ratings, specs and requirement fit.');
    } else positions.push('Best balance of price, ratings, specs and requirement fit.');
  }
  if (roles.some((r) => r.endsWith(' alt'))) positions.push(`Runner-up on ${STYLE[roles.find((r) => r.endsWith(' alt')).replace(' alt', '')]}, which is what you usually choose.`);
  if (roles.includes('Top rated')) positions.push(`Highest buyer rating (${product.rating.value}/5 from ${product.rating.count} reviews) among the options.`);
  if (roles.includes('Stretch')) positions.push(`Above your budget by ${fmtUsd(product.price - budget)}, shown because you allowed higher-priced alternatives.`);

  if (product.delivery) pros.push(`Delivers in about ${product.delivery.label} from ${product.merchant}${product.delivery.feeInr === 0 ? ', free delivery' : ''}`);
  if (product.rating) pros.push(`Rated ${product.rating.value}/5 by ${product.rating.count} buyers`);
  const chips = specChips(product.specs).filter((chip) => !/^(\d+(\.\d+)?kg|.*battery)$/.test(chip)).slice(0, 3);
  if (chips.length) pros.push(`Listed specs: ${chips.join(', ')}`);
  if (entry.discount >= 0.05) pros.push(`${Math.round(entry.discount * 100)}% below the listed regular price (${fmtUsd(product.compareAtPrice)})`);
  if (entry.mustMatched.length) pros.push(`Lists what you asked for: ${entry.mustMatched.join(', ')}`);
  if (entry.niceMatched.length) pros.push(`Also matches: ${entry.niceMatched.join(', ')}`);
  if (product.specs.weightKg && product.specs.weightKg <= 1.8) pros.push(`Light at ${product.specs.weightKg}kg`);
  if (product.specs.batteryHours && product.specs.batteryHours >= 10) pros.push(`Up to ${product.specs.batteryHours}h battery (as listed)`);

  if (product.delivery && product.delivery.feeInr > 0) cons.push(`Delivery fee ₹${product.delivery.feeInr} (about ${fmtUsd(product.delivery.feeUsd)})`);
  if (product.delivery && req.maxDeliveryMinutes && product.delivery.minutes > req.maxDeliveryMinutes) cons.push(`Slower than the ${deliveryText(req.maxDeliveryMinutes)} you asked for`);
  if (entry.mustMissing.length) cons.push(`Listing doesn't confirm: ${entry.mustMissing.join(', ')}`);
  if (!product.rating) cons.push('No buyer ratings available');
  else if (product.rating.value < 3.8) cons.push(`Mixed reviews (${product.rating.value}/5)`);
  if (product.specs.ramGb && product.specs.ramGb < 8 && req.category === 'laptop') cons.push(`Only ${product.specs.ramGb}GB RAM`);
  if (product.specs.weightKg && product.specs.weightKg > 2.2 && (req.mustHave || []).concat(req.niceToHave || []).some((t) => /portab|light|thin/.test(t))) cons.push(`Heavy at ${product.specs.weightKg}kg`);
  if (cheapest && cheapest.id !== product.id && product.price > cheapest.price) cons.push(`${fmtUsd(product.price - cheapest.price)} more than the cheapest option`);
  if (specChips(product.specs).length === 0) cons.push('Few specs listed by the retailer');
  if (product.price > budget) cons.push(`${fmtUsd(product.price - budget)} over budget`);

  const matches = [];
  if (Number.isFinite(budget) && product.price <= budget) matches.push(`Within your ${fmtUsd(budget)} budget (${fmtUsd(budget - product.price)} to spare)`);
  const brandScore = profile.brand[(product.brand || '').toLowerCase()] || 0;
  if (brandScore >= 1) matches.push(`You've liked ${product.brand} before`);
  if ((req.preferredBrands || []).some((b) => b.toLowerCase() === (product.brand || '').toLowerCase())) matches.push(`Your preferred brand: ${product.brand}`);
  if (profile.dominant && roles.some((r) => r.replace(' alt', '') === profile.dominant)) matches.push(`Matches what you care about most: ${STYLE[profile.dominant]}`);
  if (entry.mustMatched.length) matches.push(`Meets ${entry.mustMatched.length} of your must-haves`);

  return {
    product: publicProduct(product),
    strategies: roles,
    label: roleLabel(roles),
    position: positions.join(' '),
    why: positions[0] || 'Selected by Buypal.',
    pros: pros.slice(0, 4),
    cons: cons.slice(0, 3),
    matches: matches.slice(0, 3),
    verified: { price: !product.demo, rating: Boolean(product.rating), availability: Boolean(product.availability), specs: specChips(product.specs).length > 0, demo: Boolean(product.demo), delivery: Boolean(product.delivery) },
    savingsVsCheapest: cheapest ? Math.max(0, product.price - minP) : 0,
  };
}
