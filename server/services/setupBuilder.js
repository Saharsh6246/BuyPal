import { fmtUsd, roundMoney } from '../lib/money.js';
import { getCachedProduct } from './channel3.js';
import { addItem, CartError, clearCart, getCart, replaceItem, setCartMeta } from './cartService.js';
import { getProfile } from './preferences.js';
import { gatherProducts, normalizeRequirements } from './recommend.js';
import { publicProduct, rankOptions } from './scoring.js';

const DEFAULT_WEIGHT = { laptop: 5, desktop: 5, monitor: 2, keyboard: 0.8, mouse: 0.6, headphones: 1.2, webcam: 0.8, speaker: 1, tablet: 3, phone: 4 };

export const SETUP_TEMPLATES = {
  gaming: [
    { category: 'laptop', must_have: ['gaming'], share: 0.45 },
    { category: 'monitor', must_have: [], share: 0.17 },
    { category: 'keyboard', must_have: [], share: 0.09 },
    { category: 'mouse', must_have: ['gaming'], share: 0.06 },
    { category: 'headphones', must_have: [], share: 0.1 },
  ],
  office: [
    { category: 'laptop', must_have: [], share: 0.5 },
    { category: 'monitor', must_have: [], share: 0.2 },
    { category: 'keyboard', must_have: [], share: 0.07 },
    { category: 'mouse', must_have: [], share: 0.05 },
    { category: 'webcam', must_have: [], share: 0.08 },
    { category: 'headphones', must_have: [], share: 0.1 },
  ],
  study: [
    { category: 'laptop', must_have: [], share: 0.7 },
    { category: 'mouse', must_have: [], share: 0.05 },
    { category: 'headphones', must_have: [], share: 0.15 },
  ],
};

export function templateFor(goal) {
  const text = String(goal || '').toLowerCase();
  if (/gam(e|ing)/.test(text)) return 'gaming';
  if (/office|work|wfh|home office|productivity/.test(text)) return 'office';
  if (/student|college|study|school/.test(text)) return 'study';
  return null;
}

/** Normalises component shares so they sum to 1 (explicit shares are respected, missing ones use sensible defaults). */
export function allocateShares(components) {
  const weights = components.map((c) => (Number.isFinite(Number(c.share)) && Number(c.share) > 0 ? Number(c.share) : (DEFAULT_WEIGHT[c.category] ?? 1) / 10));
  const sum = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => w / sum);
}

const priceOf = (option) => option.product.price;

/**
 * Pure optimiser. `slots[i].options` are eligible options sorted by quality (best first).
 * Picks the best option per slot, trims spending when over budget and spends leftover budget on upgrades.
 * Returns the chosen options and whether the total fits.
 */
export function optimizeSelection(slots, budget, { initial = null } = {}) {
  const choice = initial ? [...initial] : slots.map((slot) => slot.options.find((o) => priceOf(o) <= slot.cap) || [...slot.options].sort((a, b) => priceOf(a) - priceOf(b))[0] || null);
  const total = () => choice.reduce((sum, option, i) => sum + (option ? priceOf(option) * slots[i].quantity : 0), 0);

  const downgrade = (target) => {
    for (let guard = 0; guard < 60 && total() > target + 0.005; guard += 1) {
      const need = total() - target;
      let best = null;
      let bestEnough = null; // a single swap that closes the whole gap with the least quality lost
      slots.forEach((slot, i) => {
        const current = choice[i];
        if (!current) return;
        for (const option of slot.options) {
          const saving = (priceOf(current) - priceOf(option)) * slot.quantity;
          if (saving <= 0.005) continue;
          const loss = Math.max(0, current.composite - option.composite);
          const ratio = saving / (loss + 0.02);
          if (!best || ratio > best.ratio) best = { i, option, ratio };
          if (saving >= need - 0.005) {
            // Prefer the swap that loses the least quality without wildly overshooting the savings that were asked for.
            const cost = loss + 0.8 * ((saving - need) / Math.max(total(), 1));
            if (!bestEnough || cost < bestEnough.cost) bestEnough = { i, option, cost };
          }
        }
      });
      const move = bestEnough || best;
      if (!move) return false;
      choice[move.i] = move.option;
    }
    return total() <= target + 0.005;
  };

  const fits = downgrade(budget);

  if (fits && !initial) {
    for (let guard = 0; guard < 30; guard += 1) {
      const left = budget - total();
      let best = null;
      slots.forEach((slot, i) => {
        const current = choice[i];
        if (!current) return;
        for (const option of slot.options) {
          const extra = (priceOf(option) - priceOf(current)) * slot.quantity;
          const gain = option.composite - current.composite;
          if (gain <= 0.02 || extra <= 0 || extra > left) continue;
          const ratio = gain / (extra + 1);
          if (!best || ratio > best.ratio) best = { i, option, ratio };
        }
      });
      if (!best) break;
      choice[best.i] = best.option;
    }
  }
  return { choice, total: roundMoney(total(), 'USD'), withinBudget: total() <= budget + 0.005, downgrade, getTotal: total };
}

export async function optionsForSlot(userId, { category, terms = [], gaming = false, capUsd, excludeIds = [] }) {
  const req = normalizeRequirements({
    category, must_have: terms, budget_max: capUsd, currency: 'USD',
  });
  req.gaming = gaming || terms.includes('gaming');
  const products = (await gatherProducts(req)).filter((p) => !excludeIds.includes(p.id));
  const profile = getProfile(userId, category);
  const ranked = rankOptions(products, req, profile);
  const strict = ranked.eligible.filter((entry) => entry.mustMissing.length === 0);
  const options = [...strict].sort((a, b) => b.scores.Smart - a.scores.Smart);
  return { options, ranked, req };
}

const BASKETS = [
  { key: 'Smart', label: 'Best overall', blurb: 'The strongest mix of quality and price for every part.' },
  { key: 'Premium', label: 'Best quality', blurb: 'The best-reviewed, highest-performing part in each slot that still fits your budget.' },
  { key: 'Budget', label: 'Best price', blurb: 'The lowest total that still meets every requirement.' },
];
const HINT_KEY = { price: 'Budget', quality: 'Premium', balanced: 'Smart' };

const reasonFor = (option) => {
  const { product } = option;
  const bits = [];
  if (product.rating) bits.push(`${product.rating.value}/5 from ${product.rating.count} reviews`);
  const chips = [product.specs.cpu, product.specs.gpu, product.specs.ramGb && `${product.specs.ramGb}GB RAM`, product.specs.screenIn && `${product.specs.screenIn}"`].filter(Boolean).slice(0, 3);
  if (chips.length) bits.push(chips.join(', '));
  if (option.mustMatched?.length) bits.push(`lists ${option.mustMatched.join(', ')}`);
  return bits.join(' · ') || 'Best-scoring listing for this part of the setup';
};

/** Searches every part of a setup once and keeps the scored options. Shared by all baskets. */
async function gatherSlots(userId, { goal, budgetUsd, components }) {
  let parts = Array.isArray(components) && components.length ? components : null;
  if (!parts) {
    const template = templateFor(goal);
    if (!template) return { error: 'Tell me which products the setup should include (for example laptop, monitor, keyboard, mouse).' };
    parts = SETUP_TEMPLATES[template];
  }
  parts = parts.slice(0, 8).map((p) => ({
    category: String(p.category || '').toLowerCase().replace(/s$/, '').replace('headphone', 'headphones'),
    must_have: (p.must_have || []).map((t) => String(t).toLowerCase()),
    share: p.share,
    quantity: Math.max(1, Math.min(4, Number(p.quantity) || 1)),
  })).filter((p) => p.category);
  if (!parts.length) return { error: 'No valid product categories were given for the setup.' };
  const shares = allocateShares(parts);

  const slots = [];
  const missing = [];
  const notes = [];
  // Parts are searched in parallel. Only listings with a real retailer link can go in a setup, because the shopper
  // completes the purchase at that retailer (simulated demo-store listings have no page to buy from).
  const searched = await Promise.all(parts.map(async (part, i) => {
    const allocated = budgetUsd * shares[i];
    const { options, ranked } = await optionsForSlot(userId, {
      category: part.category, terms: part.must_have, gaming: part.must_have.includes('gaming'), capUsd: allocated * 1.5,
    });
    return { part, allocated, options: options.filter((o) => /^https?:\/\//.test(o.product.buyUrl || '')), ranked };
  }));
  for (const { part, allocated, options, ranked } of searched) {
    if (!options.length) {
      missing.push(part.category);
      if (ranked.notes[0]) notes.push(`${part.category}: ${ranked.notes[0]}`);
      continue;
    }
    slots.push({ ...part, options, cap: allocated * 1.08 });
  }
  return { slots, missing, notes };
}

/** The same slots, re-sorted and re-scored for one basket strategy (so the optimiser maximises that goal). */
function slotsFor(slots, key) {
  const out = slots.map((slot) => {
    const options = slot.options.map((o) => ({ ...o, composite: o.scores[key] })).sort((a, b) => b.composite - a.composite);
    return { ...slot, options };
  });
  return out.every((slot) => slot.options.length) ? out : null;
}

/**
 * Builds several COMPLETE setups for one goal (best overall / best quality / best price),
 * each within the total budget. Nothing is added to the cart: the shopper picks a basket, opens it, and buys each
 * part at the retailer (Buypal has no API that can place orders on Amazon, Walmart and similar stores).
 */
export async function buildSetupBaskets(userId, { goal, budgetUsd, components, hint }) {
  const gathered = await gatherSlots(userId, { goal, budgetUsd, components });
  if (gathered.error) return { error: gathered.error };
  const { slots, missing, notes } = gathered;
  if (!slots.length) return { error: 'I could not find suitable products for this setup within that budget.', missing };

  const cheapest = slots.reduce((sum, slot) => sum + Math.min(...slot.options.map(priceOf)) * slot.quantity, 0);
  if (cheapest > budgetUsd + 0.005) {
    return { error: `The cheapest listings I found for this setup add up to ${fmtUsd(cheapest)}, which is above your ${fmtUsd(budgetUsd)} budget. Try a higher budget or fewer items.`, cheapestTotal: roundMoney(cheapest, 'USD'), missing };
  }

  const built = [];
  for (const def of BASKETS) {
    const scoped = slotsFor(slots, def.key);
    if (!scoped) continue;
    const result = optimizeSelection(scoped, budgetUsd);
    if (!result.withinBudget || result.choice.some((c) => !c)) continue;
    const items = result.choice.map((option, i) => ({
      role: scoped[i].category,
      quantity: scoped[i].quantity,
      product: publicProduct(option.product),
      reason: reasonFor(option),
    }));
    const total = roundMoney(items.reduce((sum, item) => sum + item.product.price * item.quantity, 0), 'USD');
    built.push({ keys: [def.key], label: def.label, blurb: def.blurb, items, total, withinBudget: total <= budgetUsd + 0.005, leftover: roundMoney(budgetUsd - total, 'USD') });
  }
  if (!built.length) return { error: 'I could not assemble a complete setup within that budget.', missing };

  // Identical setups are merged into one basket with a combined label.
  const merged = [];
  for (const basket of built) {
    const signature = basket.items.map((i) => i.product.id).join(',');
    const twin = merged.find((m) => m.signature === signature);
    if (twin) { twin.keys.push(...basket.keys); twin.label = `${twin.label} · ${basket.label}`; } else merged.push({ ...basket, signature });
  }

  // Order the baskets for THIS shopper: what they asked for in words, their stated priority and past choices.
  const profile = getProfile(userId, null);
  const bonus = (key) => (HINT_KEY[hint] === key ? 10 : 0);
  const weight = (b) => Math.max(...b.keys.map((k) => (profile.strategy[k] ?? 0) + bonus(k)));
  merged.sort((a, b) => weight(b) - weight(a) || BASKETS.findIndex((d) => d.key === a.keys[0]) - BASKETS.findIndex((d) => d.key === b.keys[0]));

  const lines = [];
  if (hint) lines.push(`You asked for ${{ price: 'the lowest price', quality: 'high quality', balanced: 'quality at a fair price' }[hint]}, so ${merged[0].label} comes first.`);
  if (profile.priority) lines.push(`Your stated priority is ${{ price: 'the lowest price', quality: 'the best quality', balanced: 'the best balance' }[profile.priority]}.`);
  const tally = Object.entries(profile.tally || {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  if (tally.length) lines.push(`From your past choices: ${tally.map(([k, n]) => `${BASKETS.find((d) => d.key === k)?.label || k} ×${n}`).join(', ')}.`);
  if (merged.length < built.length) lines.push('Some strategies picked exactly the same parts, so they are shown as one basket.');
  if (!lines.length) lines.push('No history yet. Baskets will adapt as you choose and buy.');

  if (missing.length) notes.push(`No suitable listing found for: ${missing.join(', ')}.`);
  const categories = slots.map((s) => s.category);
  if (categories.includes('monitor') && (categories.includes('laptop') || categories.includes('desktop'))) {
    notes.push('Port compatibility (HDMI / USB-C / DisplayPort) is not verified from listings. Please check before buying.');
  }

  return {
    goal: goal || null,
    budget: roundMoney(budgetUsd, 'USD'),
    baskets: merged.map(({ signature, ...rest }, index) => ({ id: `${index}-${rest.keys.join('+')}`, ...rest })),
    notes,
    missing,
    plan: { lines },
  };
}

/** Turns the basket the shopper chose into their cart (prices re-read from the server's own listing cache). */
export function selectSetupBasket(userId, { items, strategy, goal, budget }) {
  if (!Array.isArray(items) || !items.length || items.length > 12) throw new CartError('That basket is empty.');
  const cached = items.map((item) => ({ item, product: getCachedProduct(String(item.productId))?.product }));
  if (cached.some((c) => !c.product)) throw new CartError('Some listings in that basket expired. Ask Buypal to build it again.', 404);
  clearCart(userId);
  setCartMeta(userId, { budget: Number.isFinite(Number(budget)) ? roundMoney(Number(budget), 'USD') : null, goal: goal ? String(goal).slice(0, 200) : null });
  for (const { item, product } of cached) {
    addItem(userId, product.id, { role: String(item.role || '').slice(0, 40) || null, strategy: strategy ? String(strategy).slice(0, 40) : 'Smart', quantity: Math.max(1, Math.min(10, Number(item.quantity) || 1)) });
  }
  return getCart(userId);
}

// ---------- Natural-language cart edits ----------

const guessRole = (item) => item.role || (item.product.category?.title || item.product.name).toLowerCase();

export function findCartItem(cart, key) {
  const q = String(key || '').toLowerCase().trim();
  if (!q) return cart.items.length === 1 ? cart.items[0] : null;
  const byRole = cart.items.find((item) => guessRole(item) === q || guessRole(item) === q.replace(/s$/, ''));
  if (byRole) return byRole;
  return cart.items.find((item) => item.product.name.toLowerCase().includes(q)
    || (item.product.brand || '').toLowerCase() === q
    || (item.product.category?.title || '').toLowerCase().includes(q)) || null;
}

export async function replaceCartItem(userId, { item: key, must_have = [], max_price_usd = null, cheaper = false, preferred_brand = null }) {
  const cart = getCart(userId);
  const item = findCartItem(cart, key);
  if (!item) return { error: `I couldn't tell which cart item you mean${key ? ` by "${key}"` : ''}.` };
  const current = item.product;
  const terms = [...new Set([...(item.terms || []), ...must_have.map((t) => String(t).toLowerCase())])];

  let cap = max_price_usd != null ? Number(max_price_usd) : null;
  if (cheaper) cap = Math.min(cap ?? Infinity, current.price - 0.01);
  if (cart.budget != null) {
    const room = cart.budget - (cart.total - item.lineTotal);
    cap = Math.min(cap ?? Infinity, room / item.quantity);
  }
  const { options } = await optionsForSlot(userId, {
    category: guessRole(item), terms, gaming: terms.includes('gaming'), capUsd: Number.isFinite(cap) ? cap : undefined, excludeIds: [current.id],
  });
  const usable = options.filter((o) => Number.isFinite(cap) ? o.product.price <= cap : true);
  if (preferred_brand) usable.sort((a, b) => Number((b.product.brand || '').toLowerCase() === preferred_brand.toLowerCase()) - Number((a.product.brand || '').toLowerCase() === preferred_brand.toLowerCase()));
  const pick = usable[0];
  if (!pick) {
    return { error: `I couldn't find a ${guessRole(item)} that lists ${must_have.join(', ') || 'your requirements'}${Number.isFinite(cap) ? ` for ${fmtUsd(cap)} or less` : ''}. Your cart is unchanged.` };
  }
  const before = cart.total;
  const next = replaceItem(userId, current.id, pick.product, { strategy: 'Smart', terms });
  return {
    cart: next,
    change: `Replaced "${current.name}" (${fmtUsd(current.price)}) with "${pick.product.name}" (${fmtUsd(pick.product.price)}).`,
    totalBefore: before, totalAfter: next.total,
  };
}

/** Reduces the cart total by swapping items for cheaper alternatives that still meet their requirements. */
export async function reduceCartTotal(userId, { reduce_by_usd = null, target_total_usd = null }) {
  const cart = getCart(userId);
  if (!cart.items.length) return { error: 'Your cart is empty.' };
  const target = target_total_usd != null ? Number(target_total_usd) : cart.total - Number(reduce_by_usd);
  if (!Number.isFinite(target) || target <= 0) return { error: 'I need a valid amount to reduce the total by.' };
  if (cart.total <= target + 0.005) return { cart, change: 'The cart already fits that total.', totalBefore: cart.total, totalAfter: cart.total };

  const slots = [];
  for (const item of cart.items) {
    const { options } = await optionsForSlot(userId, {
      category: guessRole(item), terms: item.terms || [], gaming: (item.terms || []).includes('gaming'), capUsd: item.product.price,
    });
    const current = { product: getCachedProduct(item.id).product, composite: 0.5, scores: {}, mustMatched: [] };
    const ranked = options.filter((o) => o.product.price <= item.product.price);
    const currentRanked = ranked.find((o) => o.product.id === item.id);
    if (currentRanked) current.composite = currentRanked.composite;
    slots.push({ item, quantity: item.quantity, cap: item.product.price, options: [...new Map([[item.id, currentRanked || current], ...ranked.map((o) => [o.product.id, o])]).values()] });
  }
  // Start from the current selection, then trim towards the target.
  const initial = slots.map((s) => s.options.find((o) => o.product.id === s.item.id));
  const result = optimizeSelection(slots, target, { initial });
  const ok = result.withinBudget;
  if (!ok) {
    const floor = slots.reduce((sum, s) => sum + Math.min(...s.options.map(priceOf)) * s.quantity, 0);
    return { error: `I can't get the total down to ${fmtUsd(target)} without dropping a requirement. The lowest I can reach is about ${fmtUsd(floor)}. Your cart is unchanged.` };
  }
  const changes = [];
  result.choice.forEach((option, i) => {
    const { item } = slots[i];
    if (option && option.product.id !== item.id) {
      replaceItem(userId, item.id, option.product, { strategy: 'Smart', terms: item.terms });
      changes.push(`${item.product.name} → ${option.product.name} (saves ${fmtUsd((item.product.price - option.product.price) * item.quantity)})`);
    }
  });
  const next = getCart(userId);
  return { cart: next, change: `Swapped ${changes.length} item(s): ${changes.join('; ')}.`, totalBefore: cart.total, totalAfter: next.total, target };
}
