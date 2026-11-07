import { all, ensureUser, get, run } from '../db.js';
import { fmtUsd, roundMoney } from '../lib/money.js';
import { getCachedProduct } from './channel3.js';
import { publicProduct } from './scoring.js';

export const MAX_QTY = 10;

export function getCart(userId) {
  const meta = get('SELECT budget, goal FROM carts WHERE user_id=?', userId) || {};
  const rows = all('SELECT product_id, quantity, role, strategy, terms FROM cart_items WHERE user_id=? ORDER BY rowid', userId);
  const items = rows.map((row) => {
    const cached = getCachedProduct(row.product_id)?.product;
    if (!cached) return null;
    return {
      id: row.product_id,
      product: publicProduct(cached),
      quantity: row.quantity,
      role: row.role || null,
      strategy: row.strategy || null,
      terms: row.terms ? JSON.parse(row.terms) : [],
      lineTotal: roundMoney(cached.price * row.quantity, 'USD'),
    };
  }).filter(Boolean);
  const total = roundMoney(items.reduce((sum, item) => sum + item.lineTotal, 0), 'USD');
  const budget = meta.budget ?? null;
  return {
    items,
    count: items.reduce((sum, item) => sum + item.quantity, 0),
    currency: 'USD',
    total,
    budget,
    goal: meta.goal || null,
    withinBudget: budget === null ? null : total <= budget + 0.005,
  };
}

export function setCartMeta(userId, { budget = null, goal = null }) {
  ensureUser(userId);
  run(`INSERT INTO carts (user_id, budget, currency, goal) VALUES (?,?, 'USD', ?)
       ON CONFLICT(user_id) DO UPDATE SET budget=excluded.budget, goal=excluded.goal`, userId, budget, goal);
}

export class CartError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function addItem(userId, productId, { role = null, strategy = null, terms = [], quantity = 1 } = {}) {
  ensureUser(userId);
  const cached = getCachedProduct(productId)?.product;
  if (!cached) throw new CartError('That listing expired. Search again to refresh its price.', 404);
  if (cached.price === null || cached.currency !== 'USD') throw new CartError('This listing has no verified USD price, so it cannot be added.');
  const existing = get('SELECT quantity FROM cart_items WHERE user_id=? AND product_id=?', userId, productId);
  if (existing) {
    if (existing.quantity + quantity > MAX_QTY) throw new CartError(`The maximum quantity for one item is ${MAX_QTY}.`);
    run('UPDATE cart_items SET quantity=quantity+? WHERE user_id=? AND product_id=?', quantity, userId, productId);
  } else {
    run('INSERT INTO cart_items (user_id, product_id, quantity, role, strategy, terms) VALUES (?,?,?,?,?,?)',
      userId, productId, quantity, role, strategy, JSON.stringify(terms));
  }
  return getCart(userId);
}

export function setQuantity(userId, productId, quantity) {
  const q = Number(quantity);
  if (!Number.isInteger(q) || q < 1 || q > MAX_QTY) throw new CartError(`Quantity must be between 1 and ${MAX_QTY}.`);
  const result = run('UPDATE cart_items SET quantity=? WHERE user_id=? AND product_id=?', q, userId, productId);
  if (!result.changes) throw new CartError('That item is no longer in the cart.', 404);
  return getCart(userId);
}

export function removeItem(userId, productId) {
  const result = run('DELETE FROM cart_items WHERE user_id=? AND product_id=?', userId, productId);
  if (!result.changes) throw new CartError('That item is no longer in the cart.', 404);
  if (getCart(userId).items.length === 0) run('DELETE FROM carts WHERE user_id=?', userId);
  return getCart(userId);
}

export function clearCart(userId) {
  run('DELETE FROM cart_items WHERE user_id=?', userId);
  run('DELETE FROM carts WHERE user_id=?', userId);
}

export function replaceItem(userId, oldProductId, newProduct, { strategy = 'Smart', terms } = {}) {
  const old = get('SELECT quantity, role, terms FROM cart_items WHERE user_id=? AND product_id=?', userId, oldProductId);
  if (!old) throw new CartError('That item is not in the cart.', 404);
  run('DELETE FROM cart_items WHERE user_id=? AND product_id=?', userId, oldProductId);
  run(`INSERT INTO cart_items (user_id, product_id, quantity, role, strategy, terms) VALUES (?,?,?,?,?,?)
       ON CONFLICT(user_id, product_id) DO UPDATE SET quantity=excluded.quantity, role=excluded.role, terms=excluded.terms`,
  userId, newProduct.id, old.quantity, old.role, strategy, JSON.stringify(terms ?? JSON.parse(old.terms || '[]')));
  return getCart(userId);
}

/** Order of cart items in a stable fingerprint, used to detect cart changes during checkout. */
export function cartFingerprint(userId) {
  return JSON.stringify(all('SELECT product_id, quantity FROM cart_items WHERE user_id=? ORDER BY product_id', userId)
    .map((row) => [row.product_id, row.quantity, getCachedProduct(row.product_id)?.product.price ?? null]));
}

export const describeTotal = (cart) =>
  cart.budget != null
    ? `${fmtUsd(cart.total)} of ${fmtUsd(cart.budget)} budget (${cart.withinBudget ? `${fmtUsd(cart.budget - cart.total)} left` : `${fmtUsd(cart.total - cart.budget)} over`})`
    : fmtUsd(cart.total);
