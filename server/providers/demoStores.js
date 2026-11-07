import { createHash } from 'node:crypto';
import { config } from '../config.js';
import { extractSpecs } from '../services/specs.js';

// ---------------------------------------------------------------------------------------------
// DEMO STORE FEED. Everything in this file is SIMULATED: fictional stores, fictional brands, and
// prices and ratings generated deterministically. It exists so the full comparison
// (best overall, best quality, best price, most loved, best deal) can be demonstrated for everyday items
// that no free, legal API provides (Amazon, Flipkart, Blinkit and Zepto have no public product APIs).
// Every listing is flagged `demo: true` and the UI labels it "Demo data".
// To go live, replace this provider with real adapters that return the same listing shape.
// ---------------------------------------------------------------------------------------------

export const STORES = [
  { id: 'quickcart', name: 'QuickCart', factor: [1.0, 1.08], groups: ['grocery', 'household', 'personal', 'snacks', 'stationery', 'electronics'] },
  { id: 'dashmart', name: 'DashMart', factor: [0.97, 1.05], groups: ['grocery', 'household', 'personal', 'snacks', 'baby'] },
  { id: 'freshslot', name: 'FreshSlot', factor: [0.93, 1.0], groups: ['grocery', 'household', 'personal', 'snacks', 'baby', 'pet'] },
  { id: 'megamarket', name: 'MegaMarket', factor: [0.88, 0.97], groups: ['grocery', 'household', 'personal', 'snacks', 'stationery', 'electronics', 'baby', 'pet', 'kitchen', 'fitness'] },
  { id: 'bazaarhub', name: 'BazaarHub', factor: [0.85, 0.95], groups: ['household', 'personal', 'stationery', 'electronics', 'baby', 'pet', 'kitchen', 'fitness'] },
];

// [key, display name, group, aliases, brands, variants [label, baseInr], attributes]
const TEMPLATES = [
  ['milk', 'Toned Milk', 'grocery', ['milk', 'dairy'], ['Meadowbrook', 'Pure Pasture', 'Kinfolk Dairy'], [['500 ml', 30], ['1 litre', 58]], ['pasteurised', 'fresh']],
  ['butter', 'Salted Butter', 'grocery', ['butter', 'dairy'], ['Meadowbrook', 'Pure Pasture', 'Kinfolk Dairy'], [['100 g', 58], ['500 g', 275]], ['salted', 'dairy']],
  ['eggs', 'Farm Eggs', 'grocery', ['egg', 'eggs'], ['Henhouse', 'Sunrise Farms', 'Goldyolk'], [['6 pack', 54], ['12 pack', 102]], ['farm fresh', 'protein']],
  ['bread', 'Whole Wheat Bread', 'grocery', ['bread', 'loaf'], ['Bakehouse', 'Daily Crumb', 'Millstone'], [['400 g', 48], ['600 g', 62]], ['whole wheat', 'sliced']],
  ['rice', 'Basmati Rice', 'grocery', ['rice', 'basmati'], ['Grainfield', 'Royal Harvest', 'Kisan Gold'], [['1 kg', 130], ['5 kg', 590]], ['long grain', 'aged']],
  ['flour', 'Whole Wheat Flour (Atta)', 'grocery', ['flour', 'atta', 'wheat'], ['Grainfield', 'Millstone', 'Kisan Gold'], [['1 kg', 52], ['5 kg', 245]], ['stone ground', 'whole wheat']],
  ['oil', 'Sunflower Cooking Oil', 'grocery', ['oil', 'cooking'], ['Sunpress', 'Golden Drop', 'Pure Seed'], [['1 litre', 160], ['5 litre', 770]], ['refined', 'cooking']],
  ['tea', 'Assam Tea', 'grocery', ['tea', 'chai'], ['Teaworks', 'Hillside Estate', 'Morning Leaf'], [['250 g', 130], ['500 g', 250]], ['assam', 'strong']],
  ['coffee', 'Instant Coffee', 'grocery', ['coffee'], ['Brewmark', 'Roastery No. 9', 'Ember & Bean'], [['50 g', 160], ['200 g', 590]], ['instant', 'rich']],
  ['biscuits', 'Cream Biscuits', 'snacks', ['biscuit', 'biscuits', 'cookies'], ['Crunchwell', 'Tea Time', 'Oatly Bites'], [['100 g', 20], ['300 g', 52]], ['crispy', 'snack']],
  ['chips', 'Salted Potato Chips', 'snacks', ['chips', 'crisps', 'snack'], ['Crunchwell', 'Spud Co', 'Hearth Snacks'], [['50 g', 20], ['150 g', 55]], ['salted', 'crispy']],
  ['chocolate', 'Milk Chocolate Bar', 'snacks', ['chocolate', 'candy'], ['Cocoa Lane', 'Velvet Cacao', 'Sweetleaf'], [['50 g', 60], ['150 g', 160]], ['milk chocolate', 'sweet']],
  ['noodles', 'Instant Noodles', 'snacks', ['noodles', 'maggi'], ['Slurp', 'Wokhouse', 'NoodleNook'], [['70 g', 15], ['4 pack', 56]], ['instant', 'masala']],
  ['juice', 'Mixed Fruit Juice', 'snacks', ['juice', 'drink'], ['Orchard Press', 'Fruitful', 'Sunsip'], [['200 ml', 25], ['1 litre', 110]], ['no added sugar', 'fruit']],
  ['detergent', 'Liquid Laundry Detergent', 'household', ['detergent', 'laundry', 'washing'], ['Brightwash', 'Fresh Fibre', 'CleanCo'], [['1 litre', 220], ['2 litre', 410]], ['front load', 'top load']],
  ['dishwash', 'Dishwash Liquid', 'household', ['dishwash', 'dish', 'utensil'], ['Sparklr', 'CleanCo', 'LemonPure'], [['500 ml', 95], ['1 litre', 175]], ['lemon', 'grease cutting']],
  ['tissue', 'Facial Tissue Box', 'household', ['tissue', 'tissues', 'napkin'], ['SoftTouch', 'CloudPly', 'PureFold'], [['100 pulls', 55], ['200 pulls', 98]], ['soft', '2 ply']],
  ['garbage bags', 'Garbage Bags', 'household', ['garbage', 'trash', 'bags', 'bin'], ['BinBuddy', 'TidyUp', 'HeavyDuty Co'], [['30 bags', 110], ['60 bags', 195]], ['large', 'leak proof']],
  ['shampoo', 'Anti-Dandruff Shampoo', 'personal', ['shampoo', 'hair'], ['Silkwood', 'Botanica', 'Herbal Roots'], [['180 ml', 170], ['340 ml', 310]], ['anti dandruff', 'daily use']],
  ['toothpaste', 'Fluoride Toothpaste', 'personal', ['toothpaste', 'dental', 'teeth'], ['Brightsmile', 'Denta Pure', 'Minty Fresh'], [['100 g', 70], ['200 g', 125]], ['fluoride', 'cavity protection']],
  ['soap', 'Moisturising Soap', 'personal', ['soap', 'bath'], ['Silkwood', 'Botanica', 'PureBar'], [['3 pack', 120], ['6 pack', 225]], ['moisturising', 'mild']],
  ['sanitizer', 'Hand Sanitizer', 'personal', ['sanitizer', 'sanitiser', 'hand'], ['PureGuard', 'Safeguard Labs', 'CleanCo'], [['100 ml', 60], ['500 ml', 240]], ['alcohol based', 'quick dry']],
  ['charger', 'Fast Phone Charger', 'electronics', ['charger', 'adapter', 'phone', 'charging'], ['Voltix', 'Powerline', 'ChargeWorks'], [['20W USB-C', 599], ['33W USB-C', 899]], ['fast charging', 'usb-c']],
  ['cable', 'USB-C Cable', 'electronics', ['cable', 'usb', 'cord'], ['Voltix', 'Powerline', 'LinkPro'], [['1 m', 249], ['2 m', 349]], ['braided', 'fast charging']],
  ['earphones', 'Wired Earphones', 'electronics', ['earphones', 'earphone', 'earbuds', 'headphones'], ['Soundmark', 'Auralite', 'Beatbox'], [['with mic', 499], ['noise isolating', 799]], ['wired', 'with mic']],
  ['power bank', 'Power Bank', 'electronics', ['power', 'bank', 'powerbank'], ['Voltix', 'Powerline', 'ChargeWorks'], [['10000 mAh', 1099], ['20000 mAh', 1799]], ['fast charging', 'dual output']],
  ['notebook', 'Ruled Notebook', 'stationery', ['notebook', 'notebooks', 'diary', 'copy'], ['Paperly', 'Inkwell', 'Scribe & Co'], [['single', 80], ['pack of 5', 360]], ['ruled', 'a4']],
  ['pens', 'Ball Pens', 'stationery', ['pen', 'pens', 'ballpen'], ['Inkwell', 'Scribe & Co', 'Glidewrite'], [['10 pack', 90], ['25 pack', 210]], ['blue ink', 'smooth']],
  ['diapers', 'Baby Diapers', 'baby', ['diaper', 'diapers', 'baby', 'nappy'], ['Tiny Steps', 'SoftNest', 'Cuddle Care'], [['medium 40', 649], ['large 40', 699]], ['overnight', 'sensitive skin']],
  ['dog food', 'Dry Dog Food', 'pet', ['dog', 'pet', 'puppy'], ['Barkwell', 'Pawfect', 'Wholesome Pet'], [['1 kg', 350], ['3 kg', 950]], ['adult', 'high protein']],
  ['water bottle', 'Steel Water Bottle', 'kitchen', ['bottle', 'water', 'flask'], ['Hydra', 'Steelmate', 'Chillkeep'], [['750 ml', 399], ['1 litre', 549]], ['stainless steel', 'leak proof']],
  ['lunch box', 'Insulated Lunch Box', 'kitchen', ['lunch', 'tiffin', 'box'], ['Steelmate', 'Chillkeep', 'Homestyle'], [['2 container', 449], ['3 container', 599]], ['insulated', 'leak proof']],
  ['yoga mat', 'Yoga Mat', 'fitness', ['yoga', 'mat', 'exercise'], ['Flexora', 'Zenfit', 'Groundwork'], [['4 mm', 599], ['6 mm', 799]], ['anti slip', 'non toxic']],
];

const STOP = new Set(['a', 'an', 'the', 'for', 'and', 'or', 'with', 'in', 'of', 'me', 'my', 'i', 'want', 'need', 'buy', 'get', 'some', 'please', 'under', 'below', 'within', 'delivered', 'delivery', 'deliver', 'minutes', 'minute', 'min', 'mins', 'hour', 'hours', 'fast', 'quick', 'quickly', 'instant', 'instantly', 'now', 'asap', 'urgent', 'urgently', 'today', 'tonight', 'cheap', 'cheapest', 'best', 'good', 'quality', 'to', 'at', 'on', 'it', 'is', 'that', 'this', 'one', 'pack', 'online', 'rs', 'inr', 'usd', 'rupees', 'dollars']);

const slug = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const hash01 = (...parts) => parseInt(createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 8), 16) / 0xffffffff;
const between = (range, seed) => range[0] + (range[1] - range[0]) * seed;
const singular = (word) => (word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word);

function placeholderImage(text, tint) {
  const initials = text.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" fill="${tint}"/><text x="100" y="118" text-anchor="middle" font-family="Georgia,serif" font-size="64" fill="#1c1b18" opacity="0.55">${initials}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const TINTS = { grocery: '#efe6cf', snacks: '#f1dfc8', household: '#dfe8e2', personal: '#e8e0ea', electronics: '#dde3ea', stationery: '#ece7d6', baby: '#f1e3e3', pet: '#e6ebd8', kitchen: '#e4e4e0', fitness: '#dbe9e6' };

function buildCatalog() {
  const skus = [];
  const listings = new Map();
  const inrPerUsd = config.inrPerUsd;

  for (const [key, baseName, group, aliases, brands, variants, attributes] of TEMPLATES) {
    brands.forEach((brand, bi) => {
      const brandQuality = 0.35 + hash01('brand', brand) * 0.6; // 0.35..0.95
      variants.forEach(([variantLabel, baseInr]) => {
        const skuId = `${slug(key)}-${slug(brand)}-${slug(variantLabel)}`;
        const name = `${brand} ${baseName} ${variantLabel}`;
        const brandPriceFactor = 0.9 + brandQuality * 0.35;
        const ratingValue = Math.round((3.5 + brandQuality * 1.2 + (hash01('r', skuId) - 0.5) * 0.3) * 10) / 10;
        const ratingCount = Math.round(40 + hash01('c', skuId) * 4800);
        const searchText = `${name}. ${aliases.join(' ')} ${attributes.join(' ')} ${group} ${brand}`;
        const stocked = [];
        for (const store of STORES) {
          if (!store.groups.includes(group)) continue;
          if (hash01('stock', skuId, store.id) < 0.12) continue; // not every store carries every item
          const factor = between(store.factor, hash01('price', skuId, store.id));
          const priceInr = Math.max(5, Math.round(baseInr * brandPriceFactor * factor));
          const onSale = hash01('sale', skuId, store.id) < 0.25;
          const regularInr = onSale ? Math.round(priceInr / (1 - (0.08 + hash01('pct', skuId, store.id) * 0.17))) : null;
          stocked.push({ store, priceInr, regularInr });
        }
        if (!stocked.length) return;
        const offers = stocked.map((s) => ({
          merchant: s.store.name,
          price: Math.round((s.priceInr / inrPerUsd) * 100) / 100,
          priceInr: s.priceInr,
          currency: 'USD',
          url: '',
          availability: 'InStock',
          condition: 'new',
          demo: true,
        })).sort((a, b) => a.price - b.price);
        skus.push({ skuId, key, aliasSet: new Set([...aliases, ...key.split(' '), ...baseName.toLowerCase().split(/\s+/)]), searchTokens: new Set(searchText.toLowerCase().match(/[a-z0-9]+/g)), group });

        for (const s of stocked) {
          const id = `demo:${skuId}@${s.store.id}`;
          const price = Math.round((s.priceInr / inrPerUsd) * 100) / 100;
          listings.set(id, {
            id,
            groupId: skuId,
            name,
            brand,
            image: placeholderImage(`${brand} ${baseName}`, TINTS[group] || '#eee'),
            price,
            priceInr: s.priceInr,
            compareAtPrice: s.regularInr ? Math.round((s.regularInr / inrPerUsd) * 100) / 100 : null,
            currency: 'USD',
            merchant: s.store.name,
            buyUrl: '',
            availability: 'InStock',
            condition: 'new',
            rating: { value: Math.min(4.9, ratingValue), count: ratingCount },
            category: { slug: slug(key), title: baseName, path: ['Everyday essentials', group, baseName] },
            description: `${baseName} (${variantLabel}) by ${brand}. Simulated demo listing.`,
            features: attributes,
            attributes: [`size: ${variantLabel}`],
            searchText,
            specs: extractSpecs(searchText),
            source: 'Demo',
            demo: true,
            offers,
          });
        }
      });
    });
  }
  return { skus, listings };
}

let cached = null;
const catalog = () => (cached ||= buildCatalog());

export const demoEnabled = () => process.env.DEMO_STORES !== 'off';

/** Returns simulated listings that match the query (all stores that carry each matching item). */
export function searchDemo({ query, limit = 40, minPrice, maxPrice }) {
  if (!demoEnabled()) return [];
  const tokens = String(query || '').toLowerCase().match(/[a-z0-9]+/g)?.map(singular).filter((t) => !STOP.has(t) && t.length > 1) || [];
  if (!tokens.length) return [];
  const { skus, listings } = catalog();

  // A template must match on a head noun (alias / name word); other tokens only rank within it.
  const templateScore = new Map();
  for (const sku of skus) {
    const hits = tokens.filter((t) => sku.aliasSet.has(t) || sku.aliasSet.has(`${t}s`)).length;
    if (hits) templateScore.set(sku.key, Math.max(templateScore.get(sku.key) || 0, hits));
  }
  if (!templateScore.size) return [];
  const best = Math.max(...templateScore.values());
  const keys = new Set([...templateScore].filter(([, score]) => score === best).map(([key]) => key));

  const matched = skus.filter((sku) => keys.has(sku.key))
    .map((sku) => ({ sku, rank: tokens.filter((t) => sku.searchTokens.has(t)).length }))
    .sort((a, b) => b.rank - a.rank);

  const out = [];
  for (const { sku } of matched) {
    for (const listing of listings.values()) {
      if (listing.groupId !== sku.skuId) continue;
      if (minPrice != null && listing.price < minPrice) continue;
      if (maxPrice != null && listing.price > maxPrice) continue;
      out.push(listing);
    }
    if (out.length >= limit) break;
  }
  return out.slice(0, limit);
}

export const getDemoListing = (id) => catalog().listings.get(id) || null;
export const isDemoId = (id) => String(id).startsWith('demo:');
