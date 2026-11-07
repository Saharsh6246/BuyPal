const form = document.querySelector('#search-form');
const input = document.querySelector('#search-input');
const resultsSection = document.querySelector('#results-section');
const resultsTitle = document.querySelector('#results-title');
const statusBox = document.querySelector('#status');
const productGrid = document.querySelector('#product-grid');
const recommendationGrid = document.querySelector('#recommendation-grid');
const allResultsHeading = document.querySelector('#all-results-heading');
const cartToggle = document.querySelector('#cart-toggle');
const cartPanel = document.querySelector('#cart-panel');
const cartBackdrop = document.querySelector('#cart-backdrop');
const cartItems = document.querySelector('#cart-items');
const cartEmpty = document.querySelector('#cart-empty');
const cartFooter = document.querySelector('#cart-footer');
const cartSessionId = getCartSessionId();
const preferencesPanel = document.querySelector('#preferences-panel');
const preferencesBackdrop = document.querySelector('#preferences-backdrop');
const preferencesToggle = document.querySelector('#preferences-toggle');
const preferenceStorageKey = 'buypal-preferences';
const paypalButton = document.querySelector('#paypal-button');
const paypalStatus = document.querySelector('#paypal-status');

let preferences = getPreferences();
let currentCart = { items: [], count: 0, currency: '', total: 0 };
let paypalPaymentSession = null;
let paypalReadyCurrency = '';
let paypalSetupPromise = null;

document.querySelector('#cart-close').addEventListener('click', closeCart);
cartBackdrop.addEventListener('click', closeCart);
cartToggle.addEventListener('click', () => {
  if (cartPanel.hidden) openCart();
  else closeCart();
});

syncCart();
renderPreferences();

document.querySelector('#preferences-close').addEventListener('click', closePreferences);
preferencesBackdrop.addEventListener('click', closePreferences);
preferencesToggle.addEventListener('click', () => {
  if (preferencesPanel.hidden) openPreferences();
  else closePreferences();
});
document.querySelector('#reset-preferences').addEventListener('click', () => {
  preferences = { brandScores: {}, strategyScores: {} };
  savePreferences();
  renderPreferences();
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  searchProducts(input.value);
});

document.querySelectorAll('[data-query]').forEach((button) => {
  button.addEventListener('click', () => {
    input.value = button.dataset.query;
    searchProducts(input.value);
  });
});

async function searchProducts(query) {
  resultsSection.hidden = false;
  resultsTitle.textContent = `Results for “${query.trim()}”`;
  statusBox.className = 'status';
  statusBox.textContent = 'Searching real product listings…';
  productGrid.replaceChildren();
  recommendationGrid.replaceChildren();
  allResultsHeading.hidden = true;
  resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

  try {
    const response = await fetch('/api/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, preferences }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Search could not be completed.');

    if (!data.products.length) {
      statusBox.textContent = 'No matching listings came back. Try a broader search, such as “laptop for college”.';
      return;
    }

    statusBox.textContent = `${data.count} product${data.count === 1 ? '' : 's'} found through Channel3.`;
    const recommendations = [...(data.recommendations || [])].sort((a, b) =>
      (preferences.strategyScores[b.strategy] || 0) - (preferences.strategyScores[a.strategy] || 0),
    );
    if (recommendations.length && (preferences.strategyScores[recommendations[0].strategy] || 0) > 0) {
      recommendations[0].preferred = true;
    }
    recommendations.forEach((recommendation) => {
      recommendationGrid.append(createRecommendationCard(recommendation));
    });
    const recommendedIds = new Set(recommendations.map((item) => item.product.id));
    const additionalProducts = data.products.filter((product) => !recommendedIds.has(product.id));
    allResultsHeading.hidden = additionalProducts.length === 0;
    additionalProducts.forEach((product) => productGrid.append(createProductCard(product)));
  } catch (error) {
    statusBox.classList.add('error');
    statusBox.textContent = error.message;
  }
}

function createProductCard(product, strategy = '') {
  const card = document.createElement('article');
  card.className = 'product-card';

  const imageArea = document.createElement('div');
  imageArea.className = 'product-image';
  if (product.image) {
    const image = document.createElement('img');
    image.src = product.image;
    image.alt = product.name;
    image.loading = 'lazy';
    image.onerror = () => imageArea.replaceChildren(makePlaceholder());
    imageArea.append(image);
  } else {
    imageArea.append(makePlaceholder());
  }

  const info = document.createElement('div');
  info.className = 'product-info';
  info.append(makeText('p', 'product-brand', product.brand || 'Brand unavailable'));
  info.append(makeText('h3', '', product.name));
  info.append(makeText('p', 'product-price', formatPrice(product.price, product.currency)));
  info.append(makeText('p', 'product-merchant', product.merchant || 'Retailer details unavailable'));

  if (product.attributes?.length) {
    const attributes = document.createElement('ul');
    attributes.className = 'product-attributes';
    product.attributes.forEach((attribute) => attributes.append(makeText('li', '', attribute)));
    info.append(attributes);
  }

  if (product.offersCount > 1) {
    info.append(makeText('div', 'product-offers', `${product.offersCount} retailer offers available`));
  }

  if (product.buyUrl && isHttpUrl(product.buyUrl)) {
    const link = document.createElement('a');
    link.className = 'product-buy';
    link.href = product.buyUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'View at retailer ↗';
    info.append(link);
  }

  const addButton = document.createElement('button');
  addButton.type = 'button';
  addButton.className = 'add-to-cart';
  addButton.textContent = product.price === null || !product.currency ? 'Price needed for cart' : 'Add to cart';
  addButton.disabled = product.price === null || !product.currency;
  addButton.addEventListener('click', async () => {
    addButton.disabled = true;
    addButton.textContent = 'Adding…';
    try {
      const cart = await requestCart(`/api/cart`, {
        method: 'POST',
        body: JSON.stringify({ sessionId: cartSessionId, productId: product.id }),
      });
      renderCart(cart);
      paypalStatus.hidden = true;
      addButton.textContent = 'Added to cart ✓';
      window.setTimeout(() => {
        addButton.textContent = 'Add to cart';
        addButton.disabled = false;
      }, 1100);
    } catch (error) {
      addButton.textContent = error.message;
      window.setTimeout(() => {
        addButton.textContent = 'Add to cart';
        addButton.disabled = false;
      }, 2200);
    }
  });
  info.append(addButton);

  const feedback = document.createElement('div');
  feedback.className = 'product-feedback';
  const like = makeText('button', '', '♡ Like this');
  const pass = makeText('button', '', 'Not for me');
  [like, pass].forEach((button) => { button.type = 'button'; });
  like.addEventListener('click', () => recordFeedback(product, strategy, 1, feedback));
  pass.addEventListener('click', () => recordFeedback(product, strategy, -1, feedback));
  feedback.append(like, pass);
  info.append(feedback);

  card.append(imageArea, info);
  return card;
}

function getCartSessionId() {
  const storageKey = 'buypal-cart-session';
  let value = localStorage.getItem(storageKey);
  if (!value) {
    value = globalThis.crypto?.randomUUID?.() || `bp-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
    localStorage.setItem(storageKey, value);
  }
  return value;
}

async function syncCart() {
  try {
    const response = await fetch(`/api/cart?sessionId=${encodeURIComponent(cartSessionId)}`);
    const cart = await response.json();
    if (response.ok) renderCart(cart);
  } catch {
    // The cart will refresh the next time a shopper opens or changes it.
  }
}

async function requestCart(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not update the cart.');
  return data;
}

function renderCart(cart) {
  currentCart = cart;
  document.querySelector('#cart-count').textContent = String(cart.count);
  document.querySelector('#cart-title-count').textContent = `(${cart.count})`;
  cartItems.replaceChildren();
  cartEmpty.hidden = cart.items.length > 0;
  cartFooter.hidden = cart.items.length === 0;
  if (cart.items.length) {
    cart.items.forEach((item) => cartItems.append(createCartItem(item)));
    document.querySelector('#cart-total').textContent = formatPrice(cart.total, cart.currency);
  } else {
    paypalButton.hidden = true;
  }
  if (cart.items.length && !cartPanel.hidden) refreshPayPalButton();
}

function createCartItem(item) {
  const row = document.createElement('article');
  row.className = 'cart-item';
  const image = document.createElement('div');
  image.className = 'cart-item-image';
  if (item.product.image) {
    const photo = document.createElement('img');
    photo.src = item.product.image;
    photo.alt = item.product.name;
    photo.loading = 'lazy';
    photo.onerror = () => image.replaceChildren(makePlaceholder());
    image.append(photo);
  } else image.append(makePlaceholder());

  const details = document.createElement('div');
  details.className = 'cart-item-details';
  details.append(makeText('strong', '', item.product.name));
  details.append(makeText('span', 'cart-item-merchant', item.product.merchant || 'Retailer unavailable'));
  details.append(makeText('span', 'cart-item-price', formatPrice(item.product.price, item.product.currency)));

  const controls = document.createElement('div');
  controls.className = 'quantity-controls';
  const decrement = makeText('button', '', '−');
  decrement.type = 'button';
  decrement.setAttribute('aria-label', `Decrease quantity of ${item.product.name}`);
  decrement.disabled = item.quantity <= 1;
  decrement.addEventListener('click', () => updateCartItem(item.id, item.quantity - 1));
  const quantity = makeText('span', '', String(item.quantity));
  const increment = makeText('button', '', '+');
  increment.type = 'button';
  increment.setAttribute('aria-label', `Increase quantity of ${item.product.name}`);
  increment.disabled = item.quantity >= 10;
  increment.addEventListener('click', () => updateCartItem(item.id, item.quantity + 1));
  controls.append(decrement, quantity, increment);

  const line = document.createElement('div');
  line.className = 'cart-item-line';
  line.append(controls, makeText('strong', '', formatPrice(item.lineTotal, item.product.currency)));
  const remove = makeText('button', 'remove-item', 'Remove');
  remove.type = 'button';
  remove.addEventListener('click', () => removeCartItem(item.id));
  details.append(line, remove);
  row.append(image, details);
  return row;
}

async function updateCartItem(productId, quantity) {
  try {
    const cart = await requestCart(`/api/cart/items/${encodeURIComponent(productId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ sessionId: cartSessionId, quantity }),
    });
    renderCart(cart);
  } catch (error) {
    window.alert(error.message);
  }
}

async function removeCartItem(productId) {
  try {
    const cart = await requestCart(`/api/cart/items/${encodeURIComponent(productId)}`, {
      method: 'DELETE',
      body: JSON.stringify({ sessionId: cartSessionId }),
    });
    renderCart(cart);
  } catch (error) {
    window.alert(error.message);
  }
}

function openCart() {
  cartPanel.hidden = false;
  cartBackdrop.hidden = false;
  cartPanel.setAttribute('aria-hidden', 'false');
  cartToggle.setAttribute('aria-expanded', 'true');
  refreshPayPalButton();
}

function closeCart() {
  cartPanel.hidden = true;
  cartBackdrop.hidden = true;
  cartPanel.setAttribute('aria-hidden', 'true');
  cartToggle.setAttribute('aria-expanded', 'false');
}

async function refreshPayPalButton() {
  if (!currentCartHasItems()) {
    paypalButton.hidden = true;
    return;
  }
  if (paypalReadyCurrency === currentCart.currency && paypalPaymentSession) {
    paypalButton.hidden = false;
    return;
  }
  if (paypalSetupPromise) return paypalSetupPromise;

  paypalSetupPromise = setupPayPalForCurrency(currentCart.currency);
  try {
    await paypalSetupPromise;
  } finally {
    paypalSetupPromise = null;
  }
}

function currentCartHasItems() {
  return Boolean(currentCart?.items?.length && currentCart.currency);
}

async function setupPayPalForCurrency(currency) {
  paypalButton.hidden = true;
  paypalStatus.hidden = true;
  let config;
  try {
    const response = await fetch('/api/paypal/config');
    config = await response.json();
    if (!response.ok) throw new Error('Could not load PayPal Sandbox settings.');
  } catch (error) {
    showPayPalStatus(error.message, 'error');
    return;
  }

  if (!config.configured) {
    showPayPalStatus('PayPal Sandbox needs a client ID and secret in the server .env file.', 'info');
    return;
  }

  try {
    await loadPayPalSdk();
    const sdk = await window.paypal.createInstance({
      clientId: config.clientId,
      components: ['paypal-payments'],
      pageType: 'cart',
    });
    const methods = await sdk.findEligibleMethods({ currencyCode: currency });
    if (!methods.isEligible('paypal')) {
      showPayPalStatus(`PayPal Sandbox checkout is not available for ${currency}.`, 'info');
      return;
    }

    paypalPaymentSession = sdk.createPayPalOneTimePaymentSession({
      onApprove: async ({ orderId }) => {
        showPayPalStatus('Payment approved. Verifying it with PayPal…', 'info');
        try {
          const receipt = await requestCart(`/api/paypal/orders/${encodeURIComponent(orderId)}/capture`, {
            method: 'POST',
            body: JSON.stringify({ sessionId: cartSessionId }),
          });
          if (receipt.status === 'COMPLETED') {
            renderCart({ items: [], count: 0, currency: '', total: 0 });
            showPayPalStatus(`Sandbox payment complete for ${formatPrice(Number(receipt.amount), receipt.currency)}. No retailer order was placed.`, 'success');
          } else {
            showPayPalStatus(receipt.message || 'PayPal is still processing this Sandbox payment. Your cart is unchanged.', 'info');
          }
        } catch (error) {
          showPayPalStatus(error.message, 'error');
        }
      },
      onCancel: () => showPayPalStatus('Checkout cancelled. No payment was captured; your cart is unchanged.', 'info'),
      onError: () => showPayPalStatus('PayPal could not complete checkout. Your cart is unchanged.', 'error'),
    });
    paypalReadyCurrency = currency;
    paypalButton.hidden = false;
    if (!paypalButton.dataset.listenerAttached) {
      paypalButton.addEventListener('click', startPayPalCheckout);
      paypalButton.dataset.listenerAttached = 'true';
    }
  } catch (error) {
    console.error('PayPal SDK setup failed:', error.name || 'Error');
    showPayPalStatus('Could not load PayPal Sandbox checkout. Check your connection and credentials.', 'error');
  }
}

async function loadPayPalSdk() {
  if (window.paypal?.createInstance) return;
  let script = document.querySelector('#paypal-sdk-script');
  if (!script) {
    script = document.createElement('script');
    script.id = 'paypal-sdk-script';
    script.src = 'https://www.sandbox.paypal.com/web-sdk/v6/core';
    script.async = true;
    document.head.append(script);
  }
  await new Promise((resolve, reject) => {
    if (window.paypal?.createInstance) return resolve();
    script.addEventListener('load', resolve, { once: true });
    script.addEventListener('error', () => reject(new Error('PayPal SDK failed to load')), { once: true });
  });
  if (!window.paypal?.createInstance) throw new Error('PayPal SDK is unavailable');
}

async function startPayPalCheckout() {
  if (!paypalPaymentSession) return;
  paypalButton.setAttribute('disabled', 'disabled');
  showPayPalStatus('Preparing your Sandbox payment…', 'info');
  try {
    const orderPromise = requestCart('/api/paypal/orders', {
      method: 'POST',
      body: JSON.stringify({ sessionId: cartSessionId }),
    }).then((order) => ({ orderId: order.orderId }));
    await paypalPaymentSession.start({ presentationMode: 'auto' }, orderPromise);
  } catch (error) {
    showPayPalStatus(error.message || 'Could not start PayPal checkout.', 'error');
  } finally {
    paypalButton.removeAttribute('disabled');
  }
}

function showPayPalStatus(message, kind) {
  paypalStatus.className = `paypal-status ${kind}`;
  paypalStatus.textContent = message;
  paypalStatus.hidden = false;
}

function createRecommendationCard(recommendation) {
  const card = createProductCard(recommendation.product, recommendation.strategy);
  card.classList.add('recommendation-card');
  if (recommendation.preferred) card.classList.add('preferred-strategy');
  const badge = document.createElement('div');
  badge.className = `strategy-badge strategy-${recommendation.strategy.toLowerCase()}`;
  badge.append(makeText('strong', '', recommendation.strategy));
  badge.append(makeText('span', '', recommendation.label));
  if (recommendation.preferred) badge.append(makeText('em', '', 'Often your pick'));
  const reason = makeText('p', 'recommendation-reason', recommendation.reason);
  card.prepend(badge);
  card.querySelector('.product-info').append(reason);
  return card;
}

function getPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(preferenceStorageKey) || '{}');
    return {
      brandScores: saved.brandScores && typeof saved.brandScores === 'object' ? saved.brandScores : {},
      strategyScores: saved.strategyScores && typeof saved.strategyScores === 'object' ? saved.strategyScores : {},
    };
  } catch {
    return { brandScores: {}, strategyScores: {} };
  }
}

function savePreferences() {
  localStorage.setItem(preferenceStorageKey, JSON.stringify(preferences));
}

function recordFeedback(product, strategy, value, container) {
  if (product.brand) {
    const key = product.brand.toLowerCase();
    preferences.brandScores[key] = clampScore((preferences.brandScores[key] || 0) + value);
  }
  if (strategy) {
    preferences.strategyScores[strategy] = clampScore((preferences.strategyScores[strategy] || 0) + value);
  }
  savePreferences();
  renderPreferences();
  container.replaceChildren(makeText('span', 'feedback-thanks', value > 0 ? 'Thanks — preference saved' : 'Got it — preference saved'));
}

function clampScore(value) {
  return Math.max(-5, Math.min(5, value));
}

function renderPreferences() {
  const brandList = document.querySelector('#brand-preferences');
  const strategyList = document.querySelector('#strategy-preferences');
  brandList.replaceChildren();
  strategyList.replaceChildren();
  const brands = Object.entries(preferences.brandScores).filter(([, score]) => score !== 0);
  const strategies = Object.entries(preferences.strategyScores).filter(([, score]) => score !== 0);
  brands.forEach(([key, score]) => brandList.append(createPreferenceRow(key, score, 'brand')));
  strategies.forEach(([key, score]) => strategyList.append(createPreferenceRow(key, score, 'strategy')));
  document.querySelector('#preferences-empty').hidden = brands.length + strategies.length > 0;
}

function createPreferenceRow(key, score, type) {
  const row = document.createElement('div');
  row.className = 'preference-row';
  const label = type === 'brand'
    ? `${key}: ${score > 0 ? 'you like' : 'less preferred'}`
    : `${key}: ${score > 0 ? 'preferred style' : 'less preferred'}`;
  row.append(makeText('span', '', label));
  const controls = document.createElement('div');
  controls.className = 'preference-controls';
  const up = makeText('button', '', '+');
  const down = makeText('button', '', '−');
  const remove = makeText('button', 'preference-remove', '×');
  [up, down, remove].forEach((button) => { button.type = 'button'; });
  up.setAttribute('aria-label', `Increase preference for ${key}`);
  down.setAttribute('aria-label', `Decrease preference for ${key}`);
  up.addEventListener('click', () => adjustPreference(type, key, 1));
  down.addEventListener('click', () => adjustPreference(type, key, -1));
  remove.setAttribute('aria-label', `Remove preference for ${key}`);
  remove.addEventListener('click', () => adjustPreference(type, key, 0, true));
  controls.append(down, up, remove);
  row.append(controls);
  return row;
}

function adjustPreference(type, key, amount, remove = false) {
  const group = type === 'brand' ? 'brandScores' : 'strategyScores';
  if (remove) delete preferences[group][key];
  else preferences[group][key] = clampScore((preferences[group][key] || 0) + amount);
  savePreferences();
  renderPreferences();
}

function openPreferences() {
  closeCart();
  preferencesPanel.hidden = false;
  preferencesBackdrop.hidden = false;
  preferencesPanel.setAttribute('aria-hidden', 'false');
  preferencesToggle.setAttribute('aria-expanded', 'true');
}

function closePreferences() {
  preferencesPanel.hidden = true;
  preferencesBackdrop.hidden = true;
  preferencesPanel.setAttribute('aria-hidden', 'true');
  preferencesToggle.setAttribute('aria-expanded', 'false');
}

function makeText(tag, className, value) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = value;
  return element;
}

function makePlaceholder() {
  return makeText('span', 'image-placeholder', 'Image unavailable');
}

function formatPrice(price, currency) {
  if (price === null || price === undefined) return 'Price unavailable';
  if (!currency) return `${price} · currency unavailable`;
  const locale = currency === 'INR' ? 'en-IN' : 'en-US';
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(price);
  } catch {
    return `${currency ? `${currency} ` : ''}${price}`;
  }
}

function isHttpUrl(value) {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}
