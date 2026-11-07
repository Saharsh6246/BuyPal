import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { config, hasPaypal } from './config.js';
import { ensureUser, isValidUserId } from './db.js';
import { clearHistory, handleMessage, loadHistory } from './services/agent.js';
import { Channel3Error } from './services/channel3.js';
import { addItem, CartError, clearCart, getCart, removeItem, setQuantity } from './services/cartService.js';
import { llmUsage } from './services/llm.js';
import { captureOrder, createOrder, listOrders, PayPalError } from './services/paypal.js';
import { describeProfile, listPreferences, recordEvent, REJECT_REASONS, resetPreferences, setPreference } from './services/preferences.js';
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
    if (error instanceof CartError || error instanceof Channel3Error || error instanceof PayPalError) {
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
  });
});

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

// ---- Feedback & preferences ----
app.post('/api/feedback', requireUser, wrap(async (req, res) => {
  const { type, productId, strategy = null, reason = null, category = null } = req.body || {};
  if (!['like', 'reject'].includes(type)) return res.status(400).json({ error: 'Unknown feedback type.' });
  if (reason && !REJECT_REASONS[reason]) return res.status(400).json({ error: 'Unknown reason.' });
  const product = getCachedProduct(String(productId || ''))?.product;
  recordEvent(req.userId, { type, product, strategy, reason, category });
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
