import { demoEnabled, getDemoListing, isDemoId, searchDemo } from '../providers/demoStores.js';
import { refreshProduct as refreshChannel3, saveProduct, searchProducts as searchChannel3 } from './channel3.js';

/**
 * One search over every provider: real listings (Channel3) plus the labelled demo store feed.
 * A provider failing does not break the search as long as another one returned results.
 */
export async function searchCatalog({ query, limit = 30, minPrice, maxPrice }) {
  const demo = searchDemo({ query, limit: 40, minPrice, maxPrice });
  demo.forEach(saveProduct);
  let real = [];
  try {
    real = await searchChannel3({ query, limit, minPrice, maxPrice });
  } catch (error) {
    if (!demo.length) throw error;
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
  return refreshChannel3(id);
}
