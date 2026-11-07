import { all } from '../db.js';
import { getPriority, getProfile } from './preferences.js';

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : null;
};
const BASKET = { Budget: 'Best price', Smart: 'Best overall', Premium: 'Best quality', Fastest: 'Quickest delivery' };

/**
 * Buypal's explainable "read" on a shopper, built only from their own choices and completed orders.
 * It is shown to the user in their profile and given (compactly) to the AI so replies reflect who they are.
 */
export function getUserModel(userId) {
  const orders = all("SELECT items_json FROM orders WHERE user_id=? AND status='COMPLETED' ORDER BY id DESC LIMIT 50", userId);
  const items = orders.flatMap((o) => JSON.parse(o.items_json));
  const picks = all("SELECT strategy, category, brand FROM feedback_events WHERE user_id=? AND type IN ('select','purchase') ORDER BY id DESC LIMIT 200", userId);

  const tally = {};
  for (const row of picks) if (BASKET[row.strategy]) tally[row.strategy] = (tally[row.strategy] || 0) + 1;
  const totalPicks = Object.values(tally).reduce((a, b) => a + b, 0);

  const categoryCounts = {};
  for (const row of picks) if (row.category) categoryCounts[row.category] = (categoryCounts[row.category] || 0) + 1;
  const topCategories = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([category, count]) => ({ category, count }));

  const brandCounts = {};
  for (const row of picks) if (row.brand) brandCounts[row.brand.toLowerCase()] = (brandCounts[row.brand.toLowerCase()] || 0) + 1;
  const favouriteBrands = Object.entries(brandCounts).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([b]) => b);

  const typicalSpendUsd = median(items.map((i) => Number(i.price)).filter(Number.isFinite));
  const profile = getProfile(userId, null);
  const priority = getPriority(userId);

  const lines = [];
  if (totalPicks >= 2) {
    const [top, n] = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
    lines.push(`${BASKET[top] || top} is your most chosen basket (${n} of ${totalPicks} choices).`);
  }
  if ((tally.Fastest || 0) / Math.max(1, totalPicks) >= 0.4 && totalPicks >= 3) lines.push('You often shop against the clock, so fast delivery gets extra weight.');
  if (topCategories.length) lines.push(`You shop most for ${topCategories.map((c) => c.category).join(', ')}.`);
  if (typicalSpendUsd != null) lines.push(`Your typical item costs about $${typicalSpendUsd.toFixed(2)}.`);
  if (favouriteBrands.length) lines.push(`Brands you come back to: ${favouriteBrands.join(', ')}.`);
  if (profile.budgetSensitivity > 0.4) lines.push('You are price-sensitive.');
  if (profile.budgetSensitivity < -0.4) lines.push('You lean towards quality over price.');

  return {
    priority,
    purchases: items.length,
    basketTally: tally,
    totalPicks,
    topCategories,
    favouriteBrands,
    typicalSpendUsd,
    budgetSensitivity: Math.round(profile.budgetSensitivity * 100) / 100,
    lines,
  };
}

/** A compact snapshot for the LLM's context (a few dozen tokens). */
export function userModelForLlm(userId) {
  const m = getUserModel(userId);
  return {
    stated_priority: m.priority,
    purchases_completed: m.purchases,
    basket_choices: m.basketTally,
    top_categories: m.topCategories.map((c) => c.category),
    favourite_brands: m.favouriteBrands,
    typical_item_price_usd: m.typicalSpendUsd,
    price_sensitivity: m.budgetSensitivity,
  };
}
