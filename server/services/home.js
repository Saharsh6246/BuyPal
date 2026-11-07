import { fmtUsd } from '../lib/money.js';
import { getInterests } from './interests.js';
import { getPriority, getProfile } from './preferences.js';
import { gatherProducts, normalizeRequirements } from './recommend.js';
import { buildRecommendations, filterCandidates, publicProduct } from './scoring.js';

// Personalised home feed: "picked for you" (best match for the user's priority in the categories they
// searched) and "deals" (verified discounts vs the listed regular price). All from real listings.

const STARTER_CATEGORIES = ['milk', 'phone charger', 'headphones'];
const PRIORITY_ROLE = { price: 'Budget', quality: 'Premium', balanced: 'Smart', speed: 'Fastest' };
const TTL_MS = 10 * 60 * 1000;
const cache = new Map();

const join = (items) => (items.length <= 1 ? items[0] || '' : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

export async function buildHome(userId) {
  const { interests, recent } = getInterests(userId);
  const priority = getPriority(userId);
  const personalised = interests.length > 0;
  const targets = (personalised ? interests : STARTER_CATEGORIES.map((category) => ({ category, typicalBudget: null }))).slice(0, 3);

  const key = JSON.stringify([userId, priority, targets.map((t) => [t.category, Math.round(t.typicalBudget || 0)])]);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return { ...hit.data, recent };

  const forYou = [];
  const dealPool = new Map();
  await Promise.all(targets.map(async ({ category, typicalBudget }) => {
    const req = normalizeRequirements({ category, budget_max: typicalBudget ? Math.ceil(typicalBudget * 1.15) : null, currency: 'USD' });
    let products;
    try { products = await gatherProducts(req); } catch { return; }
    const profile = getProfile(userId, category);
    const { cards } = buildRecommendations(products, req, profile);
    const role = PRIORITY_ROLE[priority] || 'Smart';
    const pick = cards.find((c) => c.strategies.includes(role)) || cards[0];
    if (pick) forYou.push({ category, product: pick.product, label: pick.label, reason: pick.position.split('. ')[0].replace(/\.$/, '') });
    for (const product of filterCandidates(products, req).pool) {
      if (product.compareAtPrice && product.price <= (req.budgetMax ?? Infinity)) dealPool.set(product.id, { category, product });
    }
  }));

  const order = new Map(targets.map((t, i) => [t.category, i]));
  forYou.sort((a, b) => order.get(a.category) - order.get(b.category));
  const deals = [...dealPool.values()]
    .map(({ category, product }) => ({ category, product: publicProduct(product), pct: Math.round((1 - product.price / product.compareAtPrice) * 100) }))
    // Only credible deals: a real rating, and a markdown that is not implausibly large (inflated "regular" prices are common).
    .filter((d) => d.pct >= 12 && d.pct <= 40 && d.product.rating && d.product.rating.value >= 3.8 && d.product.rating.count >= 5)
    .sort((a, b) => b.pct - a.pct).slice(0, 8)
    .map((d) => ({ category: d.category, product: d.product, label: `${d.pct}% off`, reason: `${fmtUsd(d.product.compareAtPrice - d.product.price)} below the listed regular price` }));

  const names = join(targets.map((t) => t.category));
  const data = {
    personalised,
    priority,
    interests: targets.map((t) => t.category),
    sections: [
      forYou.length && {
        id: 'for-you',
        title: personalised ? 'Picked for you' : 'A good place to start',
        subtitle: personalised ? `Because you've been looking at ${names}${priority ? ', ranked by your priority' : ''}.` : 'Popular categories. Search anything to start teaching Buypal your taste.',
        items: forYou,
      },
      deals.length && {
        id: 'deals',
        title: 'Deals worth a look',
        subtitle: `Verified markdowns on ${names}, from the retailer's own regular price.`,
        items: deals,
      },
    ].filter(Boolean),
  };
  cache.set(key, { at: Date.now(), data });
  return { ...data, recent };
}
