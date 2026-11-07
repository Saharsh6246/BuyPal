import { config } from '../config.js';

export function currencyDigits(currency) {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
  } catch {
    return 2;
  }
}

export function roundMoney(amount, currency = 'USD') {
  const scale = 10 ** currencyDigits(currency);
  return Math.round((Number(amount) + Number.EPSILON) * scale) / scale;
}

/** Fixed-decimal string as PayPal expects, e.g. "699.00". */
export function paypalMoney(amount, currency = 'USD') {
  return roundMoney(amount, currency).toFixed(currencyDigits(currency));
}

/** Convert a user-stated budget to USD, the currency Channel3 returns prices in. */
export function toUsd(amount, currency = 'USD') {
  if (!Number.isFinite(amount)) return null;
  if (!currency || currency === 'USD') return amount;
  if (currency === 'INR') return amount / config.inrPerUsd;
  return null; // Unknown currency: never guess a conversion rate.
}

export const fmtUsd = (amount) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(amount);
