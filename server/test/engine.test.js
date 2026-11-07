import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.DB_PATH = ':memory:';
const { extractSpecs, performanceScore } = await import('../services/specs.js');
const { parseBudget, parseRequirements, heuristicPlan } = await import('../services/intent.js');
const { buildRecommendations, matchTerm } = await import('../services/scoring.js');
const { optimizeSelection, allocateShares, templateFor } = await import('../services/setupBuilder.js');
const { normalizeProduct } = await import('../services/channel3.js');
const { recordEvent, getProfile, setPreference, resetPreferences } = await import('../services/preferences.js');
const { normalizeRequirements } = await import('../services/recommend.js');
const { setPriority, getPriority, describeProfile } = await import('../services/preferences.js');
const { recordSearch, getInterests } = await import('../services/interests.js');

const laptop = (id, name, price, extra = {}) => ({
  id, name, brand: extra.brand || 'Acme', price, currency: 'USD', compareAtPrice: null, availability: 'InStock',
  rating: extra.rating === undefined ? { value: 4.4, count: 200 } : extra.rating,
  category: { slug: 'laptops', title: 'Laptops', path: ['Electronics', 'Laptops'] },
  features: [], attributes: [], description: '', image: '', merchant: 'shop.example', buyUrl: 'https://shop.example/p',
  searchText: extra.text || name, specs: extractSpecs(extra.text || name),
});

test('specs: extracts only what the listing states', () => {
  const s = extractSpecs('15.6" 144Hz laptop, Intel Core i7-13700H, RTX 4060, 16GB DDR5 RAM, 1TB NVMe SSD, up to 8 hours battery, weighs 2.1 kg');
  assert.equal(s.ramGb, 16);
  assert.equal(s.storageGb, 1000);
  assert.equal(s.refreshHz, 144);
  assert.equal(s.gpu, 'RTX 4060');
  assert.equal(s.batteryHours, 8);
  assert.equal(s.weightKg, 2.1);
  const empty = extractSpecs('A nice laptop');
  assert.equal(empty.ramGb, null);
  assert.equal(empty.gpu, null);
  assert.equal(performanceScore(empty), null);
});

test('intent: budget parsing handles rupees, lakh and dollars', () => {
  assert.deepEqual(parseBudget('under ₹80,000'), { amount: 80000, currency: 'INR' });
  assert.deepEqual(parseBudget('budget is ₹1,00,000'), { amount: 100000, currency: 'INR' });
  assert.deepEqual(parseBudget('gaming setup under 1 lakh'), { amount: 100000, currency: 'INR' });
  assert.deepEqual(parseBudget('a mouse under $30'), { amount: 30, currency: 'USD' });
  assert.equal(parseBudget('laptop with 16GB RAM'), null);
});

test('intent: extracts category, requirements and brands', () => {
  const r = parseRequirements('gaming laptop for college, no acer, I like lenovo, under $900');
  assert.equal(r.category, 'laptop');
  assert.ok(r.must_have.includes('gaming'));
  assert.ok(r.nice_to_have.includes('lightweight'));
  assert.deepEqual(r.excluded_brands, ['acer']);
  assert.deepEqual(r.preferred_brands, ['lenovo']);
  assert.equal(r.budget_max, 900);
});

test('intent: routes messages to the right action', () => {
  assert.equal(heuristicPlan('Build me a complete gaming setup under ₹1,00,000').type, 'setup');
  assert.equal(heuristicPlan('lightweight laptop under $700').type, 'search');
  assert.equal(heuristicPlan('hello').type, 'chat');
  const edit = heuristicPlan('Replace the mouse with a wireless one and reduce the total cost by ₹2,000', { cartItems: 5 });
  assert.equal(edit.type, 'edit');
  assert.deepEqual(edit.steps.map((s) => s.action), ['replace_item', 'reduce_total']);
});

test('scoring: a gaming computer needs evidence, not just the word "gaming"', () => {
  const real = laptop('a', 'Pro Gaming Laptop', 800, { text: 'Gaming laptop RTX 4060 16GB RAM 144Hz' });
  const fake = laptop('b', 'Super Gaming Laptop', 500, { text: 'Gaming laptop thin' });
  assert.equal(matchTerm('gaming', real), true);
  assert.equal(matchTerm('gaming', fake), false);
});

test('scoring: respects budget, dedupes strategies and never invents data', () => {
  const products = [
    laptop('a', 'Basic Laptop 8GB RAM', 400, { rating: { value: 4.0, count: 100 }, text: 'Laptop Intel Core i3 8GB RAM 256GB SSD' }),
    laptop('b', 'Mid Laptop 16GB RAM', 650, { rating: { value: 4.6, count: 500 }, text: 'Laptop Intel Core i5 16GB RAM 512GB SSD' }),
    laptop('c', 'Top Laptop 32GB RAM', 880, { rating: { value: 4.5, count: 300 }, text: 'Laptop Intel Core i7 32GB RAM 1TB SSD RTX 4060' }),
    laptop('d', 'Luxury Laptop 64GB RAM', 2400, { text: 'Laptop Core i9 64GB RAM 2TB SSD RTX 4090' }),
    laptop('e', 'Unrated Laptop', 450, { rating: null, text: 'Laptop' }),
  ];
  const { cards } = buildRecommendations(products, { category: 'laptop', budgetMax: 900, mustHave: [], niceToHave: [] });
  assert.ok(cards.length >= 1 && cards.length <= 4);
  const ids = cards.map((c) => c.product.id);
  assert.equal(new Set(ids).size, ids.length, 'each product appears once');
  assert.ok(!ids.includes('d'), 'over-budget product excluded');
  const budget = cards.find((c) => c.strategies.includes('Budget'));
  assert.equal(budget.product.id, 'a');
  const premium = cards.find((c) => c.strategies.includes('Premium'));
  assert.equal(premium.product.id, 'c');
  const unrated = buildRecommendations([products[4]], { category: 'laptop', budgetMax: 900, mustHave: [], niceToHave: [] }).cards[0];
  assert.ok(unrated.cons.some((c) => /No buyer ratings/.test(c)), 'missing rating is disclosed');
  assert.equal(unrated.verified.rating, false);
});

test('scoring: personalization changes ordering and adds a runner-up for the dominant style', () => {
  const products = [
    laptop('a', 'Basic Laptop', 400, { text: 'Laptop Core i3 8GB RAM' }),
    laptop('a2', 'Basic Laptop Two', 420, { text: 'Laptop Core i3 8GB RAM 256GB SSD' }),
    laptop('b', 'Mid Laptop', 650, { text: 'Laptop Core i5 16GB RAM 512GB SSD' }),
    laptop('c', 'Top Laptop', 880, { text: 'Laptop Core i7 32GB RAM 1TB SSD RTX 4060' }),
  ];
  const req = { category: 'laptop', budgetMax: 900, mustHave: [], niceToHave: [] };
  const profile = { brand: {}, strategy: { Budget: 4, Smart: 0, Premium: 0 }, budgetSensitivity: 1, dominant: 'Budget' };
  const { cards } = buildRecommendations(products, req, profile);
  assert.equal(cards[0].strategies[0], 'Budget', 'preferred strategy first');
  assert.ok(cards.some((c) => c.strategies.includes('Budget alt')), 'second budget-style option offered');
});

test('optimizer: trims to budget and never exceeds it', () => {
  const opt = (id, price, composite) => ({ product: { id, price }, composite });
  const slots = [
    { quantity: 1, cap: 600, options: [opt('l1', 900, 0.9), opt('l2', 600, 0.7), opt('l3', 400, 0.5)] },
    { quantity: 1, cap: 200, options: [opt('m1', 300, 0.8), opt('m2', 150, 0.6)] },
  ];
  const result = optimizeSelection(slots, 700);
  assert.equal(result.withinBudget, true);
  assert.ok(result.total <= 700);
  const impossible = optimizeSelection(slots, 300);
  assert.equal(impossible.withinBudget, false, 'reports when the budget cannot be met');
});

test('setup: shares sum to one and templates are detected', () => {
  const shares = allocateShares([{ category: 'laptop' }, { category: 'mouse' }, { category: 'monitor', share: 0.2 }]);
  assert.ok(Math.abs(shares.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.equal(templateFor('complete gaming setup'), 'gaming');
  assert.equal(templateFor('something else'), null);
});

test('channel3: normalisation keeps unavailable data as null and verified discounts only', () => {
  const p = normalizeProduct({
    id: 'X1', title: 'Test Mouse', brands: [{ name: 'Intel' }, { name: 'Logi' }],
    offers: [{ url: 'https://x', domain: 'shop.com', availability: 'InStock', condition: 'new', price: { price: 10, compare_at_price: 20, currency: 'usd' } }],
  });
  assert.equal(p.brand, 'Logi');
  assert.equal(p.price, 10);
  assert.equal(p.compareAtPrice, 20);
  assert.equal(p.rating, null);
  assert.equal(p.currency, 'USD');
  const noPrice = normalizeProduct({ id: 'X2', title: 'No price', offers: [] });
  assert.equal(noPrice.price, null);
  assert.equal(normalizeProduct(null), null);
});

test('preferences: learn, correct, reset; category scope counts fully, global half', () => {
  const user = 'test-user-prefs-1';
  const product = { id: 'p1', name: 'P', brand: 'Lenovo' };
  recordEvent(user, { type: 'select', product, strategy: 'Budget', category: 'laptop' });
  recordEvent(user, { type: 'select', product, strategy: 'Budget', category: 'laptop' });
  recordEvent(user, { type: 'reject', product: { ...product, brand: 'Acer' }, strategy: 'Premium', reason: 'too_expensive', category: 'laptop' });
  const laptopProfile = getProfile(user, 'laptop');
  assert.ok(laptopProfile.strategy.Budget > getProfile(user, 'mouse').strategy.Budget, 'category preference is stronger than global');
  assert.ok(getProfile(user, 'mouse').strategy.Budget > 0, 'global preference carries over at half weight');
  assert.ok(laptopProfile.budgetSensitivity > 0);
  setPreference(user, 'global', 'brand', 'Lenovo', 0);
  assert.equal(getProfile(user, null).brand.lenovo, undefined);
  resetPreferences(user);
  assert.equal(getProfile(user, 'laptop').strategy.Budget, 0);
});

test('requirements: INR budgets are converted and flagged as approximate', () => {
  const req = normalizeRequirements({ category: 'Laptops', budget_max: 85000, currency: 'INR' });
  assert.equal(req.category, 'laptop');
  assert.ok(req.budgetMax > 900 && req.budgetMax < 1100);
  assert.match(req.budgetNote, /approximate/);
  const unknown = normalizeRequirements({ category: 'laptop', budget_max: 500, currency: 'XYZ' });
  assert.equal(unknown.budgetMax, null, 'unknown currency is never guessed');
});

test('priority: the governing factor shapes the profile and can be changed', () => {
  const user = 'test-user-priority-1';
  assert.equal(getPriority(user), null);
  setPriority(user, 'price');
  let profile = getProfile(user, 'laptop');
  assert.equal(profile.dominant, 'Budget');
  assert.ok(profile.budgetSensitivity > 0);
  setPriority(user, 'quality');
  profile = getProfile(user, 'laptop');
  assert.equal(profile.dominant, 'Premium');
  assert.ok(profile.budgetSensitivity < 0);
  assert.throws(() => setPriority(user, 'cheapest-ever'));
  assert.match(describeProfile(user).join(' '), /best quality/i);
  resetPreferences(user);
  assert.equal(getPriority(user), 'quality', 'resetting learned preferences keeps the explicit priority');
});

test('interests: searches and choices build a ranked, explainable interest list', () => {
  const user = 'test-user-interests-1';
  recordSearch(user, { query: 'gaming laptop', category: 'laptop', budgetUsd: 900 });
  recordSearch(user, { query: 'laptop for college', category: 'laptop', budgetUsd: 700 });
  recordSearch(user, { query: 'wireless mouse', category: 'mouse', budgetUsd: 25 });
  recordEvent(user, { type: 'purchase', product: { id: 'x', name: 'x', brand: 'a' }, strategy: 'Smart', category: 'laptop' });
  const { interests, recent } = getInterests(user);
  assert.equal(interests[0].category, 'laptop');
  assert.equal(interests[0].typicalBudget, 700);
  assert.equal(interests[1].category, 'mouse');
  assert.ok(recent.includes('wireless mouse'));
  resetPreferences(user);
  assert.equal(getInterests(user).interests.length, 0, 'reset clears the remembered searches');
});

test('labels: cards use plain names for the three strategies', () => {
  const products = [
    laptop('a', 'Basic Laptop', 400, { text: 'Laptop Core i3 8GB RAM' }),
    laptop('c', 'Top Laptop', 880, { text: 'Laptop Core i7 32GB RAM 1TB SSD RTX 4060' }),
  ];
  const { cards } = buildRecommendations(products, { category: 'laptop', budgetMax: 900, mustHave: [], niceToHave: [] });
  const labels = cards.map((c) => c.label).join(' ');
  assert.match(labels, /Best price/);
  assert.match(labels, /Best quality/);
});
