import { all, ensureUser, run } from '../db.js';
import { fmtUsd } from '../lib/money.js';
import { getCart } from './cartService.js';
import { heuristicPlan } from './intent.js';
import { chatCompletion, llmAvailable, llmUsage, LlmUnavailable } from './llm.js';
import { runTool, TOOL_DEFINITIONS } from './tools.js';

// Architecture: ONE orchestrating agent that calls specialised, deterministic tools (search, scoring, cart,
// preferences). Payments are not a tool: they only happen through the checkout endpoints after the user approves.

const SYSTEM_PROMPT = `You are Buypal, a friendly, concise personal shopping assistant.
Rules:
- Use tools for anything about products, prices, carts or preferences. Never invent products, prices, ratings, specs or availability.
- Only mention products returned by tools. Product cards with full details are shown to the user automatically, so keep replies short (under 90 words): say what you found, which pick suits their situation and why, and any caveat from tool notes.
- If the user gives a budget in rupees pass currency "INR"; otherwise "USD". Mention that conversions are approximate when currency is INR.
- Extract must_have (essential) vs nice_to_have (secondary) requirements from the message. Ask one short clarifying question only if you cannot tell what product they want.
- For "build/complete setup" requests use build_setup. For changes to an existing cart use modify_cart. Never claim a total or change that a tool did not report.
- You cannot take payment. When the user is ready, tell them to open the cart and press the PayPal checkout button, which asks for their explicit approval. This is a PayPal Sandbox demo: no real retailer order or delivery is created.
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
    await runTool(ctx, 'build_setup', { goal: plan.goal, total_budget: plan.budget, currency: plan.currency });
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
  return { reply, blocks, mode, notice: noticeText, usage: llmUsage() };
}
