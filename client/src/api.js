const KEY = 'buypal-user-id';

function getUserId() {
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
  }
  return id;
}

export const userId = getUserId();

async function call(path, { method = 'GET', body } = {}) {
  const response = await fetch(`/api${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-user-id': userId },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || 'Something went wrong. Please try again.');
    error.data = data;
    error.status = response.status;
    throw error;
  }
  return data;
}

export const api = {
  config: () => call('/config'),
  history: () => call('/history'),
  clearHistory: () => call('/history', { method: 'DELETE' }),
  chat: (message) => call('/chat', { method: 'POST', body: { message } }),
  cart: () => call('/cart'),
  addToCart: (productId, strategy, category) => call('/cart', { method: 'POST', body: { productId, strategy, category } }),
  setQuantity: (id, quantity) => call(`/cart/items/${encodeURIComponent(id)}`, { method: 'PATCH', body: { quantity } }),
  removeItem: (id) => call(`/cart/items/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  clearCart: () => call('/cart', { method: 'DELETE' }),
  feedback: (payload) => call('/feedback', { method: 'POST', body: payload }),
  preferences: () => call('/preferences'),
  setPreference: (payload) => call('/preferences', { method: 'PUT', body: payload }),
  resetPreferences: () => call('/preferences', { method: 'DELETE' }),
  createOrder: () => call('/paypal/orders', { method: 'POST' }),
  captureOrder: (orderId) => call(`/paypal/orders/${encodeURIComponent(orderId)}/capture`, { method: 'POST' }),
  orders: () => call('/orders'),
};

export const money = (value) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);
