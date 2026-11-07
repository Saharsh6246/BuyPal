import { createHash } from 'node:crypto';
import { config } from '../config.js';
import { get, run } from '../db.js';
import { roundMoney } from '../lib/money.js';
import { extractSpecs } from './specs.js';

const API = 'https://api.trychannel3.com/v1';
const SEARCH_TTL_MS = 60 * 60 * 1000;
const NON_BRANDS = new Set(['intel', 'nvidia', 'amd', 'qualcomm', 'google', 'microsoft', 'windows']);

export class Channel3Error extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}

const headers = () => ({ 'content-type': 'application/json', 'x-api-key': config.channel3ApiKey });

function pickOffer(offers) {
  const usable = offers.filter((offer) => offer?.price?.price != null && offer?.price?.currency);
  const inStock = usable.filter((offer) => !/out|sold|discontinued/i.test(offer.availability || ''));
  const pool = (inStock.length ? inStock : usable).filter((offer) => !offer.condition || offer.condition === 'new');
  const candidates = pool.length ? pool : (inStock.length ? inStock : usable);
  return candidates.sort((a, b) => a.price.price - b.price.price)[0] || offers[0] || null;
}

function flattenAttributes(attributes) {
  if (!attributes || typeof attributes !== 'object') return [];
  return Object.entries(attributes).flatMap(([key, value]) =>
    (Array.isArray(value) ? value : [value]).filter((v) => typeof v === 'string').map((v) => `${key.replace(/-/g, ' ')}: ${v}`));
}

/** Normalises a raw Channel3 product. Anything the provider did not return stays null. */
export function normalizeProduct(raw) {
  if (!raw || typeof raw !== 'object' || !raw.id) return null;
  const offers = Array.isArray(raw.offers) ? raw.offers : [];
  const offer = pickOffer(offers);
  const rawPrice = offer?.price?.price;
  const currency = typeof offer?.price?.currency === 'string' ? offer.price.currency.toUpperCase() : '';
  const price = Number.isFinite(Number(rawPrice)) && rawPrice !== null ? roundMoney(Number(rawPrice), currency || 'USD') : null;
  const compare = Number(offer?.price?.compare_at_price);
  const mainImage = (raw.images || []).find((image) => image?.is_main_image) || raw.images?.[0];
  const brand = (raw.brands || []).map((b) => b?.name).find((name) => name && !NON_BRANDS.has(name.toLowerCase())) || raw.brands?.[0]?.name || '';
  const features = Array.isArray(raw.key_features) ? raw.key_features.filter((f) => typeof f === 'string').slice(0, 10) : [];
  const attributes = flattenAttributes(raw.structured_attributes);
  const description = typeof raw.description === 'string' ? raw.description : '';
  const searchText = [raw.title, description, ...features, ...attributes].join(' . ');
  const rating = raw.ratings?.value != null && raw.ratings?.count > 0
    ? { value: Number(raw.ratings.value), count: Number(raw.ratings.count) } : null;

  return {
    id: String(raw.id),
    name: raw.title || 'Product name unavailable',
    brand,
    image: mainImage?.cleaned_url || mainImage?.url || '',
    price,
    compareAtPrice: Number.isFinite(compare) && price !== null && compare > price ? roundMoney(compare, currency || 'USD') : null,
    currency,
    merchant: offer?.domain || '',
    buyUrl: offer?.url || '',
    availability: offer?.availability || null,
    condition: offer?.condition || null,
    rating,
    category: raw.category ? { slug: raw.category.slug || '', title: raw.category.title || '', path: (raw.category.path || []).map((p) => p.title) } : null,
    description: description.slice(0, 700),
    features,
    attributes: attributes.slice(0, 12),
    searchText: searchText.slice(0, 4000),
    specs: extractSpecs(searchText),
    source: 'Channel3',
  };
}

function saveProduct(product) {
  run('INSERT OR REPLACE INTO products (id, json, fetched_at) VALUES (?, ?, ?)', product.id, JSON.stringify(product), Date.now());
}

export function getCachedProduct(id) {
  const row = get('SELECT json, fetched_at FROM products WHERE id = ?', id);
  return row ? { product: JSON.parse(row.json), fetchedAt: row.fetched_at } : null;
}

export function getCachedProducts(ids) {
  return ids.map((id) => getCachedProduct(id)?.product).filter(Boolean);
}

/**
 * Searches Channel3 (cached for an hour to protect API credits). Prices are filtered server-side when a range is given.
 */
export async function searchProducts({ query, limit = 30, minPrice, maxPrice }) {
  if (!config.channel3ApiKey) throw new Channel3Error('Live product search is not set up. Add CHANNEL3_API_KEY to .env.', 503);
  const clean = String(query || '').trim().slice(0, 300);
  if (clean.length < 2) throw new Channel3Error('The search needs at least 2 characters.', 400);

  const key = createHash('sha1').update(JSON.stringify([clean.toLowerCase(), limit, minPrice ?? null, maxPrice ?? null])).digest('hex');
  const cached = get('SELECT product_ids, fetched_at FROM search_cache WHERE key = ?', key);
  if (cached && Date.now() - cached.fetched_at < SEARCH_TTL_MS) {
    const ids = JSON.parse(cached.product_ids);
    const products = getCachedProducts(ids);
    if (products.length === ids.length) return products;
  }

  const body = { query: clean, limit };
  if (minPrice != null || maxPrice != null) {
    body.filters = { price: { ...(minPrice != null ? { min_price: minPrice } : {}), ...(maxPrice != null ? { max_price: maxPrice } : {}) } };
  }
  let response;
  try {
    response = await fetch(`${API}/search`, { method: 'POST', headers: headers(), body: JSON.stringify(body), signal: AbortSignal.timeout(25000) });
  } catch (error) {
    throw new Channel3Error(error.name === 'TimeoutError' ? 'Channel3 search timed out. Please try again.' : 'Could not reach Channel3.');
  }
  if (!response.ok) {
    const message = response.status === 401 || response.status === 403 ? 'Channel3 did not accept the API key.'
      : response.status === 429 ? 'Channel3 rate-limited this search. Try again shortly.'
        : response.status === 402 ? 'Channel3 reports a billing or credit issue for this key.'
          : 'Product search is temporarily unavailable.';
    throw new Channel3Error(message, response.status === 429 ? 429 : 502);
  }
  const data = await response.json().catch(() => ({}));
  const products = (Array.isArray(data.products) ? data.products : []).map(normalizeProduct).filter(Boolean);
  products.forEach(saveProduct);
  run('INSERT OR REPLACE INTO search_cache (key, product_ids, fetched_at) VALUES (?, ?, ?)', key, JSON.stringify(products.map((p) => p.id)), Date.now());
  return products;
}

/** Re-fetches one product so checkout uses the latest verified price. Returns null if it cannot be refreshed. */
export async function refreshProduct(id) {
  if (!config.channel3ApiKey) return null;
  try {
    const response = await fetch(`${API}/products/${encodeURIComponent(id)}`, { headers: headers(), signal: AbortSignal.timeout(15000) });
    if (!response.ok) return null;
    const product = normalizeProduct(await response.json());
    if (product) saveProduct(product);
    return product;
  } catch {
    return null;
  }
}
