import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { config, hasPaypal } from './config.js';
import { ensureUser, isValidUserId } from './db.js';
import { clearHistory, handleMessage, loadHistory } from './services/agent.js';
import { Channel3Error } from './services/channel3.js';
import { addItem, CartError, clearCart, getCart, removeItem, setQuantity } from './services/cartService.js';
import { llmUsage } from './services/llm.js';
import { captureOrder, createOrder, createTopUpOrder, listOrders, PayPalError } from './services/paypal.js';
import { claimExternalCheckout, walletSummary, WalletError } from './services/wallet.js';
import { buildHome } from './services/home.js';
import { selectSetupBasket } from './services/setupBuilder.js';
import { getUserModel } from './services/insights.js';
import { describeProfile, getPriority, listPreferences, PRIORITIES, recordEvent, REJECT_REASONS, resetPreferences, setPreference, setPriority } from './services/preferences.js';
import { getCachedProduct } from './services/channel3.js';

export const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));

// Anonymous per-browser identity: the client generates a random id and sends it with every request.
function requireUser(req, res, next) {
  const userId = req.get('x-user-id');
  if (!isValidUserId(userId)) return res.status(400).json({ error: 'Missing or invalid user id.' });
  ensureUser(userId);
  req.userId = userId;
  return next();
}

// Protects the free LLM quota from a single noisy client.
const hits = new Map();
function chatLimiter(req, res, next) {
  const now = Date.now();
  const recent = (hits.get(req.userId) || []).filter((t) => now - t < 60000);
  if (recent.length >= 15) return res.status(429).json({ error: 'You are sending messages too quickly. Please wait a moment.' });
  recent.push(now);
  hits.set(req.userId, recent);
  return next();
}

const wrap = (handler) => async (req, res) => {
  try {
    await handler(req, res);
  } catch (error) {
    if (error instanceof CartError || error instanceof Channel3Error || error instanceof PayPalError || error instanceof WalletError) {
      return res.status(error.status || 400).json({ error: error.message, ...(error.extra || {}) });
    }
    console.error('Unhandled error:', error?.message || error);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};

app.get('/api/config', (req, res) => {
  res.json({
    paypal: { configured: hasPaypal(), clientId: hasPaypal() ? config.paypalClientId : '', environment: 'sandbox' },
    search: { configured: Boolean(config.channel3ApiKey) },
    ai: llmUsage(),
    inrPerUsd: config.inrPerUsd,
    rejectReasons: REJECT_REASONS,
    priorities: PRIORITIES,
  });
});

app.get('/api/me', requireUser, (req, res) => res.json({ priority: getPriority(req.userId) }));
app.put('/api/settings', requireUser, wrap(async (req, res) => {
  try { setPriority(req.userId, req.body?.priority); } catch (error) { return res.status(400).json({ error: error.message }); }
  res.json({ priority: getPriority(req.userId), summary: describeProfile(req.userId) });
}));
app.get('/api/insights', requireUser, (req, res) => res.json(getUserModel(req.userId)));
app.get('/api/home', requireUser, wrap(async (req, res) => res.json(await buildHome(req.userId))));

app.get('/api/history', requireUser, (req, res) => res.json({ messages: loadHistory(req.userId) }));
app.delete('/api/history', requireUser, (req, res) => { clearHistory(req.userId); res.json({ ok: true }); });

app.post('/api/chat', requireUser, chatLimiter, wrap(async (req, res) => {
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  if (message.length < 2 || message.length > 1000) return res.status(400).json({ error: 'Please send a message between 2 and 1000 characters.' });
  res.json({ ...(await handleMessage(req.userId, message)), cart: getCart(req.userId) });
}));

// ---- Cart ----
app.get('/api/cart', requireUser, (req, res) => res.json(getCart(req.userId)));
app.post('/api/cart', requireUser, wrap(async (req, res) => {
  const { productId, strategy = null, category = null } = req.body || {};
  if (typeof productId !== 'string') return res.status(400).json({ error: 'Invalid product.' });
  const cart = addItem(req.userId, productId, { strategy: strategy ? String(strategy).slice(0, 40) : null, role: category ? String(category).toLowerCase().slice(0, 40) : null });
  if (strategy) recordEvent(req.userId, { type: 'select', product: getCachedProduct(productId)?.product, strategy, category });
  res.json(cart);
}));
app.patch('/api/cart/items/:id', requireUser, wrap(async (req, res) => res.json(setQuantity(req.userId, req.params.id, req.body?.quantity))));
app.delete('/api/cart/items/:id', requireUser, wrap(async (req, res) => res.json(removeItem(req.userId, req.params.id))));
app.delete('/api/cart', requireUser, (req, res) => { clearCart(req.userId); res.json(getCart(req.userId)); });

// The shopper chose one of the setup baskets: it becomes their cart, and the choice teaches Buypal their style.
app.post('/api/setups/select', requireUser, wrap(async (req, res) => {
  const { items, strategy, goal, budget } = req.body || {};
  const cart = selectSetupBasket(req.userId, { items, strategy, goal, budget });
  if (strategy) recordEvent(req.userId, { type: 'select', strategy: String(strategy).split(' · ')[0], category: null });
  res.json(cart);
}));

// ---- Feedback & preferences ----
app.post('/api/feedback', requireUser, wrap(async (req, res) => {
  const { type, productId, strategy = null, reason = null, category = null } = req.body || {};
  if (!['like', 'reject', 'bought', 'click'].includes(type)) return res.status(400).json({ error: 'Unknown feedback type.' });
  if (reason && !REJECT_REASONS[reason]) return res.status(400).json({ error: 'Unknown reason.' });
  const product = getCachedProduct(String(productId || ''))?.product;
  // "bought" is self-reported by the shopper after buying at the retailer (Buypal cannot confirm it).
  // "click" means the shopper opened the retailer page for this card, which counts as choosing it.
  const eventType = { bought: 'purchase', click: 'select' }[type] || type;
  recordEvent(req.userId, { type: eventType, product, strategy, reason: type === 'bought' ? 'self_reported' : reason, category });
  res.json({ ok: true, preferences: listPreferences(req.userId) });
}));
app.get('/api/preferences', requireUser, (req, res) => res.json({ preferences: listPreferences(req.userId), summary: describeProfile(req.userId) }));
app.put('/api/preferences', requireUser, wrap(async (req, res) => {
  const { scope = 'global', dimension, key, score } = req.body || {};
  if (typeof key !== 'string' || !key) return res.status(400).json({ error: 'Missing preference key.' });
  try { setPreference(req.userId, String(scope).slice(0, 60), dimension, key, score); } catch (error) { return res.status(400).json({ error: error.message }); }
  res.json({ preferences: listPreferences(req.userId), summary: describeProfile(req.userId) });
}));
app.delete('/api/preferences', requireUser, (req, res) => { resetPreferences(req.userId); res.json({ preferences: [], summary: [] }); });

// ---- Pal Points wallet ----
app.get('/api/wallet', requireUser, (req, res) => res.json(walletSummary(req.userId)));
// Self-reported PayPal checkout at an external retailer (Buypal cannot see retailer orders): validated, capped, de-duplicated.
app.post('/api/wallet/claims', requireUser, wrap(async (req, res) => {
  const outcome = claimExternalCheckout(req.userId, req.body || {});
  res.status(201).json({ ...outcome, wallet: walletSummary(req.userId) });
}));
// Verifiable top-up: a PayPal Sandbox order to Buypal's own merchant account. It is captured through the normal capture route.
app.post('/api/wallet/topup/orders', requireUser, wrap(async (req, res) => res.status(201).json(await createTopUpOrder(req.userId, req.body?.packId))));

// ---- PayPal Sandbox ----
app.post('/api/paypal/orders', requireUser, wrap(async (req, res) => res.status(201).json(await createOrder(req.userId))));
app.post('/api/paypal/orders/:orderId/capture', requireUser, wrap(async (req, res) => res.json(await captureOrder(req.userId, req.params.orderId))));
app.get('/api/orders', requireUser, (req, res) => res.json({ orders: listOrders(req.userId) }));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

// ---- Built client (production) ----
if (fs.existsSync(config.clientDist)) {
  app.use(express.static(config.clientDist));
  app.get('*', (req, res) => res.sendFile(path.join(config.clientDist, 'index.html')));
}
