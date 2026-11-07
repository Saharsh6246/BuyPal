import { all, ensureUser, run } from '../db.js';
import { fmtUsd } from '../lib/money.js';
import { getCart } from './cartService.js';
import { heuristicPlan } from './intent.js';
import { chatCompletion, llmAvailable, llmUsage, LlmUnavailable } from './llm.js';
import { runTool, TOOL_DEFINITIONS } from './tools.js';
import { getBalance } from './wallet.js';

// Architecture: ONE orchestrating agent that calls specialised, deterministic tools (search, scoring, cart,
// preferences). Payments are not a tool: they only happen through the checkout endpoints after the user approves.

const SYSTEM_PROMPT = `You are Buypal, a friendly, concise personal shopping assistant that can help with ANY everyday purchase: groceries, household items, electronics, personal care, stationery, gifts and more.
How you work:
- The user describes what they want in their own words, sometimes in detail. Understand it: the product, size/variant, brand and budget. Call find_products once per distinct item (for "milk and bread" call it twice).
- find_products compares stores and returns up to five cards: best overall, best quality, best price, and when the data supports them most loved (top ratings), best deal (verified markdown) and picked for you (a brand the shopper likes). The order is personalised by the shopper profile you receive: say in one sentence why this shopper sees these cards (use why_these_baskets_for_this_shopper and shopper), then recommend ONE card for their situation and why.
- Some listings come from a simulated demo store feed (demo_data = true). Always say so briefly when you recommend one of them, e.g. "(demo store data)". Never claim a demo listing is from Amazon, Flipkart, Blinkit or Zepto.
Rules:
- Use tools for anything about products, prices, carts or preferences. Never invent products, prices, ratings, specs or availability. Buypal has no delivery-time data, so never promise or estimate delivery speed.
- Only mention products returned by tools. Product cards with full details are shown to the user automatically, so keep replies short (under 100 words): say what you found, which basket suits their situation and why, and any caveat from tool notes.
- If the user gives a budget in rupees pass currency "INR"; otherwise "USD". Mention that conversions are approximate when currency is INR.
- Extract must_have (essential) vs nice_to_have (secondary) requirements from the message. Ask one short clarifying question only if you cannot tell what product they want.
- For "build/complete setup" requests use build_setup: it returns several complete baskets (best overall, best quality, best price), each within the budget. Pass priority_hint from the user's words (e.g. "high quality yet affordable" = balanced). Recommend one basket and say why. Buypal does not place orders at retailers: the shopper opens a basket and buys each part through the retailer links. For changes to an existing cart use modify_cart. Never claim a total or change that a tool did not report.
- You cannot take payment or place orders. For setup baskets, tell the user to open the basket they like and buy each part at the retailer links (Amazon, Walmart, Best Buy and others); Buypal cannot order for them. A single item can also go through the PayPal Sandbox checkout, which is only a demo: no real retailer order or delivery is created. Never say a basket can be paid for with PayPal.
- Searches and setups cost Pal Points, Buypal's in-app currency (a search costs 1, a complete setup 4). Shoppers earn points by paying with PayPal: a verified top-up through Buypal, or by claiming a PayPal checkout they made at a retailer. If a tool returns out_of_points, say so in one sentence and point them to the wallet; do not retry. Never claim points were earned or spent unless a tool said so.
- When you quote money, give the basket total and the budget separately, exactly as the tool reports them (do not call a total a budget). Mention rupee amounts only as approximate.
- Do not describe Buypal as providing escrow or guaranteed delivery.`;

const MAX_STEPS = 4;

const saveMessage = (userId, role, content, blocks = null) =>
  run('INSERT INTO messages (user_id, role, content, blocks) VALUES (?,?,?,?)', userId, role, content, blocks ? JSON.stringify(blocks) : null);

export function loadHistory(userId, limit = 40) {
  return all('SELECT role, content, blocks FROM messages WHERE user_id=? ORDER BY id DESC LIMIT ?', userId, limit).reverse()
    .map((m) => ({ role: m.role, content: m.content, blocks: m.blocks ? JSON.parse(m.blocks) : [] }));
}

export const clearHistory = (userId) => run('DELETE FROM messages WHERE user_id=?', userId);

/** Deterministic summary used when the LLM is unavailable or returned nothing. */
function summarizeBlocks(blocks, plan, errors = []) {
  const lines = [];
  for (const block of blocks) {
    if (block.type === 'recommendations') {
      if (!block.cards.length) lines.push(block.notes[0] || 'I could not find matching products. Try a broader description or a higher budget.');
      else lines.push(`Here ${block.cards.length === 1 ? 'is' : 'are'} ${block.cards.length} pick${block.cards.length === 1 ? '' : 's'} for ${block.category || 'your search'}${block.budgetUsd ? ` within about ${fmtUsd(block.budgetUsd)}` : ''}: ${block.cards.map((c) => c.label).join(', ')}. Each card explains why it was chosen.`);
      if (block.notes.length && block.cards.length) lines.push(block.notes[0]);
    } else if (block.type === 'outOfPoints') {
      lines.push(`You have ${block.balance} ${block.unit} and this needs ${block.needed}. Open your wallet to top up with PayPal or claim points from a PayPal checkout.`);
    } else if (block.type === 'setupBaskets') {
      lines.push(`I built ${block.baskets.length} complete setup${block.baskets.length === 1 ? '' : 's'} within ${fmtUsd(block.budget)}: ${block.baskets.map((b) => `${b.label} (${fmtUsd(b.total)})`).join(', ')}. Open one to see where to buy each part.`);
    } else if (block.type === 'setup') {
      lines.push(`I built a ${block.cart.items.length}-item setup for ${fmtUsd(block.total)} against your ${fmtUsd(block.budget)} budget (${fmtUsd(block.budget - block.total)} left). You can ask me to swap or cut anything.`);
    } else if (block.type === 'cart') {
      lines.push(block.change ? `${block.change} Cart total: ${fmtUsd(block.cart.total)}.` : `Your cart has ${block.cart.count} item${block.cart.count === 1 ? '' : 's'}, total ${fmtUsd(block.cart.total)}.`);
    }
  }
  lines.push(...errors);
  if (!lines.length) lines.push(plan?.type === 'chat'
    ? "Tell me what you'd like to buy, for example “a lightweight laptop for college under $800”, or “build me a gaming setup under ₹1,00,000”."
    : 'Done.');
  return lines.join(' ');
}

async function runWithLlm(userId, text, blocks) {
  const history = loadHistory(userId, 9).slice(0, -1) // exclude the message we just stored
    .map((m) => ({ role: m.role, content: m.content.slice(0, 600) }));
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }, ...history, { role: 'user', content: text }];
  const ctx = { userId, blocks };

  for (let step = 0; step < MAX_STEPS; step += 1) {
    const message = await chatCompletion({ messages, tools: TOOL_DEFINITIONS });
    const calls = message.tool_calls || [];
    if (!calls.length) return (message.content || '').trim();
    messages.push({ role: 'assistant', content: message.content || '', tool_calls: calls });
    for (const call of calls) {
      let args = {};
      try { args = JSON.parse(call.function.arguments || '{}'); } catch { /* handled below */ }
      const { result } = await runTool(ctx, call.function.name, args);
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result).slice(0, 6000) });
    }
  }
  return '';
}

async function runWithRules(userId, text, blocks) {
  const cart = getCart(userId);
  const plan = heuristicPlan(text, { cartItems: cart.items.length });
  const errors = [];
  const ctx = { userId, blocks, errors };
  if (plan.type === 'search') {
    await runTool(ctx, 'find_products', plan);
  } else if (plan.type === 'setup') {
    if (!plan.budget) return { plan, text: 'What total budget should I keep the setup under? For example “under ₹1,00,000” or “under $1200”.' };
    await runTool(ctx, 'build_setup', { goal: plan.goal, total_budget: plan.budget, currency: plan.currency, priority_hint: plan.priority_hint });
  } else if (plan.type === 'cart') {
    await runTool(ctx, 'show_cart');
  } else if (plan.type === 'edit') {
    const steps = plan.steps || [{ action: plan.action, item: plan.item }];
    for (const step of steps) await runTool(ctx, 'modify_cart', step);
  }
  return { plan, text: null, errors };
}

export async function handleMessage(userId, rawText) {
  ensureUser(userId);
  const text = String(rawText || '').trim().slice(0, 1000);
  const balanceBefore = getBalance(userId);
  saveMessage(userId, 'user', text);
  const blocks = [];
  let reply = '';
  let mode = 'ai';
  let notice = null;

  const availability = llmAvailable();
  if (availability.ok) {
    try {
      reply = await runWithLlm(userId, text, blocks);
    } catch (error) {
      if (!(error instanceof LlmUnavailable)) console.error('Agent error:', error?.message || error);
      notice = error instanceof LlmUnavailable ? error.reason : 'failed';
    }
  } else {
    notice = availability.reason;
  }

  if (!reply && blocks.length === 0 && notice) {
    mode = 'basic';
    const outcome = await runWithRules(userId, text, blocks);
    reply = outcome.text || summarizeBlocks(blocks, outcome.plan, outcome.errors);
  } else if (!reply) {
    reply = summarizeBlocks(blocks, null);
    if (notice) mode = 'basic';
  }

  const noticeText = mode === 'basic' ? {
    no_key: 'AI chat is not configured (no GROQ_API_KEY), so Buypal is using its built-in understanding.',
    limit: 'Buypal reached its free daily AI limit and stopped calling the model. Basic understanding is active until tomorrow.',
    rate_limited: 'The free AI rate limit was reached, so Buypal is using its built-in understanding for now.',
    failed: 'The AI service had a problem, so Buypal used its built-in understanding for this message.',
  }[notice] || null : null;

  saveMessage(userId, 'assistant', reply, blocks.length ? blocks : null);
  const balance = getBalance(userId);
  return { reply, blocks, mode, notice: noticeText, usage: llmUsage(), wallet: { balance, spent: Math.max(0, balanceBefore - balance) } };
}
