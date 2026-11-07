import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.DB_PATH = ':memory:';
process.env.SERPAPI_KEY = '';
const { normalizeShoppingResult, searchGoogleShopping, googleShoppingEnabled, serpApiUsage } = await import('../providers/googleShopping.js');
const { buildRecommendations } = await import('../services/scoring.js');
const { normalizeRequirements } = await import('../services/recommend.js');

// Fixture in the documented SerpApi `shopping_results` shape (to be confirmed against a live response).
const sample = {
  position: 1, title: 'Anker 20W USB-C Fast Charger', source: 'Amazon.com', product_id: '123',
  link: 'https://www.amazon.com/dp/B0TEST', price: '$11.99', extracted_price: 11.99, old_price: '$15.99', extracted_old_price: 15.99,
  rating: 4.7, reviews: 18234, thumbnail: 'https://img.example/charger.jpg',
};

test('google shopping: normalises a result without inventing missing data', () => {
  const p = normalizeShoppingResult(sample);
  assert.equal(p.price, 11.99);
  assert.equal(p.compareAtPrice, 15.99);
  assert.equal(p.merchant, 'Amazon.com');
  assert.equal(p.source, 'Google Shopping');
  assert.equal(p.demo, false);
  assert.deepEqual(p.rating, { value: 4.7, count: 18234 });
  assert.equal(p.brand, '', 'brand is not stated by Google, so it is left empty');
  assert.equal(p.availability, null);
  assert.equal(p.delivery, undefined, 'delivery is not modelled');
  assert.match(p.id, /^gs:/);
  assert.equal(normalizeShoppingResult({ title: 'No price' }), null);
  assert.equal(normalizeShoppingResult({ price: '$5' }), null);
  assert.equal(normalizeShoppingResult({ ...sample, link: 'javascript:alert(1)', product_link: undefined }).buyUrl, '', 'only http(s) links are kept');
  assert.equal(normalizeShoppingResult({ ...sample, rating: undefined, reviews: undefined }).rating, null);
});

test('google shopping: without a key it is off and makes no calls', async () => {
  assert.equal(googleShoppingEnabled(), false);
  assert.deepEqual(await searchGoogleShopping({ query: 'charger' }), []);
  assert.equal(serpApiUsage().calls, 0);
});

test('google shopping: results flow through the buckets with their real merchants and links', () => {
  const real = [
    normalizeShoppingResult(sample),
    normalizeShoppingResult({ ...sample, title: 'Belkin 20W USB-C Charger', source: 'Walmart', price: '$13.50', extracted_price: 13.5, extracted_old_price: undefined, old_price: undefined, rating: 4.4, reviews: 900, link: 'https://www.walmart.com/ip/1' }),
  ];
  const { cards } = buildRecommendations(real, normalizeRequirements({ category: 'charger' }));
  assert.ok(cards.length >= 1);
  assert.ok(cards.every((c) => c.product.source === 'Google Shopping' && /^https:\/\//.test(c.product.buyUrl)));
  assert.ok(cards.some((c) => c.product.merchant === 'Amazon.com'));
});
