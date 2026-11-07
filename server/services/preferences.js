import { all, ensureUser, get, run } from '../db.js';

// Explainable preference learning: every score is a small integer-ish counter that moves when the user
// acts (selects, likes, rejects with a reason, buys). No black-box model: the user can see and edit it all.

const MAX = 5;
export const PRIORITIES = {
  price: 'Lowest price that still meets your needs',
  quality: 'Best quality and performance',
  balanced: 'The best balance of price and quality',
};
const PRIORITY_STRATEGY = { price: 'Budget', quality: 'Premium', balanced: 'Smart' };

export function getSetting(userId, key) {
  return get('SELECT value FROM user_settings WHERE user_id=? AND key=?', userId, key)?.value ?? null;
}
export function setSetting(userId, key, value) {
  ensureUser(userId);
  run('INSERT INTO user_settings (user_id, key, value) VALUES (?,?,?) ON CONFLICT(user_id, key) DO UPDATE SET value=excluded.value', userId, key, value);
}
export const getPriority = (userId) => { const v = getSetting(userId, 'priority'); return PRIORITIES[v] ? v : null; };
export function setPriority(userId, priority) {
  if (!PRIORITIES[priority]) throw new Error('Unknown priority.');
  setSetting(userId, 'priority', priority);
}
const clamp = (value) => Math.max(-MAX, Math.min(MAX, value));
export const STRATEGIES = ['Budget', 'Smart', 'Premium'];
const normKey = (dimension, key) => (dimension === 'brand' ? String(key).trim().toLowerCase().slice(0, 80) : String(key).trim());

export const REJECT_REASONS = {
  too_expensive: 'Too expensive',
  not_good_enough: 'Not powerful or high quality enough',
  wrong_brand: "Don't like this brand",
  wrong_features: 'Missing features I want',
  other: 'Just not for me',
};

function bump(userId, scope, dimension, key, delta) {
  if (!key || !delta) return;
  const k = normKey(dimension, key);
  const row = get('SELECT score FROM preferences WHERE user_id=? AND scope=? AND dimension=? AND key=?', userId, scope, dimension, k);
  const score = clamp((row?.score || 0) + delta);
  run(`INSERT INTO preferences (user_id, scope, dimension, key, score) VALUES (?,?,?,?,?)
       ON CONFLICT(user_id, scope, dimension, key) DO UPDATE SET score=excluded.score, updated_at=datetime('now')`, userId, scope, dimension, k, score);
}

/** Applies a delta to the category scope at full weight and to the global scope at half weight. */
function learn(userId, category, dimension, key, delta) {
  if (category) bump(userId, category, dimension, key, delta);
  bump(userId, 'global', dimension, key, category ? delta / 2 : delta);
}

export function recordEvent(userId, { type, product = null, strategy = null, reason = null, category = null }) {
  ensureUser(userId);
  const cat = category ? String(category).toLowerCase().slice(0, 60) : null;
  const brand = product?.brand || null;
  const rawStrategy = strategy ? String(strategy).split('·')[0].replace(' alt', '').trim() : null;
  const primaryStrategy = STRATEGIES.includes(rawStrategy) ? rawStrategy : null;
  run('INSERT INTO feedback_events (user_id, type, product_id, product_name, brand, category, strategy, reason) VALUES (?,?,?,?,?,?,?,?)',
    userId, type, product?.id || null, product?.name || null, brand, cat, primaryStrategy, reason);

  if (type === 'select' || type === 'like') {
    learn(userId, cat, 'strategy', primaryStrategy, 1);
    learn(userId, cat, 'brand', brand, type === 'like' ? 1 : 0.5);
  } else if (type === 'purchase') {
    learn(userId, cat, 'strategy', primaryStrategy, 2);
    learn(userId, cat, 'brand', brand, 1);
  } else if (type === 'reject') {
    if (reason === 'too_expensive') {
      learn(userId, cat, 'strategy', 'Budget', 0.75);
      learn(userId, cat, 'strategy', 'Premium', -0.5);
    } else if (reason === 'not_good_enough') {
      learn(userId, cat, 'strategy', 'Premium', 0.75);
      learn(userId, cat, 'strategy', 'Budget', -0.5);
    } else if (reason === 'wrong_brand') {
      learn(userId, cat, 'brand', brand, -1.5);
    } else if (reason === 'wrong_features') {
      learn(userId, cat, 'strategy', primaryStrategy, -0.5);
    } else {
      learn(userId, cat, 'strategy', primaryStrategy, -0.5);
      learn(userId, cat, 'brand', brand, -0.5);
    }
  }
}

export function listPreferences(userId) {
  return all('SELECT scope, dimension, key, score FROM preferences WHERE user_id=? AND score != 0 ORDER BY scope, dimension, score DESC', userId);
}

/** Merged view used by the recommender: category preferences count fully, global preferences count half. */
export function getProfile(userId, category) {
  const rows = listPreferences(userId);
  const cat = category ? String(category).toLowerCase() : null;
  const merged = { brand: {}, strategy: { Budget: 0, Smart: 0, Premium: 0 } };
  for (const row of rows) {
    const weight = row.scope === 'global' ? 0.5 : row.scope === cat ? 1 : 0;
    if (!weight) continue;
    merged[row.dimension][row.key] = (merged[row.dimension][row.key] || 0) + row.score * weight;
  }
  const priority = getPriority(userId);
  if (priority) merged.strategy[PRIORITY_STRATEGY[priority]] += 3; // the user's stated governing factor
  const strategy = merged.strategy;
  const budgetSensitivity = Math.max(-1, Math.min(1, (strategy.Budget - strategy.Premium) / 4));
  const ranked = Object.entries(strategy).sort((a, b) => b[1] - a[1]);
  const dominant = ranked[0][1] >= 2 && ranked[0][1] - ranked[1][1] >= 1 ? ranked[0][0] : null;
  // How often each basket was actually chosen or bought. Shown to the user as the reason baskets are ordered as they are.
  const tally = {};
  for (const row of all("SELECT strategy, COUNT(*) AS n FROM feedback_events WHERE user_id=? AND type IN ('select','purchase') AND strategy IS NOT NULL GROUP BY strategy", userId)) if (STRATEGIES.includes(row.strategy)) tally[row.strategy] = row.n;
  // Consistent behaviour across categories counts as a strong signal even though category scopes only carry half weight globally.
  const totalPicks = Object.values(tally).reduce((a, b) => a + b, 0);
  const [topBasket, topCount] = Object.entries(tally).sort((a, b) => b[1] - a[1])[0] || [null, 0];
  let finalDominant = dominant;
  if (!finalDominant && totalPicks >= 3 && topCount / totalPicks >= 0.6 && STRATEGIES.includes(topBasket)) {
    finalDominant = topBasket;
    strategy[topBasket] += 2;
  }
  return { brand: merged.brand, strategy, budgetSensitivity, dominant: finalDominant, priority, tally };
}

export function setPreference(userId, scope, dimension, key, score) {
  if (!['brand', 'strategy'].includes(dimension)) throw new Error('Unknown preference type.');
  ensureUser(userId);
  const value = clamp(Number(score));
  if (!Number.isFinite(value)) throw new Error('Score must be a number.');
  const k = normKey(dimension, key);
  if (value === 0) {
    run('DELETE FROM preferences WHERE user_id=? AND scope=? AND dimension=? AND key=?', userId, scope, dimension, k);
  } else {
    run(`INSERT INTO preferences (user_id, scope, dimension, key, score) VALUES (?,?,?,?,?)
         ON CONFLICT(user_id, scope, dimension, key) DO UPDATE SET score=excluded.score, updated_at=datetime('now')`, userId, scope, dimension, k, value);
  }
}

export function resetPreferences(userId) {
  run('DELETE FROM preferences WHERE user_id=?', userId);
  run('DELETE FROM feedback_events WHERE user_id=?', userId);
  run('DELETE FROM search_history WHERE user_id=?', userId);
}

/** Plain-language summary of what Buypal has learned, shown in the profile panel. */
export function describeProfile(userId) {
  const profile = getProfile(userId, null);
  const lines = [];
  if (profile.priority) lines.push(`Your priority: ${PRIORITIES[profile.priority].toLowerCase()}.`);
  if (profile.dominant) lines.push(`You usually pick ${{ Budget: 'Best price', Smart: 'Best overall', Premium: 'Best quality' }[profile.dominant]} options, so those are shown first.`);
  if (profile.budgetSensitivity > 0.4) lines.push('You tend to prioritise saving money.');
  if (profile.budgetSensitivity < -0.4) lines.push('You tend to prioritise quality and performance.');
  const liked = Object.entries(profile.brand).filter(([, s]) => s >= 1).map(([b]) => b);
  if (liked.length) lines.push(`Brands you lean towards: ${liked.join(', ')}.`);
  return lines;
}
