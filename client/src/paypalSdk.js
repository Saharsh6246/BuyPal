const SDK_URL = 'https://www.sandbox.paypal.com/web-sdk/v6/core';

/** Loads the PayPal Sandbox v6 JS SDK once and resolves when `window.paypal` is ready. */
export function loadPayPalSdk() {
  if (window.paypal?.createInstance) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let script = document.getElementById('paypal-sdk');
    if (!script) {
      script = document.createElement('script');
      script.id = 'paypal-sdk';
      script.src = SDK_URL;
      script.async = true;
      document.head.append(script);
    }
    script.addEventListener('load', () => (window.paypal?.createInstance ? resolve() : reject(new Error('PayPal SDK is unavailable'))), { once: true });
    script.addEventListener('error', () => reject(new Error('PayPal SDK failed to load')), { once: true });
  });
}
