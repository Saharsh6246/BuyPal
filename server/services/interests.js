import { all, ensureUser, run } from '../db.js';

/** Remembers what the user searched for, so the home screen can be personalised. */
export function recordSearch(userId, { query, category, budgetUsd }) {
  ensureUser(userId);
  run('INSERT INTO search_history (user_id, query, category, budget_usd) VALUES (?,?,?,?)',
    userId, String(query || category || '').slice(0, 200), category ? String(category).toLowerCase().slice(0, 40) : null, budgetUsd ?? null);
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : null;
};

/**
 * Interest model: searches count 1, likes 1.5, cart adds 2 and purchases 3, each fading by half every 14 days.
 * Fully explainable: the home screen tells the user which searches it is based on.
 */
export function getInterests(userId) {
  const now = Date.now();
  const decay = (iso) => 0.5 ** ((now - Date.parse(`${iso}Z`)) / (14 * 86400000));
  const byCategory = new Map();
  const bump = (category, weight) => {
    if (!category) return;
    const entry = byCategory.get(category) || { category, score: 0, budgets: [] };
    entry.score += weight;
    byCategory.set(category, entry);
    return entry;
  };

  const searches = all("SELECT query, category, budget_usd, created_at FROM search_history WHERE user_id=? AND created_at > datetime('now','-60 days') ORDER BY id DESC LIMIT 200", userId);
  for (const row of searches) {
    const entry = bump(row.category, 1 * decay(row.created_at));
    if (entry && row.budget_usd) entry.budgets.push(row.budget_usd);
  }
  const events = all("SELECT type, category, created_at FROM feedback_events WHERE user_id=? AND category IS NOT NULL AND type IN ('select','like','purchase') AND created_at > datetime('now','-60 days')", userId);
  const weights = { like: 1.5, select: 2, purchase: 3 };
  for (const row of events) bump(row.category, weights[row.type] * decay(row.created_at));

  const interests = [...byCategory.values()]
    .map((e) => ({ category: e.category, score: Math.round(e.score * 100) / 100, typicalBudget: median(e.budgets) }))
    .sort((a, b) => b.score - a.score);
  const recent = [...new Set(searches.map((s) => s.query))].slice(0, 5);
  return { interests, recent };
}
