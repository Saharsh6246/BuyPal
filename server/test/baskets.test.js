import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.DB_PATH = ':memory:';
const { searchDemo, getDemoListing, isDemoId, STORES } = await import('../providers/demoStores.js');
const { buildRecommendations } = await import('../services/scoring.js');
const { parseRequirements, parseUrgency, heuristicPlan } = await import('../services/intent.js');
const { recordEvent, getProfile, setPriority } = await import('../services/preferences.js');
const { getUserModel } = await import('../services/insights.js');
const { normalizeRequirements } = await import('../services/recommend.js');
const { parseSize } = await import('../services/specs.js');

const reqFor = (args) => normalizeRequirements(args);

test('demo feed: every listing is flagged as simulated, stable and uses fictional stores', () => {
  const a = searchDemo({ query: 'salted butter' });
  const b = searchDemo({ query: 'salted butter' });
  assert.ok(a.length > 5);
  assert.deepEqual(a.map((l) => [l.id, l.price]), b.map((l) => [l.id, l.price]), 'deterministic');
  for (const l of a) {
    assert.equal(l.demo, true);
    assert.equal(l.source, 'Demo');
    assert.ok(isDemoId(l.id));
    assert.ok(l.delivery.minutes > 0);
    assert.equal(l.buyUrl, '', 'no fake retailer link');
    assert.ok(STORES.some((s) => s.name === l.merchant));
  }
  assert.equal(getDemoListing(a[0].id).price, a[0].price, 'a listing can be re-verified by id at checkout');
  assert.equal(searchDemo({ query: 'qwertyuiop nonsense' }).length, 0);
});

test('parsing: urgency, pack size and budget do not get confused', () => {
  assert.equal(parseUrgency('need it within 15 minutes'), 15);
  assert.equal(parseUrgency('deliver in 2 hours'), 120);
  assert.equal(parseUrgency('I need milk right now'), 30);
  assert.equal(parseUrgency('a laptop for college'), null);
  const r = parseRequirements('I need salted butter 500g delivered within 15 minutes');
  assert.equal(r.budget_max, null, '15 minutes is not a budget');
  assert.equal(r.delivery_within_minutes, 15);
  assert.deepEqual(r.must_have, ['500 g']);
  assert.equal(r.category, 'butter');
  assert.deepEqual(parseSize('Butter 1 kg'), { unit: 'g', qty: 1000 });
  assert.equal(heuristicPlan('hello there').type, 'chat');
  assert.equal(heuristicPlan('organic honey 250g').type, 'search');
});

test('baskets: an urgent request is answered only with stores that can deliver in time', () => {
  const products = searchDemo({ query: 'milk' });
  const req = reqFor({ category: 'milk', delivery_within_minutes: 20 });
  const { cards, basketPlan } = buildRecommendations(products, req);
  assert.ok(cards.length >= 1);
  for (const c of cards) assert.ok(c.product.delivery.minutes <= 20, `${c.product.merchant} ${c.product.delivery.label}`);
  assert.equal(cards[0].strategies[0], 'Fastest', 'speed leads when time is short');
  assert.match(basketPlan.lines.join(' '), /within 20 minutes/);
});

test('baskets: a requested size is honoured and sizes are never mixed', () => {
  const products = searchDemo({ query: 'rice' });
  const sized = buildRecommendations(products, reqFor({ category: 'rice', must_have: ['5 kg'] }));
  assert.ok(sized.cards.length >= 1);
  for (const c of sized.cards) assert.deepEqual(parseSize(c.product.name), { unit: 'g', qty: 5000 });
  const unsized = buildRecommendations(products, reqFor({ category: 'rice' }));
  const qtys = new Set(unsized.cards.map((c) => parseSize(c.product.name).qty));
  assert.equal(qtys.size, 1, 'one comparable pack size');
  assert.ok(unsized.notes.some((n) => /most widely stocked size/.test(n)));
});

test('baskets: delivery fee is part of the "best price" comparison', () => {
  const products = searchDemo({ query: 'toothpaste' });
  const { cards } = buildRecommendations(products, reqFor({ category: 'toothpaste' }));
  const cheapest = cards.find((c) => c.strategies.includes('Budget'));
  assert.match(cheapest.position, /total cost, item plus delivery/);
});

test('baskets: they re-arrange as the shopper keeps choosing quickest delivery', () => {
  const user = 'basket-adapt-user-1';
  const products = searchDemo({ query: 'eggs' });
  const req = reqFor({ category: 'eggs' });
  const before = buildRecommendations(products, req, getProfile(user, 'eggs'));
  assert.equal(before.cards[0].strategies[0], 'Budget', 'default order with no history');
  assert.match(before.basketPlan.lines.join(' '), /No history yet/);

  for (const category of ['milk', 'bread', 'rice']) {
    recordEvent(user, { type: 'select', product: { id: 'x', name: 'x', brand: 'b' }, strategy: 'Fastest', category });
  }
  const after = buildRecommendations(products, req, getProfile(user, 'eggs'));
  assert.equal(after.cards[0].strategies[0], 'Fastest', 'speed now leads');
  assert.ok(after.cards.some((c) => c.strategies.includes('Fastest alt')), 'and gets a runner-up');
  assert.match(after.basketPlan.lines.join(' '), /Quickest delivery ×3/);

  const model = getUserModel(user);
  assert.equal(model.basketTally.Fastest, 3);
  assert.match(model.lines.join(' '), /against the clock/);
});

test('baskets: a stated speed priority works even before any history', () => {
  const user = 'basket-speed-user-1';
  setPriority(user, 'speed');
  const profile = getProfile(user, 'milk');
  assert.equal(profile.dominant, 'Fastest');
  const { cards } = buildRecommendations(searchDemo({ query: 'milk' }), reqFor({ category: 'milk' }), profile);
  assert.equal(cards[0].strategies[0], 'Fastest');
});

test('baskets: listings that report no delivery time never claim to be fast', () => {
  const real = {
    id: 'r1', name: 'Phone Charger Real', brand: 'Acme', price: 12, currency: 'USD', availability: 'InStock', demo: false, delivery: null,
    rating: { value: 4.6, count: 500 }, category: { slug: 'chargers', title: 'Chargers', path: ['Electronics'] }, searchText: 'charger', specs: {}, features: [], attributes: [], offers: [],
  };
  const { cards, notes } = buildRecommendations([real], reqFor({ category: 'charger', delivery_within_minutes: 30 }));
  assert.ok(cards.every((c) => !c.strategies.includes('Fastest')));
  assert.ok(notes.some((n) => /cannot be confirmed as fast|can deliver within/.test(n)));
});
