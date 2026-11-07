import { all, db, ensureUser, get, run } from '../db.js';

// Pal Points: the currency Buypal's AI work is paid for in. Points are spent when a search or setup is run and
// earned by paying with PayPal. They have no cash value and cannot be withdrawn. Rename them in one place here.

export const UNIT = { name: 'Pal Points', short: 'points', one: 'Pal Point' };

export const COSTS = {
  search: 1, // one product comparison (find_products), including a cart-edit search
  setup: 4, // a complete multi-product setup (several searches and three baskets)
};

export const WELCOME_POINTS = 25;

// Verifiable earning path: the shopper pays Buypal's own PayPal merchant account (Sandbox), so the server can confirm the capture.
export const PACKS = [
  { id: 'starter', points: 25, priceUsd: '1.99', label: 'Starter', note: 'About 25 searches' },
  { id: 'plus', points: 75, priceUsd: '4.99', label: 'Plus', note: 'Best for a few setups' },
  { id: 'pro', points: 200, priceUsd: '9.99', label: 'Pro', note: 'Lowest cost per point' },
];
export const getPack = (id) => PACKS.find((p) => p.id === id) || null;

// Reward path: the shopper reports a PayPal checkout they made at an external retailer. Buypal cannot see retailer
// orders, so this is self-reported: it is validated, capped and de-duplicated, and labelled as such everywhere.
export const CLAIM_RULES = { minAmountUsd: 1, maxAmountUsd: 5000, maxPointsPerClaim: 50, maxClaimsPerDay: 3, minPoints: 5, pointsPerUsd: 1 };

export class WalletError extends Error {
  constructor(message, status = 400, code = 'WALLET') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Gives a new shopper their welcome points exactly once (idempotent through the ledger's unique index). */
function ensureWallet(userId) {
  ensureUser(userId);
  run("INSERT OR IGNORE INTO points_ledger (user_id, delta, reason, ref, note) VALUES (?, ?, 'welcome', ?, 'Welcome to Buypal')", userId, WELCOME_POINTS, userId);
}

export function getBalance(userId) {
  ensureWallet(userId);
  return get('SELECT COALESCE(SUM(delta), 0) AS balance FROM points_ledger WHERE user_id=?', userId).balance;
}

export const canAfford = (userId, cost) => getBalance(userId) >= cost;

/** Spends points atomically. Returns { ok, balance }; never lets a balance go negative. */
export function spend(userId, cost, reason, note = null) {
  if (!cost) return { ok: true, balance: getBalance(userId) };
  ensureWallet(userId);
  db.exec('BEGIN IMMEDIATE');
  try {
    const balance = get('SELECT COALESCE(SUM(delta), 0) AS balance FROM points_ledger WHERE user_id=?', userId).balance;
    if (balance < cost) {
      db.exec('ROLLBACK');
      return { ok: false, balance };
    }
    run('INSERT INTO points_ledger (user_id, delta, reason, note) VALUES (?, ?, ?, ?)', userId, -cost, reason, note);
    db.exec('COMMIT');
    return { ok: true, balance: balance - cost };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
    throw error;
  }
}

/** Credits points once per (reason, ref). A repeated credit for the same reference is ignored, so a retry can never double-pay. */
export function creditOnce(userId, points, reason, ref, note = null) {
  ensureWallet(userId);
  const result = run('INSERT OR IGNORE INTO points_ledger (user_id, delta, reason, ref, note) VALUES (?, ?, ?, ?, ?)', userId, points, reason, ref, note);
  return { credited: result.changes > 0, balance: getBalance(userId) };
}

export function listLedger(userId, limit = 20) {
  ensureWallet(userId);
  return all('SELECT id, delta, reason, note, created_at AS createdAt FROM points_ledger WHERE user_id=? ORDER BY id DESC LIMIT ?', userId, limit);
}

// PayPal transaction ids are 17 characters of capital letters and digits (for example 5TY05013RG002845M).
const TXN_ID = /^[A-Z0-9]{17}$/;

export function pointsForAmount(amountUsd) {
  const raw = Math.floor(amountUsd * CLAIM_RULES.pointsPerUsd);
  return Math.min(CLAIM_RULES.maxPointsPerClaim, Math.max(CLAIM_RULES.minPoints, raw));
}

/**
 * Credits points for a PayPal checkout the shopper made at an external retailer.
 * This is self-reported (Buypal cannot see the retailer's order), so it is validated, capped per day and de-duplicated.
 */
export function claimExternalCheckout(userId, { merchant, transactionId, amountUsd }) {
  ensureWallet(userId);
  const name = String(merchant || '').trim().slice(0, 80);
  const txn = String(transactionId || '').trim().toUpperCase().replace(/[\s-]/g, '');
  const amount = Number(amountUsd);
  if (name.length < 2) throw new WalletError('Enter the store you paid at.');
  if (!TXN_ID.test(txn)) throw new WalletError('A PayPal transaction ID has 17 letters and digits, for example 5TY05013RG002845M. You can find it in PayPal\'s receipt email.');
  if (!Number.isFinite(amount) || amount < CLAIM_RULES.minAmountUsd || amount > CLAIM_RULES.maxAmountUsd) {
    throw new WalletError(`Enter the amount you paid in US dollars, between $${CLAIM_RULES.minAmountUsd} and $${CLAIM_RULES.maxAmountUsd}.`);
  }
  const today = get("SELECT COUNT(*) AS n FROM point_claims WHERE user_id=? AND date(created_at) = date('now')", userId).n;
  if (today >= CLAIM_RULES.maxClaimsPerDay) throw new WalletError(`You can claim up to ${CLAIM_RULES.maxClaimsPerDay} PayPal checkouts a day. Try again tomorrow.`, 429, 'CLAIM_LIMIT');
  if (get('SELECT 1 FROM point_claims WHERE transaction_id=?', txn)) throw new WalletError('That PayPal transaction has already been claimed.', 409, 'DUPLICATE');

  const points = pointsForAmount(amount);
  db.exec('BEGIN IMMEDIATE');
  try {
    run('INSERT INTO point_claims (user_id, merchant, transaction_id, amount_usd, points) VALUES (?,?,?,?,?)', userId, name, txn, amount, points);
    run("INSERT INTO points_ledger (user_id, delta, reason, ref, note) VALUES (?, ?, 'paypal_claim', ?, ?)", userId, points, txn, `PayPal checkout at ${name} (self-reported)`);
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
    throw error;
  }
  return { points, balance: getBalance(userId) };
}

/** Everything the wallet screen needs. */
export function walletSummary(userId) {
  const balance = getBalance(userId);
  return {
    unit: UNIT,
    balance,
    costs: COSTS,
    welcomePoints: WELCOME_POINTS,
    packs: PACKS,
    claimRules: CLAIM_RULES,
    ledger: listLedger(userId),
  };
}
