import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

process.env.DB_PATH = ':memory:';
process.env.GROQ_API_KEY = '';
process.env.CHANNEL3_API_KEY = ''; // demo store feed only, so these tests never touch the network
process.env.SERPAPI_KEY = '';
process.env.PAYPAL_CLIENT_ID = 'test-client';
process.env.PAYPAL_CLIENT_SECRET = 'test-secret';
const { app } = await import('../app.js');
const { db } = await import('../db.js');
const wallet = await import('../services/wallet.js');

let server;
let base;
const call = async (user, path, options = {}) => {
  const res = await fetch(`${base}/api${path}`, { headers: { 'content-type': 'application/json', 'x-user-id': user }, ...options });
  return { status: res.status, body: await res.json() };
};

before(async () => {
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://localhost:${server.address().port}`;
});
after(() => { server.close(); db.close(); });

test('wallet: a new shopper gets the welcome points exactly once', () => {
  const user = 'wallet-user-welcome-1';
  assert.equal(wallet.getBalance(user), wallet.WELCOME_POINTS);
  assert.equal(wallet.getBalance(user), wallet.WELCOME_POINTS, 'asking again does not grant more');
});

test('wallet: spending is atomic and a balance can never go negative', () => {
  const user = 'wallet-user-spend-01';
  const first = wallet.spend(user, 10, 'search');
  assert.deepEqual(first, { ok: true, balance: 15 });
  const tooMuch = wallet.spend(user, 99, 'setup');
  assert.equal(tooMuch.ok, false);
  assert.equal(wallet.getBalance(user), 15, 'a refused spend changes nothing');
  assert.equal(wallet.spend(user, 15, 'search').balance, 0);
  assert.equal(wallet.spend(user, 1, 'search').ok, false);
});

test('wallet: a credit with the same reference is only ever paid once', () => {
  const user = 'wallet-user-credit-01';
  assert.equal(wallet.creditOnce(user, 75, 'topup', 'ORDER123', 'top-up').credited, true);
  const again = wallet.creditOnce(user, 75, 'topup', 'ORDER123', 'top-up');
  assert.equal(again.credited, false, 'a retried capture cannot pay twice');
  assert.equal(again.balance, wallet.WELCOME_POINTS + 75);
});

test('claims: a PayPal checkout at a retailer is validated, capped and never paid twice', () => {
  const user = 'wallet-user-claim-01';
  assert.throws(() => wallet.claimExternalCheckout(user, { merchant: 'Walmart', transactionId: 'NOT-A-REAL-ID', amountUsd: 30 }), /17 letters and digits/);
  assert.throws(() => wallet.claimExternalCheckout(user, { merchant: '', transactionId: '5TY05013RG002845M', amountUsd: 30 }), /store/);
  assert.throws(() => wallet.claimExternalCheckout(user, { merchant: 'Walmart', transactionId: '5TY05013RG002845M', amountUsd: 0.2 }), /between/);

  const ok = wallet.claimExternalCheckout(user, { merchant: 'Walmart', transactionId: '5ty0-5013 rg002845m', amountUsd: 30 });
  assert.equal(ok.points, 30);
  assert.equal(ok.balance, wallet.WELCOME_POINTS + 30);
  assert.throws(() => wallet.claimExternalCheckout('wallet-user-claim-02', { merchant: 'Walmart', transactionId: '5TY05013RG002845M', amountUsd: 30 }), /already been claimed/);

  assert.equal(wallet.pointsForAmount(2), wallet.CLAIM_RULES.minPoints, 'small checkouts earn a minimum');
  assert.equal(wallet.pointsForAmount(900), wallet.CLAIM_RULES.maxPointsPerClaim, 'large checkouts are capped');

  wallet.claimExternalCheckout(user, { merchant: 'Best Buy', transactionId: '1AB23456CD789012E', amountUsd: 12 });
  wallet.claimExternalCheckout(user, { merchant: 'Newegg', transactionId: '2BC34567DE890123F', amountUsd: 12 });
  assert.throws(() => wallet.claimExternalCheckout(user, { merchant: 'eBay', transactionId: '3CD45678EF901234G', amountUsd: 12 }), /up to 3 PayPal checkouts a day/);
  assert.ok(wallet.listLedger(user).some((l) => l.reason === 'paypal_claim' && /self-reported/.test(l.note)), 'the ledger labels claims as self-reported');
});

test('points: a search costs one point, a failed or empty search costs nothing', async () => {
  const user = 'wallet-user-chat-0001';
  assert.equal((await call(user, '/wallet')).body.balance, 25);
  let r = await call(user, '/chat', { method: 'POST', body: JSON.stringify({ message: 'salted butter 500g' }) });
  assert.equal(r.status, 200);
  assert.ok(r.body.blocks.some((b) => b.type === 'recommendations' && b.cards.length > 0));
  assert.equal(r.body.wallet.spent, 1);
  assert.equal(r.body.wallet.balance, 24);
  r = await call(user, '/chat', { method: 'POST', body: JSON.stringify({ message: 'zzqxwv' }) });
  assert.equal(r.body.wallet.spent, 0, 'a search with no results is free');
  r = await call(user, '/chat', { method: 'POST', body: JSON.stringify({ message: 'hello there' }) });
  assert.equal(r.body.wallet.spent, 0, 'plain conversation is free');
});

test('points: with no points left, searches are refused and nothing is charged', async () => {
  const user = 'wallet-user-broke-001';
  wallet.spend(user, wallet.getBalance(user), 'search');
  const r = await call(user, '/chat', { method: 'POST', body: JSON.stringify({ message: 'whole wheat bread' }) });
  assert.equal(r.status, 200);
  const block = r.body.blocks.find((b) => b.type === 'outOfPoints');
  assert.ok(block, 'the UI is told to show the wallet');
  assert.equal(block.needed, 1);
  assert.equal(r.body.blocks.some((b) => b.type === 'recommendations'), false);
  assert.match(r.body.reply, /Pal Points/);
  assert.equal(r.body.wallet.balance, 0);
});

test('wallet API: summary, claims and top-up safeguards', async () => {
  const user = 'wallet-user-api-0001';
  const summary = await call(user, '/wallet');
  assert.equal(summary.body.unit.name, 'Pal Points');
  assert.equal(summary.body.packs.length, 3);
  assert.equal(summary.body.costs.search, 1);

  let r = await call(user, '/wallet/claims', { method: 'POST', body: JSON.stringify({ merchant: 'Target', transactionId: 'bad', amountUsd: 20 }) });
  assert.equal(r.status, 400);
  r = await call(user, '/wallet/claims', { method: 'POST', body: JSON.stringify({ merchant: 'Target', transactionId: '9ZY87654XW321098V', amountUsd: 20 }) });
  assert.equal(r.status, 201);
  assert.equal(r.body.wallet.balance, 45);
  r = await call(user, '/wallet/claims', { method: 'POST', body: JSON.stringify({ merchant: 'Target', transactionId: '9ZY87654XW321098V', amountUsd: 20 }) });
  assert.equal(r.status, 409);

  r = await call(user, '/wallet/topup/orders', { method: 'POST', body: JSON.stringify({ packId: 'free-money' }) });
  assert.equal(r.status, 400, 'only the server-side packs can be bought');
  assert.equal((await fetch(`${base}/api/wallet`)).status, 400, 'a user id is required');
});
