import { randomUUID } from 'node:crypto';
import { config, hasPaypal } from '../config.js';
import { all, get, run } from '../db.js';
import { paypalMoney } from '../lib/money.js';
import { cartFingerprint, clearCart, getCart } from './cartService.js';
import { getCachedProduct } from './channel3.js';
import { refreshListing as refreshProduct } from './catalog.js';
import { recordEvent } from './preferences.js';

// PayPal Sandbox Orders v2. The server owns every amount; the browser only ever receives an order id.
// The LLM has no access to this module, and capture only runs after the user approves inside PayPal.

export class PayPalError extends Error {
  constructor(message, status = 502, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

let tokenCache = { token: '', expiresAt: 0 };

async function accessToken() {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt - 30000) return tokenCache.token;
  const basic = Buffer.from(`${config.paypalClientId}:${config.paypalClientSecret}`).toString('base64');
  const response = await fetch(`${config.paypalBase}/v1/oauth2/token`, {
    method: 'POST',
    headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new PayPalError(response.status === 401 || response.status === 403
      ? 'PayPal Sandbox rejected the REST app credentials. Re-copy the Client ID and Secret into .env.'
      : 'Could not authenticate with PayPal Sandbox.');
  }
  tokenCache = { token: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) || 300) * 1000 };
  return tokenCache.token;
}

/** Re-checks every cart item against Channel3 so the order uses current verified prices. */
async function verifyCartPrices(userId) {
  const before = getCart(userId);
  const problems = [];
  await Promise.all(before.items.map(async (item) => {
    const fresh = await refreshProduct(item.id);
    if (fresh) {
      if (fresh.price !== item.product.price || fresh.currency !== 'USD') problems.push(`${item.product.name}: price changed from ${item.product.price} to ${fresh.price ?? 'unavailable'}`);
      if (/out|sold|discontinued/i.test(fresh.availability || '')) problems.push(`${item.product.name} is no longer in stock`);
    } else {
      const cached = getCachedProduct(item.id);
      if (!cached || Date.now() - cached.fetchedAt > 6 * 3600 * 1000) problems.push(`${item.product.name}: could not re-verify the current price`);
    }
  }));
  return problems;
}

export async function createOrder(userId) {
  if (!hasPaypal()) throw new PayPalError('PayPal Sandbox is not configured. Add the REST app credentials to .env.', 503);
  const initial = getCart(userId);
  if (!initial.items.length) throw new PayPalError('Your cart is empty.', 400);

  const problems = await verifyCartPrices(userId);
  if (problems.length) {
    throw new PayPalError(`Prices changed or could not be verified, so nothing was charged. ${problems.join('; ')}. Review your cart and try again.`, 409, { cart: getCart(userId) });
  }

  const cart = getCart(userId);
  if (cart.currency !== 'USD' || cart.total <= 0) throw new PayPalError('The cart needs a valid USD total before checkout.', 400);
  const token = await accessToken();
  const items = cart.items.map(({ product, quantity }) => ({
    name: String(product.name).slice(0, 127),
    quantity: String(quantity),
    unit_amount: { currency_code: 'USD', value: paypalMoney(product.price) },
    category: 'PHYSICAL_GOODS',
  }));
  const total = paypalMoney(cart.total);
  const response = await fetch(`${config.paypalBase}/v2/checkout/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'paypal-request-id': randomUUID(), prefer: 'return=representation' },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{
        description: 'Buypal Sandbox demo transaction. No retailer order or delivery is created.',
        items,
        amount: { currency_code: 'USD', value: total, breakdown: { item_total: { currency_code: 'USD', value: total } } },
      }],
      payment_source: { paypal: { experience_context: { user_action: 'PAY_NOW', shipping_preference: 'NO_SHIPPING' } } },
    }),
    signal: AbortSignal.timeout(20000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.id) {
    console.error(`PayPal order creation failed with HTTP ${response.status}`);
    throw new PayPalError('PayPal could not create the Sandbox order. Check the REST app credentials.');
  }
  run(`INSERT INTO orders (user_id, paypal_order_id, status, amount, currency, items_json, fingerprint, capture_request_id)
       VALUES (?,?,?,?,?,?,?,?)`, userId, data.id, 'CREATED', total, 'USD',
  JSON.stringify(cart.items.map((i) => ({ id: i.id, name: i.product.name, brand: i.product.brand, price: i.product.price, quantity: i.quantity, strategy: i.strategy, role: i.role, merchant: i.product.merchant }))),
  cartFingerprint(userId), randomUUID());
  return { orderId: data.id, amount: total, currency: 'USD' };
}

const receiptOf = (order) => ({
  status: order.status,
  orderId: order.paypal_order_id,
  captureId: order.capture_id || '',
  amount: order.amount,
  currency: order.currency,
});

export async function captureOrder(userId, orderId) {
  if (!hasPaypal()) throw new PayPalError('PayPal Sandbox is not configured.', 503);
  const order = get('SELECT * FROM orders WHERE paypal_order_id=? AND user_id=?', orderId, userId);
  if (!order) throw new PayPalError('PayPal order not found for this shopping session.', 404);
  if (order.status === 'COMPLETED') return receiptOf(order); // idempotent: never capture twice
  if (order.status === 'CAPTURING') throw new PayPalError('Payment is already being processed. Please wait.', 409);
  if (order.status === 'PENDING') return { ...receiptOf(order), message: 'PayPal reports that this payment is still pending.' };
  if (cartFingerprint(userId) !== order.fingerprint) {
    throw new PayPalError('Your cart changed during checkout. The approved payment was not captured; review your cart and check out again.', 409);
  }

  // Atomic claim so two simultaneous requests cannot both capture.
  const claim = run("UPDATE orders SET status='CAPTURING', updated_at=datetime('now') WHERE paypal_order_id=? AND status='CREATED'", orderId);
  if (!claim.changes) throw new PayPalError('Payment is already being processed. Please wait.', 409);

  const release = () => run("UPDATE orders SET status='CREATED', updated_at=datetime('now') WHERE paypal_order_id=? AND status='CAPTURING'", orderId);
  try {
    const token = await accessToken();
    const response = await fetch(`${config.paypalBase}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'paypal-request-id': order.capture_request_id, prefer: 'return=representation' },
      body: '{}',
      signal: AbortSignal.timeout(20000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      release();
      console.error(`PayPal capture failed with HTTP ${response.status}`);
      throw new PayPalError('PayPal could not complete the Sandbox payment. Your cart is unchanged; you can try again.');
    }
    const capture = data.purchase_units?.[0]?.payments?.captures?.[0];
    const verified = data.id === orderId && data.status === 'COMPLETED' && capture?.status === 'COMPLETED'
      && capture.amount?.value === order.amount && capture.amount?.currency_code === order.currency;
    if (verified) {
      run("UPDATE orders SET status='COMPLETED', capture_id=?, updated_at=datetime('now') WHERE paypal_order_id=?", capture.id || '', orderId);
      for (const item of JSON.parse(order.items_json)) {
        recordEvent(userId, { type: 'purchase', product: { id: item.id, name: item.name, brand: item.brand }, strategy: item.strategy, category: item.role });
      }
      clearCart(userId);
      return receiptOf(get('SELECT * FROM orders WHERE paypal_order_id=?', orderId));
    }
    if (capture?.status === 'PENDING' || data.status === 'PENDING') {
      run("UPDATE orders SET status='PENDING', updated_at=datetime('now') WHERE paypal_order_id=?", orderId);
      return { status: 'PENDING', orderId, message: 'PayPal reports that this payment is still pending.' };
    }
    run("UPDATE orders SET status='FAILED', updated_at=datetime('now') WHERE paypal_order_id=?", orderId);
    throw new PayPalError('PayPal did not confirm a completed payment. Your cart is unchanged.', 402, { status: 'FAILED' });
  } catch (error) {
    if (error instanceof PayPalError) throw error;
    release();
    console.error('PayPal capture request failed:', error.name || 'Error');
    throw new PayPalError('Could not verify the Sandbox payment with PayPal. Please check the order before retrying.');
  }
}

export function listOrders(userId) {
  return all('SELECT paypal_order_id, status, amount, currency, items_json, capture_id, created_at FROM orders WHERE user_id=? AND status IN (\'COMPLETED\',\'PENDING\') ORDER BY id DESC LIMIT 20', userId)
    .map((row) => ({ orderId: row.paypal_order_id, status: row.status, amount: row.amount, currency: row.currency, items: JSON.parse(row.items_json), captureId: row.capture_id, createdAt: row.created_at }));
}
