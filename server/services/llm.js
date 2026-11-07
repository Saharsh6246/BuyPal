import { config } from '../config.js';
import { get, run } from '../db.js';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
let cooldownUntil = 0;

export class LlmUnavailable extends Error {
  constructor(reason, message) {
    super(message);
    this.reason = reason; // 'no_key' | 'limit' | 'rate_limited' | 'failed'
  }
}

const today = () => new Date().toISOString().slice(0, 10);

export function llmUsage() {
  const calls = get('SELECT calls FROM llm_usage WHERE day=?', today())?.calls || 0;
  return { calls, limit: config.llmDailyLimit, remaining: Math.max(0, config.llmDailyLimit - calls), enabled: Boolean(config.groqApiKey) };
}

export function llmAvailable() {
  if (!config.groqApiKey) return { ok: false, reason: 'no_key' };
  if (llmUsage().remaining <= 0) return { ok: false, reason: 'limit' };
  if (Date.now() < cooldownUntil) return { ok: false, reason: 'rate_limited' };
  return { ok: true };
}

/**
 * One chat-completion call to Groq (free tier, no card, no automatic billing). Every attempt is counted
 * and Buypal stops calling the model once the configured daily limit is reached.
 */
export async function chatCompletion({ messages, tools }) {
  const state = llmAvailable();
  if (!state.ok) throw new LlmUnavailable(state.reason, `LLM unavailable: ${state.reason}`);

  run(`INSERT INTO llm_usage (day, calls) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET calls = calls + 1`, today());
  let response;
  try {
    response = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.groqApiKey}` },
      body: JSON.stringify({
        model: config.groqModel, messages, tools, tool_choice: 'auto', temperature: 0.2, max_tokens: 1500,
        // gpt-oss models "think" before answering; keep that short so replies stay fast and within the free token limits.
        ...(/gpt-oss/.test(config.groqModel) ? { reasoning_effort: 'low' } : {}),
      }),
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw new LlmUnavailable('failed', 'Could not reach the LLM provider.');
  }
  if (response.status === 429) {
    const retry = Number(response.headers.get('retry-after'));
    cooldownUntil = Date.now() + (Number.isFinite(retry) && retry > 0 ? retry : 30) * 1000;
    throw new LlmUnavailable('rate_limited', 'The free LLM rate limit was reached.');
  }
  if (response.status === 401 || response.status === 403) throw new LlmUnavailable('no_key', 'The Groq API key was not accepted.');
  if (!response.ok) throw new LlmUnavailable('failed', `The LLM returned HTTP ${response.status}.`);
  const data = await response.json().catch(() => null);
  const message = data?.choices?.[0]?.message;
  if (!message) throw new LlmUnavailable('failed', 'The LLM returned an unreadable response.');
  return message;
}
