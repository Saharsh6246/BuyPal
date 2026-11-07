const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const root = __dirname;
const publicDir = path.join(root, 'public');
const productCatalog = new Map();
const carts = new Map();
const paypalOrders = new Map();
loadEnvFile(path.join(root, '.env'));

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);

  if (request.method === 'GET' && requestUrl.pathname === '/api/status') {
    return sendJson(response, 200, { configured: Boolean(process.env.CHANNEL3_API_KEY) });
  }

  if (request.method === 'GET' && requestUrl.pathname === '/api/paypal/config') {
    const configured = Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
    return sendJson(response, 200, {
      configured,
      clientId: configured ? process.env.PAYPAL_CLIENT_ID : '',
      environment: 'sandbox',
    });
  }

  if (request.method === 'POST' && requestUrl.pathname === '/api/paypal/orders') {
    return createPaypalOrder(request, response);
  }

  const captureMatch = requestUrl.pathname.match(/^\/api\/paypal\/orders\/([^/]+)\/capture$/);
  if (request.method === 'POST' && captureMatch) {
    return capturePaypalOrder(request, response, decodeURIComponent(captureMatch[1]));
  }

  if (request.method === 'POST' && requestUrl.pathname === '/api/search') {
    return searchChannel3(request, response);
  }

  if (requestUrl.pathname === '/api/cart') {
    if (request.method === 'GET') {
      const sessionId = requestUrl.searchParams.get('sessionId');
      if (!isValidSessionId(sessionId)) return sendJson(response, 400, { error: 'Invalid shopping session.' });
      return sendJson(response, 200, getCartSummary(sessionId));
    }
    if (request.method === 'POST') return addCartItem(request, response);
  }

  const cartItemMatch = requestUrl.pathname.match(/^\/api\/cart\/items\/([^/]+)$/);
  if (cartItemMatch && ['PATCH', 'DELETE'].includes(request.method)) {
    return changeCartItem(request, response, decodeURIComponent(cartItemMatch[1]));
  }

  if (request.method === 'GET') {
    return serveStatic(requestUrl.pathname, response);
  }

  return sendJson(response, 405, { error: 'Method not allowed.' });
});

const port = Number(process.env.PORT) || 3000;
server.listen(port, () => {
  console.log(`Buypal is running at http://localhost:${port}`);
});

async function searchChannel3(request, response) {
  if (!process.env.CHANNEL3_API_KEY) {
    return sendJson(response, 503, {
      error: 'Live product search is not set up yet. Add your Channel3 key to the .env file.',
      code: 'CHANNEL3_NOT_CONFIGURED',
    });
  }

  let body;
  try {
    body = await readJson(request);
  } catch {
    return sendJson(response, 400, { error: 'Please send a valid search request.' });
  }

  const query = typeof body.query === 'string' ? body.query.trim() : '';
  if (query.length < 2 || query.length > 300) {
    return sendJson(response, 400, { error: 'Search needs between 2 and 300 characters.' });
  }

  let requestStage = 'connecting';
  try {
    const apiResponse = await fetch('https://api.trychannel3.com/v1/search', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.CHANNEL3_API_KEY,
      },
      body: JSON.stringify({ query, limit: 12 }),
      signal: AbortSignal.timeout(20000),
    });

    requestStage = 'reading response';
    const raw = await apiResponse.json().catch(() => ({}));
    if (!apiResponse.ok) {
      console.error(`Channel3 search failed with HTTP ${apiResponse.status}`);
      const message = apiResponse.status === 401 || apiResponse.status === 403
        ? 'Channel3 did not accept the API key. Check the key in your .env file.'
        : apiResponse.status === 429
          ? 'Channel3 rate-limited this search. Check your Channel3 dashboard for usage or credits, then wait briefly and retry.'
          : apiResponse.status === 402
            ? 'Channel3 reports a billing or credit issue for this key. Check your Channel3 dashboard.'
        : 'Product search is temporarily unavailable. Please try again.';
      return sendJson(response, apiResponse.status === 429 ? 429 : 502, { error: message });
    }

    requestStage = 'processing product data';
    const products = extractProducts(raw).map(toDisplayProduct).filter(Boolean);
    for (const product of products) {
      productCatalog.set(product.id, product);
      if (productCatalog.size > 300) productCatalog.delete(productCatalog.keys().next().value);
    }
    return sendJson(response, 200, {
      products,
      recommendations: buildRecommendations(products, normalizePreferences(body.preferences)),
      count: products.length,
    });
  } catch (error) {
    console.error(`Channel3 ${requestStage} failed:`, error.name || 'Error', error.message || 'No additional details');
    const message = requestStage === 'processing product data'
      ? 'Channel3 returned results Buypal could not read. Check the server terminal for details.'
      : requestStage === 'reading response'
        ? 'Channel3 responded with data Buypal could not read. Please try again.'
        : error.name === 'TimeoutError' || error.name === 'AbortError'
          ? 'Channel3 search timed out. Please try again in a moment.'
          : 'Could not connect to Channel3. Check the terminal running Buypal for the connection detail, then retry.';
    return sendJson(response, 502, { error: message });
  }
}

async function addCartItem(request, response) {
  let body;
  try {
    body = await readJson(request);
  } catch {
    return sendJson(response, 400, { error: 'Please send a valid cart request.' });
  }

  const { sessionId, productId } = body;
  if (!isValidSessionId(sessionId) || typeof productId !== 'string') {
    return sendJson(response, 400, { error: 'Invalid shopping session or product.' });
  }

  const product = productCatalog.get(productId);
  if (!product) return sendJson(response, 404, { error: 'That listing expired. Search again to refresh its price.' });
  if (product.price === null || !product.currency) {
    return sendJson(response, 400, { error: 'This listing has no verified price and currency, so it cannot be added yet.' });
  }

  const cart = carts.get(sessionId) || new Map();
  const differentCurrency = [...cart.values()].find((item) => item.product.currency !== product.currency);
  if (differentCurrency) {
    return sendJson(response, 409, { error: 'This cart uses a different currency. Remove its items before adding this listing.' });
  }

  const existing = cart.get(productId);
  if (existing) {
    if (existing.quantity >= 10) return sendJson(response, 400, { error: 'The maximum quantity for one item is 10.' });
    existing.quantity += 1;
  } else {
    cart.set(productId, { product, quantity: 1 });
  }
  carts.set(sessionId, cart);
  return sendJson(response, 200, getCartSummary(sessionId));
}

async function changeCartItem(request, response, productId) {
  let body;
  try {
    body = await readJson(request);
  } catch {
    return sendJson(response, 400, { error: 'Please send a valid cart update.' });
  }

  const { sessionId } = body;
  if (!isValidSessionId(sessionId)) return sendJson(response, 400, { error: 'Invalid shopping session.' });
  const cart = carts.get(sessionId);
  if (!cart?.has(productId)) return sendJson(response, 404, { error: 'That item is no longer in the cart.' });

  if (request.method === 'DELETE') {
    cart.delete(productId);
  } else {
    const quantity = Number(body.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
      return sendJson(response, 400, { error: 'Quantity must be between 1 and 10.' });
    }
    cart.get(productId).quantity = quantity;
  }
  if (cart.size === 0) carts.delete(sessionId);
  return sendJson(response, 200, getCartSummary(sessionId));
}

function getCartSummary(sessionId) {
  const cart = carts.get(sessionId) || new Map();
  const items = [...cart.entries()].map(([id, item]) => ({
    id,
    product: item.product,
    quantity: item.quantity,
    lineTotal: roundCurrency(item.product.price * item.quantity, item.product.currency),
  }));
  const currency = items[0]?.product.currency || '';
  const total = roundCurrency(items.reduce((sum, item) => sum + item.lineTotal, 0), currency);
  return { items, count: items.reduce((sum, item) => sum + item.quantity, 0), currency, total };
}

function roundCurrency(amount, currency) {
  if (!currency) return 0;
  let digits = 2;
  try {
    digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
  } catch {}
  const scale = 10 ** digits;
  return Math.round((amount + Number.EPSILON) * scale) / scale;
}

function isValidSessionId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9-]{8,80}$/.test(value);
}

async function createPaypalOrder(request, response) {
  if (!hasPaypalCredentials()) {
    return sendJson(response, 503, { error: 'PayPal Sandbox is not configured yet. Add its REST app credentials to .env.' });
  }

  let body;
  try {
    body = await readJson(request);
  } catch {
    return sendJson(response, 400, { error: 'Please send a valid checkout request.' });
  }
  const { sessionId } = body;
  if (!isValidSessionId(sessionId)) return sendJson(response, 400, { error: 'Invalid shopping session.' });

  const cart = carts.get(sessionId);
  if (!cart || cart.size === 0) return sendJson(response, 400, { error: 'Your cart is empty.' });
  const summary = getCartSummary(sessionId);
  if (!/^[A-Z]{3}$/.test(summary.currency) || summary.total <= 0) {
    return sendJson(response, 400, { error: 'The cart needs a valid currency and total before checkout.' });
  }

  try {
    const accessToken = await getPaypalAccessToken();
    const items = [...cart.values()].map(({ product, quantity }) => ({
      name: String(product.name).slice(0, 127),
      quantity: String(quantity),
      unit_amount: {
        currency_code: summary.currency,
        value: toPaypalMoney(product.price, summary.currency),
      },
      category: 'PHYSICAL_GOODS',
    }));
    const orderPayload = {
      intent: 'CAPTURE',
      purchase_units: [{
        description: 'Buypal Sandbox demo transaction. No retailer order or delivery is created.',
        items,
        amount: {
          currency_code: summary.currency,
          value: toPaypalMoney(summary.total, summary.currency),
          breakdown: { item_total: { currency_code: summary.currency, value: toPaypalMoney(summary.total, summary.currency) } },
        },
      }],
      payment_source: {
        paypal: { experience_context: { user_action: 'PAY_NOW', shipping_preference: 'NO_SHIPPING' } },
      },
    };

    const paypalResponse = await fetch('https://api-m.sandbox.paypal.com/v2/checkout/orders', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${accessToken}`,
        'paypal-request-id': randomUUID(),
        prefer: 'return=representation',
      },
      body: JSON.stringify(orderPayload),
      signal: AbortSignal.timeout(20000),
    });
    const paypalData = await paypalResponse.json().catch(() => ({}));
    if (!paypalResponse.ok || !paypalData.id) {
      console.error(`PayPal order creation failed with HTTP ${paypalResponse.status}`);
      return sendJson(response, 502, { error: 'PayPal could not create the Sandbox order. Check the REST app credentials and cart currency.' });
    }

    paypalOrders.set(paypalData.id, {
      sessionId,
      expectedAmount: toPaypalMoney(summary.total, summary.currency),
      currency: summary.currency,
      cartFingerprint: cartFingerprint(sessionId),
      status: 'CREATED',
      captureRequestId: randomUUID(),
      captureResponse: null,
    });
    return sendJson(response, 201, { orderId: paypalData.id });
  } catch (error) {
    console.error('PayPal order request failed:', error.name || 'Error', error.message || 'No additional details');
    const message = error.paypalStatus === 401 || error.paypalStatus === 403
      ? 'PayPal Sandbox rejected these credentials. Re-copy the Client ID and Secret from the same Sandbox REST app into .env.'
      : 'Could not reach PayPal Sandbox. Check the server terminal and try again.';
    return sendJson(response, 502, { error: message });
  }
}

async function capturePaypalOrder(request, response, orderId) {
  if (!hasPaypalCredentials()) {
    return sendJson(response, 503, { error: 'PayPal Sandbox is not configured yet.' });
  }
  let body;
  try {
    body = await readJson(request);
  } catch {
    return sendJson(response, 400, { error: 'Please send a valid capture request.' });
  }
  const { sessionId } = body;
  if (!isValidSessionId(sessionId)) return sendJson(response, 400, { error: 'Invalid shopping session.' });
  const order = paypalOrders.get(orderId);
  if (!order || order.sessionId !== sessionId) return sendJson(response, 404, { error: 'PayPal order not found for this shopping session.' });
  if (order.status === 'COMPLETED') return sendJson(response, 200, order.captureResponse);
  if (order.status === 'CAPTURING') return sendJson(response, 409, { error: 'Payment is already being processed. Please wait.' });
  if (cartFingerprint(sessionId) !== order.cartFingerprint) {
    return sendJson(response, 409, { error: 'Your cart changed during checkout. The approved payment was not captured; return to Buypal and review your cart.' });
  }

  order.status = 'CAPTURING';
  try {
    const accessToken = await getPaypalAccessToken();
    const paypalResponse = await fetch(`https://api-m.sandbox.paypal.com/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${accessToken}`,
        'paypal-request-id': order.captureRequestId,
        prefer: 'return=representation',
      },
      body: '{}',
      signal: AbortSignal.timeout(20000),
    });
    const paypalData = await paypalResponse.json().catch(() => ({}));
    if (!paypalResponse.ok) {
      order.status = 'APPROVED';
      console.error(`PayPal capture failed with HTTP ${paypalResponse.status}`);
      return sendJson(response, 502, { error: 'PayPal could not complete the Sandbox payment. The cart is unchanged; you can try again.' });
    }

    const capture = paypalData.purchase_units?.[0]?.payments?.captures?.[0];
    const capturedAmount = capture?.amount?.value;
    const capturedCurrency = capture?.amount?.currency_code;
    if (paypalData.id === orderId && paypalData.status === 'COMPLETED' && capture?.status === 'COMPLETED'
      && capturedAmount === order.expectedAmount && capturedCurrency === order.currency) {
      order.status = 'COMPLETED';
      order.captureResponse = {
        status: 'COMPLETED',
        orderId,
        captureId: capture.id || '',
        amount: capturedAmount,
        currency: capturedCurrency,
      };
      carts.delete(sessionId);
      return sendJson(response, 200, order.captureResponse);
    }

    if (capture?.status === 'PENDING' || paypalData.status === 'PENDING') {
      order.status = 'PENDING';
      return sendJson(response, 200, { status: 'PENDING', orderId, message: 'PayPal reports that this payment is still pending.' });
    }

    order.status = paypalData.status === 'COMPLETED' ? 'VERIFICATION_FAILED' : (paypalData.status || 'FAILED');
    return sendJson(response, 402, { status: order.status, error: 'PayPal did not confirm a completed payment. Your cart is unchanged.' });
  } catch (error) {
    order.status = 'APPROVED';
    console.error('PayPal capture request failed:', error.name || 'Error', error.message || 'No additional details');
    const message = error.paypalStatus === 401 || error.paypalStatus === 403
      ? 'PayPal Sandbox rejected these credentials. Re-copy the Client ID and Secret from the same Sandbox REST app into .env.'
      : 'Could not verify the Sandbox payment with PayPal. Please check the order before retrying.';
    return sendJson(response, 502, { error: message });
  }
}

function hasPaypalCredentials() {
  return Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
}

async function getPaypalAccessToken() {
  const credentials = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64');
  const response = await fetch('https://api-m.sandbox.paypal.com/v1/oauth2/token', {
    method: 'POST',
    headers: {
      authorization: `Basic ${credentials}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    const error = new Error(`PayPal authentication failed with HTTP ${response.status}`);
    error.paypalStatus = response.status;
    throw error;
  }
  return data.access_token;
}

function toPaypalMoney(amount, currency) {
  let digits = 2;
  try {
    digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
  } catch {}
  return roundCurrency(Number(amount), currency).toFixed(digits);
}

function cartFingerprint(sessionId) {
  const cart = carts.get(sessionId) || new Map();
  return JSON.stringify([...cart.entries()].map(([id, item]) => [id, item.quantity]).sort(([a], [b]) => a.localeCompare(b)));
}

function extractProducts(data) {
  if (Array.isArray(data)) return data;
  for (const key of ['products', 'results', 'items']) {
    if (Array.isArray(data?.[key])) return data[key];
  }
  return [];
}

function toDisplayProduct(product) {
  if (!product || typeof product !== 'object') return null;
  const offers = Array.isArray(product.offers) ? product.offers : [];
  const offer = offers.find((item) => item && item.url) || offers[0] || {};
  const price = offer.price?.price ?? offer.price ?? product.price?.price ?? product.price ?? null;
  const currency = offer.price?.currency ?? product.price?.currency ?? '';
  const rawPrice = typeof price === 'number' ? price : Number(price);
  const image = Array.isArray(product.images) ? product.images[0] : product.image;
  const attributes = product.structured_attributes || product.attributes || product.specifications
    || product.key_features || product.features || null;
  const safeCurrency = typeof currency === 'string' ? currency.toUpperCase() : '';
  const rawBrand = product.brand || (Array.isArray(product.brands) ? product.brands[0] : '');
  const brand = typeof rawBrand === 'string'
    ? rawBrand
    : rawBrand?.name || rawBrand?.brand || rawBrand?.title || '';
  const numericPrice = Number.isFinite(rawPrice) && rawPrice >= 0
    ? (safeCurrency ? roundCurrency(rawPrice, safeCurrency) : rawPrice)
    : null;

  return {
    id: String(product.id || product.product_id || product.url || product.title || product.name || Math.random()),
    name: product.title || product.name || 'Product name unavailable',
    brand,
    image: typeof image === 'string' ? image : image?.url || '',
    price: numericPrice,
    currency: safeCurrency,
    merchant: offer.merchant || offer.shop || offer.retailer || '',
    buyUrl: offer.url || product.url || '',
    offersCount: offers.length,
    attributes: normalizeAttributes(attributes),
    source: 'Channel3',
  };
}

function normalizeAttributes(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.slice(0, 6).map((item) => {
      if (typeof item === 'string') return item;
      if (!item || typeof item !== 'object') return '';
      const label = item.name || item.label || item.key || '';
      const detail = item.value || item.description || '';
      return label && detail ? `${label}: ${detail}` : String(detail || label);
    }).filter(Boolean);
  }
  if (typeof value === 'object') {
    return Object.entries(value).slice(0, 6).map(([key, detail]) =>
      `${key}: ${typeof detail === 'string' || typeof detail === 'number' ? detail : JSON.stringify(detail)}`,
    );
  }
  return typeof value === 'string' ? [value] : [];
}

function normalizePreferences(value) {
  if (!value || typeof value !== 'object') return { brandScores: {} };
  const brandScores = {};
  if (value.brandScores && typeof value.brandScores === 'object') {
    for (const [brand, score] of Object.entries(value.brandScores).slice(0, 30)) {
      const numericScore = Number(score);
      if (brand.length <= 80 && Number.isFinite(numericScore)) {
        brandScores[brand.toLowerCase()] = Math.max(-5, Math.min(5, numericScore));
      }
    }
  }
  return { brandScores };
}

function buildRecommendations(products, preferences = { brandScores: {} }) {
  const priced = products.filter((product) => product.price !== null);
  if (priced.length === 0) return [];

  const sorted = [...priced].sort((a, b) => a.price - b.price);
  const budget = sorted[0];
  const premium = sorted[sorted.length - 1];
  const middlePrice = sorted[Math.floor((sorted.length - 1) / 2)].price;
  const priceRange = Math.max(1, sorted[sorted.length - 1].price - sorted[0].price);
  const smart = [...priced].sort((a, b) => {
    const score = (product) => {
      const priceBalance = 1 - Math.abs(product.price - middlePrice) / priceRange;
      const brandFeedback = preferences.brandScores[(product.brand || '').toLowerCase()] || 0;
      return priceBalance + brandFeedback * 0.035;
    };
    return score(b) - score(a);
  })[0];
  const smartBrandScore = preferences.brandScores[(smart.brand || '').toLowerCase()] || 0;

  const choices = [
    {
      strategy: 'Budget',
      label: 'Lowest listed price',
      product: budget,
      reason: `Lowest listed price among ${priced.length} products with a price.`,
    },
    {
      strategy: 'Smart',
      label: 'Balanced price',
      product: smart,
      reason: smartBrandScore > 0
        ? `Balances price with your positive feedback for ${smart.brand}. This is not a product quality rating.`
        : smartBrandScore < 0
          ? `Balances price while weighing your lower feedback for ${smart.brand} against the available prices. This is not a product quality rating.`
          : 'Closest to a balanced price in the results. This is a price-based balance, not a quality rating.',
    },
    {
      strategy: 'Premium',
      label: 'Highest listed price',
      product: premium,
      reason: 'Highest listed price among these results. A higher price alone does not confirm higher quality.',
    },
  ];

  const seen = new Set();
  return choices.filter((choice) => {
    if (seen.has(choice.product.id)) return false;
    seen.add(choice.product.id);
    return true;
  });
}

async function readJson(request) {
  let content = '';
  for await (const chunk of request) {
    content += chunk;
    if (content.length > 8192) throw new Error('Request too large');
  }
  return JSON.parse(content || '{}');
}

function serveStatic(urlPath, response) {
  const requestedPath = urlPath === '/' ? '/index.html' : decodeURIComponent(urlPath);
  const filePath = path.resolve(publicDir, `.${requestedPath}`);
  if (!filePath.startsWith(`${publicDir}${path.sep}`)) {
    response.writeHead(403);
    return response.end('Forbidden');
  }
  fs.readFile(filePath, (error, contents) => {
    if (error) {
      response.writeHead(404);
      return response.end('Not found');
    }
    response.writeHead(200, { 'content-type': mimeTypes[path.extname(filePath)] || 'application/octet-stream' });
    response.end(contents);
  });
}

function sendJson(response, status, data) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(data));
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}
