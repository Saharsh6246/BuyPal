import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.DB_PATH = ':memory:';
const { searchDemo, getDemoListing, isDemoId, STORES } = await import('../providers/demoStores.js');
const { buildRecommendations } = await import('../services/scoring.js');
const { parseRequirements, heuristicPlan } = await import('../services/intent.js');
const { recordEvent, getProfile, setPriority } = await import('../services/preferences.js');
const { getUserModel } = await import('../services/insights.js');
const { normalizeRequirements } = await import('../services/recommend.js');
const { parseSize } = await import('../services/specs.js');

const reqFor = (args) => normalizeRequirements(args);
const item = (id, name, price, rating, extra = {}) => ({
  id, name, brand: extra.brand ?? 'Acme', price, currency: 'USD', compareAtPrice: extra.compareAt ?? null, availability: 'InStock',
  rating, category: null, description: '', features: [], attributes: [], searchText: extra.text ?? name, specs: {}, image: '', merchant: 'shop.example',
  buyUrl: 'https://shop.example/p', offers: [], source: 'Channel3', demo: false,
});
const labels = (cards) => cards.map((c) => c.label).join(' | ');

test('demo feed: every listing is flagged as simulated, stable and uses fictional stores', () => {
  const a = searchDemo({ query: 'salted butter' });
  const b = searchDemo({ query: 'salted butter' });
  assert.ok(a.length > 5);
  assert.deepEqual(a.map((l) => [l.id, l.price]), b.map((l) => [l.id, l.price]), 'deterministic');
  for (const l of a) {
    assert.equal(l.demo, true);
    assert.equal(l.source, 'Demo');
    assert.ok(isDemoId(l.id));
    assert.equal(l.buyUrl, '', 'no fake retailer link');
    assert.equal(l.delivery, undefined, 'no delivery data is modelled');
    assert.ok(STORES.some((s) => s.name === l.merchant));
  }
  assert.equal(getDemoListing(a[0].id).price, a[0].price, 'a listing can be re-verified by id at checkout');
  assert.equal(searchDemo({ query: 'qwertyuiop nonsense' }).length, 0);
});

test('parsing: pack size and budget do not get confused', () => {
  const r = parseRequirements('I need salted butter 500g, under 15 dollars');
  assert.equal(r.budget_max, 15);
  assert.deepEqual(r.must_have, ['500 g']);
  assert.equal(r.category, 'butter');
  assert.equal(parseRequirements('milk within 15 minutes').budget_max, null, '15 minutes is not a budget');
  assert.deepEqual(parseSize('Butter 1 kg'), { unit: 'g', qty: 1000 });
  assert.equal(heuristicPlan('hello there').type, 'chat');
  assert.equal(heuristicPlan('organic honey 250g').type, 'search');
});

test('buckets: a requested size is honoured and sizes are never mixed', () => {
  const products = searchDemo({ query: 'rice' });
  const sized = buildRecommendations(products, reqFor({ category: 'rice', must_have: ['5 kg'] }));
  assert.ok(sized.cards.length >= 1);
  for (const c of sized.cards) assert.deepEqual(parseSize(c.product.name), { unit: 'g', qty: 5000 });
  const unsized = buildRecommendations(products, reqFor({ category: 'rice' }));
  assert.equal(new Set(unsized.cards.map((c) => parseSize(c.product.name).qty)).size, 1, 'one comparable pack size');
  assert.ok(unsized.notes.some((n) => /most widely stocked size/.test(n)));
});

test('buckets: the three styles plus most loved, best deal and picked for you', () => {
  const products = [
    item('a', 'Basic', 400, { value: 4.0, count: 100 }, { text: 'Core i3 8GB RAM' }),
    item('b', 'Loved', 650, { value: 4.7, count: 900 }, { text: 'Core i5 16GB RAM' }),
    item('c', 'Powerful', 880, { value: 4.4, count: 200 }, { text: 'Core i7 32GB RAM RTX 4060' }),
    item('d', 'Markdown', 500, { value: 4.3, count: 80 }, { compareAt: 800, text: 'Core i5 8GB RAM' }),
    item('e', 'Brand fan', 610, { value: 4.1, count: 60 }, { brand: 'Lenovo', text: 'Core i5 8GB RAM' }),
  ];
  const req = reqFor({ category: 'laptop', budget_max: 900, currency: 'USD' });
  const profile = { brand: { lenovo: 2 }, strategy: { Budget: 0, Smart: 0, Premium: 0 }, budgetSensitivity: 0, dominant: null, tally: {} };
  const { cards } = buildRecommendations(products, req, profile);
  const all = labels(cards);
  for (const expected of ['Best overall', 'Best quality', 'Best price', 'Picked for you']) assert.match(all, new RegExp(expected), `${expected} in: ${all}`);
  assert.ok(cards.length <= 5, 'never more than five cards');
  const ids = cards.map((c) => c.product.id);
  assert.equal(new Set(ids).size, ids.length, 'one card per product');
  const personal = cards.find((c) => c.strategies.includes('Personal'));
  assert.equal(personal.product.brand, 'Lenovo');
  assert.match(personal.position, /you have liked Lenovo/);
});

test('buckets: most loved needs many reviews and best deal needs a credible markdown', () => {
  const noEvidence = [
    item('u1', 'Unrated', 300, null, { text: 'Core i5' }),
    item('u2', 'Few reviews', 320, { value: 5.0, count: 3 }, { text: 'Core i5' }),
    item('u3', 'Fake sale', 340, { value: 4.5, count: 400 }, { compareAt: 1400, text: 'Core i5' }), // 76% off: not credible
  ];
  const { cards, basketPlan } = buildRecommendations(noEvidence, reqFor({ category: 'laptop' }));
  assert.ok(!/Most loved/.test(labels(cards)) || cards.find((c) => c.strategies.includes('Loved')).product.id === 'u3');
  assert.ok(!/Best deal/.test(labels(cards)), 'an implausible 76% markdown is never a "deal"');
  assert.match(basketPlan.lines.join(' '), /Best deal \(no well-rated product/);

  const withDeal = [
    item('v1', 'Regular', 500, { value: 4.2, count: 300 }, { text: 'Core i5' }),
    item('v2', 'On sale', 420, { value: 4.4, count: 120 }, { compareAt: 560, text: 'Core i5' }), // 25% off
  ];
  const deal = buildRecommendations(withDeal, reqFor({ category: 'laptop' })).cards.find((c) => c.strategies.includes('Deal'));
  assert.equal(deal.product.id, 'v2');
  assert.match(deal.position, /25% below the listed regular price/);
});

test('buckets: they re-arrange as the shopper keeps choosing one style', () => {
  const user = 'bucket-adapt-user-1';
  const products = searchDemo({ query: 'eggs' });
  const req = reqFor({ category: 'eggs' });
  const before = buildRecommendations(products, req, getProfile(user, 'eggs'));
  assert.equal(before.cards[0].strategies[0], 'Smart', 'default order with no history');
  assert.match(before.basketPlan.lines.join(' '), /No history yet/);

  for (const category of ['milk', 'bread', 'rice']) {
    recordEvent(user, { type: 'select', product: { id: 'x', name: 'x', brand: 'b' }, strategy: 'Budget', category });
  }
  const after = buildRecommendations(products, req, getProfile(user, 'eggs'));
  assert.equal(after.cards[0].strategies[0], 'Budget', 'the style they keep choosing now leads');
  assert.match(after.basketPlan.lines.join(' '), /Best price ×3/);
  assert.match(getUserModel(user).lines.join(' '), /Best price is your most chosen/);
});

test('buckets: a stated priority leads before any history exists', () => {
  const user = 'bucket-priority-user-1';
  setPriority(user, 'quality');
  const profile = getProfile(user, 'milk');
  assert.equal(profile.dominant, 'Premium');
  const { cards } = buildRecommendations(searchDemo({ query: 'milk' }), reqFor({ category: 'milk' }), profile);
  assert.equal(cards[0].strategies[0], 'Premium');
});
