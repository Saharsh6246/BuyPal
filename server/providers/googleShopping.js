import { createHash } from 'node:crypto';
import { config } from '../config.js';
import { get, run } from '../db.js';
import { roundMoney } from '../lib/money.js';
import { getCachedProducts, saveProduct } from '../services/channel3.js';
import { extractSpecs } from '../services/specs.js';

// Google Shopping through SerpApi: one call returns offers from many US merchants (Amazon, Walmart, Target,
// Best Buy and others). Prices, merchants and ratings are real.
// NOTE: written against SerpApi's documented `shopping_results` shape; verify with a live key (see README).

const ENDPOINT = 'https://serpapi.com/search.json';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // the free plan is small, so results are cached for a day

export const googleShoppingEnabled = () => Boolean(config.serpApiKey);

const parsePrice = (value) => {
  const match = String(value ?? '').replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
};

/** One `shopping_results` entry -> a listing in Buypal's shape. Anything Google did not state stays null. */
export function normalizeShoppingResult(r) {
  if (!r || typeof r !== 'object' || !r.title) return null;
  const price = Number.isFinite(r.extracted_price) ? r.extracted_price : parsePrice(r.price);
  if (!(price > 0)) return null;
  const old = Number.isFinite(r.extracted_old_price) ? r.extracted_old_price : parsePrice(r.old_price);
  const link = [r.link, r.product_link].find((u) => typeof u === 'string' && /^https?:\/\//.test(u)) || '';
  const merchant = String(r.source || '').trim();
  const idSeed = [r.product_id || '', r.title, merchant, price].join('|');
  const rating = Number(r.rating) > 0 && Number(r.reviews) > 0 ? { value: Number(r.rating), count: Number(r.reviews) } : null;
  const searchText = `${r.title}. ${merchant}`;

  return {
    id: `gs:${createHash('sha1').update(idSeed).digest('hex').slice(0, 14)}`,
    groupId: String(r.product_id || r.title),
    name: String(r.title).slice(0, 200),
    brand: '', // Google Shopping results do not state a brand
    image: typeof r.thumbnail === 'string' ? r.thumbnail : '',
    price: roundMoney(price, 'USD'),
    compareAtPrice: old && old > price ? roundMoney(old, 'USD') : null,
    currency: 'USD',
    merchant,
    buyUrl: link,
    availability: null,
    condition: r.second_hand_condition ? 'used' : 'new',
    rating,
    category: null,
    description: '',
    features: [],
    attributes: [],
    searchText: searchText.slice(0, 1000),
    specs: extractSpecs(searchText),
    source: 'Google Shopping',
    demo: false,
    offers: [],
  };
}

const monthKey = () => new Date().toISOString().slice(0, 7);
export function serpApiUsage() {
  const calls = get('SELECT calls FROM provider_usage WHERE provider=? AND month=?', 'serpapi', monthKey())?.calls || 0;
  return { calls, limit: config.serpApiMonthlyLimit, remaining: Math.max(0, config.serpApiMonthlyLimit - calls) };
}

/**
 * Searches Google Shopping (US). Stops calling once the monthly limit is reached so the free plan can never run
 * past its quota, and caches every result for a day.
 */
export async function searchGoogleShopping({ query, limit = 30, minPrice, maxPrice }) {
  if (!googleShoppingEnabled()) return [];
  const clean = String(query || '').trim().slice(0, 200);
  if (clean.length < 2) return [];

  const key = `gs:${createHash('sha1').update(JSON.stringify([clean.toLowerCase(), minPrice ?? null, maxPrice ?? null])).digest('hex')}`;
  const cached = get('SELECT product_ids, fetched_at FROM search_cache WHERE key = ?', key);
  if (cached && Date.now() - cached.fetched_at < CACHE_TTL_MS) {
    const ids = JSON.parse(cached.product_ids);
    const products = getCachedProducts(ids);
    if (products.length === ids.length) return products.slice(0, limit);
  }

  if (serpApiUsage().remaining <= 0) {
    console.warn('SerpApi monthly limit reached; Google Shopping is paused until next month.');
    return [];
  }
  run('INSERT INTO provider_usage (provider, month, calls) VALUES (?,?,1) ON CONFLICT(provider, month) DO UPDATE SET calls = calls + 1', 'serpapi', monthKey());

  const params = new URLSearchParams({ engine: 'google_shopping', q: clean, gl: 'us', hl: 'en', google_domain: 'google.com', api_key: config.serpApiKey });
  if (minPrice != null) params.set('min_price', String(Math.floor(minPrice)));
  if (maxPrice != null) params.set('max_price', String(Math.ceil(maxPrice)));

  let data;
  try {
    const response = await fetch(`${ENDPOINT}?${params}`, { signal: AbortSignal.timeout(25000) });
    data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error(`Google Shopping (SerpApi) failed with HTTP ${response.status}`);
      return [];
    }
  } catch (error) {
    console.error('Google Shopping (SerpApi) request failed:', error.name || 'Error');
    return [];
  }

  const seen = new Set();
  const products = (Array.isArray(data.shopping_results) ? data.shopping_results : [])
    .map(normalizeShoppingResult).filter(Boolean)
    .filter((p) => (seen.has(p.id) ? false : seen.add(p.id)))
    .slice(0, limit);
  products.forEach(saveProduct);
  run('INSERT OR REPLACE INTO search_cache (key, product_ids, fetched_at) VALUES (?,?,?)', key, JSON.stringify(products.map((p) => p.id)), Date.now());
  return products;
}
