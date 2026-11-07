import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

process.env.DB_PATH = ':memory:';
process.env.GROQ_API_KEY = '';
const { app } = await import('../app.js');
const { db, run } = await import('../db.js');
const { optimizeSelection } = await import('../services/setupBuilder.js');
const { heuristicPlan } = await import('../services/intent.js');

let server;
let base;
const H = { 'content-type': 'application/json', 'x-user-id': 'setup-test-user-01' };
const call = async (path, options = {}) => {
  const res = await fetch(`${base}/api${path}`, { headers: H, ...options });
  return { status: res.status, body: await res.json() };
};
const listing = (id, price) => ({
  id, name: `Item ${id}`, brand: 'Acme', price, currency: 'USD', compareAtPrice: null, availability: 'InStock', rating: null, category: null,
  description: '', features: [], attributes: [], searchText: id, specs: {}, image: '', merchant: 'shop.example', buyUrl: 'https://shop.example/p', offers: [], source: 'Channel3', demo: false,
});

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://localhost:${server.address().port}`;
  for (const [id, price] of [['S1', 700], ['S2', 120], ['S3', 40]]) {
    run('INSERT OR REPLACE INTO products (id, json, fetched_at) VALUES (?,?,?)', id, JSON.stringify(listing(id, price)), Date.now());
  }
});
after(() => { server.close(); db.close(); });

test('setups: the parser reads "high quality yet affordable" as a balanced setup request', () => {
  const plan = heuristicPlan('Build me a high quality yet affordable gaming setup under $1200');
  assert.equal(plan.type, 'setup');
  assert.equal(plan.priority_hint, 'balanced');
  assert.equal(plan.budget, 1200);
  assert.equal(heuristicPlan('build me a cheap gaming setup under $900').priority_hint, 'price');
  assert.equal(heuristicPlan('build me the best gaming setup under $2000').priority_hint, 'quality');
});

test('setups: each basket is optimised for its own goal and never exceeds the budget', () => {
  const opt = (id, price, score) => ({ product: { id, price }, composite: score });
  const mk = (key) => [
    { quantity: 1, cap: 800, options: [opt('L1', 700, 0.9), opt('L2', 450, 0.6)].sort((a, b) => b.composite - a.composite) },
    { quantity: 1, cap: 300, options: [opt('M1', 250, 0.9), opt('M2', 90, 0.5)].sort((a, b) => b.composite - a.composite) },
  ];
  const premium = optimizeSelection(mk('Premium'), 1000);
  assert.ok(premium.withinBudget && premium.total <= 1000);
  const tight = optimizeSelection(mk('Premium'), 560);
  assert.ok(tight.withinBudget && tight.total <= 560, 'trims to fit a tighter budget');
  assert.equal(optimizeSelection(mk('Premium'), 100).withinBudget, false, 'reports an impossible budget');
});

test('setups: choosing a basket makes it the cart, with totals computed on the server', async () => {
  const items = [{ productId: 'S1', role: 'laptop', quantity: 1 }, { productId: 'S2', role: 'monitor', quantity: 1 }, { productId: 'S3', role: 'mouse', quantity: 2 }];
  const r = await call('/setups/select', { method: 'POST', body: JSON.stringify({ items, strategy: 'Smart', goal: 'gaming setup', budget: 1000 }) });
  assert.equal(r.status, 200);
  assert.equal(r.body.items.length, 3);
  assert.equal(r.body.total, 900); // 700 + 120 + 2 x 40
  assert.equal(r.body.budget, 1000);
  assert.equal(r.body.withinBudget, true);
  assert.equal(r.body.goal, 'gaming setup');
});

test('setups: expired or unknown listings and empty baskets are refused', async () => {
  let r = await call('/setups/select', { method: 'POST', body: JSON.stringify({ items: [{ productId: 'nope', role: 'x' }], strategy: 'Smart' }) });
  assert.equal(r.status, 404);
  r = await call('/setups/select', { method: 'POST', body: JSON.stringify({ items: [], strategy: 'Smart' }) });
  assert.equal(r.status, 400);
});

test('setups: "I bought this" is recorded as a self-reported purchase that teaches the baskets', async () => {
  let r = await call('/feedback', { method: 'POST', body: JSON.stringify({ type: 'bought', productId: 'S1', strategy: 'Premium', category: 'laptop' }) });
  assert.equal(r.status, 200);
  const prefs = await call('/preferences');
  assert.ok(prefs.body.preferences.some((p) => p.dimension === 'strategy' && p.key === 'Premium'));
  r = await call('/feedback', { method: 'POST', body: JSON.stringify({ type: 'teleport', productId: 'S1' }) });
  assert.equal(r.status, 400);
});
