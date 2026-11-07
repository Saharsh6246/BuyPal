import { toUsd } from '../lib/money.js';
import { searchCatalog } from './catalog.js';
import { getProfile } from './preferences.js';
import { buildRecommendations, filterCandidates, plausibleFloor } from './scoring.js';

/** Turns tool/LLM arguments into a clean, bounded requirements object (budget in USD). */
export function normalizeRequirements(args = {}) {
  const list = (value) => (Array.isArray(value) ? value : []).map((v) => String(v).trim().toLowerCase()).filter(Boolean).slice(0, 8);
  const category = String(args.category || '').trim().toLowerCase().replace(/s$/, '').slice(0, 40);
  let budgetMax = null;
  let budgetNote = null;
  if (args.budget_max != null && Number(args.budget_max) > 0) {
    const currency = String(args.currency || 'USD').toUpperCase();
    budgetMax = toUsd(Number(args.budget_max), currency);
    if (budgetMax === null) budgetNote = `Buypal can't convert ${currency} reliably yet, so the budget was ignored.`;
    else if (currency !== 'USD') budgetNote = `Budget converted at an approximate rate (${currency} to USD). Prices are shown in USD.`;
  }
  const mustHave = list(args.must_have);
  return {
    category: category === 'headphone' ? 'headphones' : category,
    query: args.search_query ? String(args.search_query).slice(0, 200) : '',
    budgetMax: budgetMax ? Math.round(budgetMax * 100) / 100 : null,
    mustHave,
    niceToHave: list(args.nice_to_have),
    preferredBrands: list(args.preferred_brands),
    excludedBrands: list(args.excluded_brands),
    allowOverBudget: Boolean(args.allow_over_budget),
    gaming: mustHave.includes('gaming') || list(args.nice_to_have).includes('gaming'),
    budgetNote,
  };
}

function queriesFor(req) {
  const terms = [...req.mustHave, ...req.niceToHave.slice(0, 1)].filter((t) => !/^\d+$/.test(t));
  const specific = req.query || `${terms.slice(0, 3).join(' ')} ${req.category}`.trim();
  const generic = req.category || specific;
  return [...new Set([specific, generic])].filter((q) => q.length >= 2);
}

/** Search + merge results for a requirements object. Throws Channel3Error if the provider is unavailable. */
export async function gatherProducts(req) {
  const ceiling = req.budgetMax ? Math.ceil(req.budgetMax * (req.allowOverBudget ? 1.3 : 1.05)) : undefined;
  const floor = plausibleFloor(req) || undefined;
  const merged = new Map();
  for (const query of queriesFor(req)) {
    const products = await searchCatalog({ query, limit: 30, minPrice: floor, maxPrice: ceiling });
    products.forEach((p) => merged.set(p.id, p));
    if (filterCandidates([...merged.values()], req).pool.length >= 8) break;
  }
  return [...merged.values()];
}

export async function findProducts(userId, req) {
  const products = await gatherProducts(req);
  const profile = getProfile(userId, req.category);
  const result = buildRecommendations(products, req, profile);
  if (req.budgetNote) result.notes.unshift(req.budgetNote);
  return { ...result, profileUsed: { dominant: profile.dominant, budgetSensitivity: profile.budgetSensitivity } };
}
