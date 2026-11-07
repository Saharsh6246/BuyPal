import { googleShoppingEnabled, searchGoogleShopping } from '../providers/googleShopping.js';
import { demoEnabled, getDemoListing, isDemoId, searchDemo } from '../providers/demoStores.js';
import { refreshProduct as refreshChannel3, saveProduct, searchProducts as searchChannel3 } from './channel3.js';

/**
 * One search over every provider, run in parallel:
 *  - Channel3 (real): US retailer catalogue
 *  - Google Shopping via SerpApi (real): offers from many US merchants, when SERPAPI_KEY is set
 *  - Demo store feed (simulated, labelled): everyday items such as groceries
 * A provider failing does not break the search as long as another one returned results.
 */
export async function searchCatalog({ query, limit = 30, minPrice, maxPrice }) {
  const demo = searchDemo({ query, limit: 40, minPrice, maxPrice });
  demo.forEach(saveProduct);

  const [channel3, google] = await Promise.allSettled([
    searchChannel3({ query, limit, minPrice, maxPrice }),
    googleShoppingEnabled() ? searchGoogleShopping({ query, limit, minPrice, maxPrice }) : Promise.resolve([]),
  ]);
  const real = [...(channel3.status === 'fulfilled' ? channel3.value : []), ...(google.status === 'fulfilled' ? google.value : [])];
  if (!real.length && !demo.length) {
    const failure = [channel3, google].find((r) => r.status === 'rejected');
    if (failure) throw failure.reason;
  }

  const merged = new Map();
  [...demo, ...real].forEach((product) => merged.set(product.id, product));
  return [...merged.values()];
}

/** Re-fetches one listing so checkout uses the current price. Demo listings are regenerated deterministically. */
export async function refreshListing(id) {
  if (isDemoId(id)) {
    if (!demoEnabled()) return null;
    const listing = getDemoListing(id);
    if (listing) saveProduct(listing);
    return listing;
  }
  // Google Shopping listings cannot be re-fetched by id (they are search results), so they are re-verified by the
  // caller's freshness window instead; see paypal.verifyCartPrices.
  if (String(id).startsWith('gs:')) return null;
  return refreshChannel3(id);
}
