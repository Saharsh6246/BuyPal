import { fmtUsd, toUsd } from '../lib/money.js';
import { Channel3Error } from './channel3.js';
import { addItem, CartError, getCart, removeItem, setQuantity } from './cartService.js';
import { userModelForLlm } from './insights.js';
import { recordSearch } from './interests.js';
import { setPreference } from './preferences.js';
import { findProducts, normalizeRequirements } from './recommend.js';
import { buildSetupBaskets, findCartItem, reduceCartTotal, replaceCartItem } from './setupBuilder.js';

// The tools the LLM may call. Note what is NOT here: there is deliberately no payment tool.
// Only the signed-in user, pressing the checkout button and approving in PayPal, can pay.

const str = (description) => ({ type: 'string', description });
const strList = (description) => ({ type: 'array', items: { type: 'string' }, description });

export const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'find_products',
      description: 'Compare listings across online stores for ANY product (groceries, household, electronics, personal care, stationery...) and return cards scored by Buypal: best overall, best quality, best price, most loved, best deal and picked for you. Call once per distinct item the user wants.',
      parameters: {
        type: 'object',
        properties: {
          category: str('Short singular noun for the product type, e.g. butter, phone charger, notebook, laptop'),
          search_query: str("A concise search phrase capturing the user's detailed description: brand, size, variant (e.g. 'salted butter 500g')"),
          must_have: strList("Essential requirements, short phrases, e.g. wireless, organic, 500 g (always include a stated pack size like '500 g' or '1 litre'), 16gb ram, 4k"),
          nice_to_have: strList('Secondary preferences, e.g. lightweight, long battery, rgb'),
          budget_max: { type: 'number', description: 'Maximum price the user stated, in their currency' },
          currency: str('Currency of budget_max: USD or INR'),
          preferred_brands: strList('Brands the user asked for'),
          excluded_brands: strList('Brands the user wants to avoid'),
          allow_over_budget: { type: 'boolean', description: 'True only if the user explicitly allows going above the budget' },
        },
        required: ['category'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'build_setup',
      description: 'Build several COMPLETE multi-product setups (baskets: best overall, best quality, best price) for one goal within a total budget, e.g. a gaming setup. The shopper picks a basket and buys each part at the retailer links. Does not change the cart.',
      parameters: {
        type: 'object',
        properties: {
          goal: str('What the setup is for, e.g. complete gaming setup'),
          total_budget: { type: 'number', description: 'Total budget in the user currency' },
          currency: str('USD or INR'),
          priority_hint: { type: 'string', enum: ['price', 'quality', 'balanced'], description: 'What the user emphasised in words: "cheap/affordable"=price, "high quality"=quality, "quality yet affordable"=balanced' },
          components: {
            type: 'array',
            description: 'Optional list of parts. Omit to use a sensible template for gaming, office or study setups.',
            items: { type: 'object', properties: { category: str('e.g. monitor'), must_have: strList('requirements for this part'), quantity: { type: 'number' } }, required: ['category'] },
          },
        },
        required: ['goal', 'total_budget'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'modify_cart',
      description: 'Change the current cart. Totals are recalculated and verified by Buypal.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['replace_item', 'remove_item', 'set_quantity', 'reduce_total', 'add_item'] },
          item: str('Which cart item, by category or name, e.g. mouse'),
          must_have: strList('For replace_item: requirements for the new item, e.g. wireless'),
          cheaper: { type: 'boolean', description: 'For replace_item: the replacement must be cheaper' },
          max_price: { type: 'number', description: 'For replace_item: price cap in the user currency' },
          reduce_by: { type: 'number', description: 'For reduce_total: amount to cut from the total, in the user currency' },
          target_total: { type: 'number', description: 'For reduce_total: desired total in the user currency' },
          currency: str('USD or INR for the amounts above'),
          quantity: { type: 'number' },
          product_id: str('For add_item: an id returned by find_products'),
        },
        required: ['action'],
      },
    },
  },
  {
    type: 'function',
    function: { name: 'show_cart', description: 'Show the current cart and total.', parameters: { type: 'object', properties: {} } },
  },
  {
    type: 'function',
    function: {
      name: 'update_preference',
      description: 'Remember an explicit brand preference the user stated ("I prefer Lenovo", "never Acer").',
      parameters: {
        type: 'object',
        properties: { brand: str('Brand name'), sentiment: { type: 'string', enum: ['like', 'avoid'] }, category: str('Optional product category if the preference is category-specific') },
        required: ['brand', 'sentiment'],
      },
    },
  },
];

const compactCard = (card) => ({
  strategy: card.label, product_id: card.product.id, name: card.product.name, brand: card.product.brand,
  price_usd: card.product.price, rating: card.product.rating ? `${card.product.rating.value}/5 (${card.product.rating.count})` : 'not listed',
  store: card.product.merchant,
  demo_data: Boolean(card.product.demo),
  specs: card.product.specChips.slice(0, 4), why: card.position, pros: card.pros, cons: card.cons,
});

function toUsdOrNull(amount, currency) {
  if (amount == null) return null;
  return toUsd(Number(amount), String(currency || 'USD').toUpperCase());
}

function wrapError(error) {
  if (error instanceof Channel3Error || error instanceof CartError) return { error: error.message };
  console.error('Tool failed:', error?.message || error);
  return { error: 'Something went wrong while running that step.' };
}

/** Runs one tool. Returns { result } for the LLM (compact) and pushes UI blocks into ctx.blocks. */
export async function runTool(ctx, name, args = {}) {
  const outcome = await runToolInner(ctx, name, args);
  if (outcome.result?.error && Array.isArray(ctx.errors)) ctx.errors.push(outcome.result.error);
  return outcome;
}

async function runToolInner(ctx, name, args) {
  const { userId, blocks } = ctx;
  try {
    if (name === 'find_products') {
      const req = normalizeRequirements(args);
      if (!req.category && !req.query) return { result: { error: 'A product category is required.' } };
      const outcome = await findProducts(userId, req);
      recordSearch(userId, { query: args.search_query || [...req.mustHave, req.category].join(' '), category: req.category, budgetUsd: req.budgetMax });
      blocks.push({ type: 'recommendations', category: req.category, budgetUsd: req.budgetMax, requirements: { mustHave: req.mustHave, niceToHave: req.niceToHave }, cards: outcome.cards, notes: outcome.notes, stats: outcome.stats, cheapest: outcome.cheapest || null, profileUsed: outcome.profileUsed, basketPlan: outcome.basketPlan || null });
      return { result: { found: outcome.stats.found, considered: outcome.stats.considered, notes: outcome.notes, baskets: outcome.cards.map(compactCard), why_these_baskets_for_this_shopper: outcome.basketPlan?.lines, shopper: userModelForLlm(userId), cheapest_available: outcome.cheapest ? { name: outcome.cheapest.name, price_usd: outcome.cheapest.price } : undefined } };
    }

    if (name === 'build_setup') {
      const budgetUsd = toUsdOrNull(args.total_budget, args.currency);
      if (!budgetUsd) return { result: { error: 'A total budget in USD or INR is needed.' } };
      const outcome = await buildSetupBaskets(userId, { goal: args.goal, budgetUsd, components: args.components, hint: args.priority_hint });
      if (outcome.error) return { result: { error: outcome.error } };
      blocks.push({ type: 'setupBaskets', goal: outcome.goal, budget: outcome.budget, baskets: outcome.baskets, notes: outcome.notes, plan: outcome.plan, converted: String(args.currency || 'USD').toUpperCase() !== 'USD' });
      return {
        result: {
          budget_usd: outcome.budget,
          baskets: outcome.baskets.map((b) => ({
            basket: b.label, total_usd: b.total, within_budget: b.withinBudget,
            parts: b.items.map((i) => ({ part: i.role, name: i.product.name, store: i.product.merchant, price_usd: i.product.price, demo_data: Boolean(i.product.demo) })),
          })),
          why_these_baskets_for_this_shopper: outcome.plan.lines,
          shopper: userModelForLlm(userId),
          notes: outcome.notes,
          reminder: 'The shopper opens a basket and buys each part at the retailer link. Buypal cannot place orders at Amazon or Walmart.',
        },
      };
    }

    if (name === 'show_cart') {
      const cart = getCart(userId);
      blocks.push({ type: 'cart', cart });
      return { result: { items: cart.items.map((i) => ({ name: i.product.name, qty: i.quantity, price_usd: i.product.price })), total_usd: cart.total, budget_usd: cart.budget } };
    }

    if (name === 'update_preference') {
      if (!args.brand) return { result: { error: 'A brand name is required.' } };
      setPreference(userId, args.category ? String(args.category).toLowerCase() : 'global', 'brand', args.brand, args.sentiment === 'avoid' ? -3 : 3);
      return { result: { saved: `${args.sentiment === 'avoid' ? 'Avoiding' : 'Preferring'} ${args.brand}` } };
    }

    if (name === 'modify_cart') {
      return { result: await modifyCart(ctx, args) };
    }
    return { result: { error: `Unknown tool ${name}.` } };
  } catch (error) {
    return { result: wrapError(error) };
  }
}

async function modifyCart({ userId, blocks }, args) {
  const cur = String(args.currency || 'USD').toUpperCase();
  const cart = getCart(userId);
  const finish = (outcome) => {
    if (outcome.error) return { error: outcome.error };
    blocks.push({ type: 'cart', cart: outcome.cart, change: outcome.change, budget: outcome.cart.budget, verified: outcome.target != null ? { target: outcome.target, total: outcome.totalAfter, ok: outcome.totalAfter <= outcome.target + 0.005 } : null });
    return { change: outcome.change, total_before_usd: outcome.totalBefore, total_after_usd: outcome.totalAfter, budget_usd: outcome.cart.budget, within_budget: outcome.cart.withinBudget, verified_target_usd: outcome.target };
  };

  switch (args.action) {
    case 'replace_item': {
      const max = toUsdOrNull(args.max_price, cur);
      return finish(await replaceCartItem(userId, { item: args.item, must_have: args.must_have || [], max_price_usd: max, cheaper: Boolean(args.cheaper) }));
    }
    case 'reduce_total': {
      const reduceBy = toUsdOrNull(args.reduce_by, cur);
      const target = toUsdOrNull(args.target_total, cur);
      if (reduceBy == null && target == null) return { error: 'I need an amount to reduce by or a target total.' };
      return finish(await reduceCartTotal(userId, { reduce_by_usd: reduceBy, target_total_usd: target }));
    }
    case 'remove_item': {
      const item = findCartItem(cart, args.item);
      if (!item) return { error: `I couldn't tell which cart item you mean${args.item ? ` by "${args.item}"` : ''}.` };
      const next = removeItem(userId, item.id);
      return finish({ cart: next, change: `Removed "${item.product.name}". New total ${fmtUsd(next.total)}.`, totalBefore: cart.total, totalAfter: next.total });
    }
    case 'set_quantity': {
      const item = findCartItem(cart, args.item);
      if (!item) return { error: `I couldn't tell which cart item you mean${args.item ? ` by "${args.item}"` : ''}.` };
      const next = setQuantity(userId, item.id, args.quantity);
      return finish({ cart: next, change: `Set quantity of "${item.product.name}" to ${args.quantity}.`, totalBefore: cart.total, totalAfter: next.total });
    }
    case 'add_item': {
      if (!args.product_id) return { error: 'Which product? Use an id from the latest results.' };
      const next = addItem(userId, String(args.product_id));
      return finish({ cart: next, change: 'Added to your cart.', totalBefore: cart.total, totalAfter: next.total });
    }
    default:
      return { error: 'Unknown cart action.' };
  }
}
