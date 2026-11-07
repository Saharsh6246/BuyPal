import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

process.env.DB_PATH = ':memory:';
process.env.GROQ_API_KEY = '';
const { app } = await import('../app.js');
const { db } = await import('../db.js');
const { run } = await import('../db.js');

let server;
let base;
const USER = 'api-test-user-0001';
const H = { 'content-type': 'application/json', 'x-user-id': USER };
const call = async (path, options = {}) => {
  const res = await fetch(`${base}/api${path}`, { headers: H, ...options });
  return { status: res.status, body: await res.json() };
};

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://localhost:${server.address().port}`;
  const product = {
    id: 'T1', name: 'Test Laptop', brand: 'Acme', price: 500, currency: 'USD', compareAtPrice: null, availability: 'InStock',
    rating: null, category: null, description: '', features: [], attributes: [], searchText: 'Test Laptop', specs: {}, image: '', merchant: 'x.com', buyUrl: '',
  };
  run('INSERT OR REPLACE INTO products (id, json, fetched_at) VALUES (?,?,?)', 'T1', JSON.stringify(product), Date.now());
  run('INSERT OR REPLACE INTO products (id, json, fetched_at) VALUES (?,?,?)', 'T2', JSON.stringify({ ...product, id: 'T2', price: null }), Date.now());
});
after(() => { server.close(); db.close(); });

test('rejects requests without a valid user id', async () => {
  const res = await fetch(`${base}/api/cart`);
  assert.equal(res.status, 400);
});

test('cart: add, change quantity, total is computed on the server, remove', async () => {
  let r = await call('/cart', { method: 'POST', body: JSON.stringify({ productId: 'T1' }) });
  assert.equal(r.status, 200);
  assert.equal(r.body.total, 500);
  r = await call('/cart/items/T1', { method: 'PATCH', body: JSON.stringify({ quantity: 3 }) });
  assert.equal(r.body.total, 1500);
  r = await call('/cart/items/T1', { method: 'PATCH', body: JSON.stringify({ quantity: 99 }) });
  assert.equal(r.status, 400);
  r = await call('/cart/items/T1', { method: 'DELETE' });
  assert.equal(r.body.count, 0);
});

test('cart: listings without a verified price cannot be added; unknown listings expire', async () => {
  let r = await call('/cart', { method: 'POST', body: JSON.stringify({ productId: 'T2' }) });
  assert.equal(r.status, 400);
  r = await call('/cart', { method: 'POST', body: JSON.stringify({ productId: 'nope' }) });
  assert.equal(r.status, 404);
});

test('payment: empty cart cannot start checkout; capture of an unknown order is refused', async () => {
  let r = await call('/paypal/orders', { method: 'POST' });
  assert.ok([400, 503].includes(r.status));
  r = await call('/paypal/orders/FAKE123/capture', { method: 'POST' });
  assert.ok([404, 503].includes(r.status));
});

test('chat: works without an LLM key (basic mode) and explains why', async () => {
  const r = await call('/chat', { method: 'POST', body: JSON.stringify({ message: 'hello there' }) });
  assert.equal(r.status, 200);
  assert.equal(r.body.mode, 'basic');
  assert.match(r.body.notice, /GROQ_API_KEY/);
  assert.equal(r.body.usage.calls, 0);
});

test('preferences: feedback is stored, editable and resettable', async () => {
  let r = await call('/feedback', { method: 'POST', body: JSON.stringify({ type: 'like', productId: 'T1', strategy: 'Smart', category: 'laptop' }) });
  assert.equal(r.status, 200);
  r = await call('/preferences');
  assert.ok(r.body.preferences.some((p) => p.key === 'acme'));
  r = await call('/preferences', { method: 'DELETE' });
  assert.deepEqual(r.body.preferences, []);
  r = await call('/feedback', { method: 'POST', body: JSON.stringify({ type: 'reject', productId: 'T1', reason: 'made_up' }) });
  assert.equal(r.status, 400);
});
