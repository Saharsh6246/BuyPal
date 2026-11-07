import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Node 22+ can load .env natively. Existing environment variables are never overridden.
try {
  process.loadEnvFile(path.join(rootDir, '.env'));
} catch {
  // No .env file: rely on real environment variables (e.g. on a hosting platform).
}

const num = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const config = {
  port: num(process.env.PORT, 3000),
  dbPath: process.env.DB_PATH || path.join(rootDir, 'data', 'buypal.db'),
  channel3ApiKey: process.env.CHANNEL3_API_KEY || '',
  paypalClientId: process.env.PAYPAL_CLIENT_ID || '',
  paypalClientSecret: process.env.PAYPAL_CLIENT_SECRET || '',
  paypalBase: 'https://api-m.sandbox.paypal.com', // Sandbox only. Never point this at production without a security review.
  groqApiKey: process.env.GROQ_API_KEY || '',
  groqModel: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
  // Hard stop: once this many LLM calls were made today, Buypal stops calling the model (no billing can occur).
  llmDailyLimit: num(process.env.LLM_DAILY_LIMIT, 600),
  // Channel3 prices are in USD. INR budgets are converted with this approximate, configurable rate.
  inrPerUsd: num(process.env.INR_PER_USD, 85),
  clientDist: path.join(rootDir, 'client', 'dist'),
};

export const hasPaypal = () => Boolean(config.paypalClientId && config.paypalClientSecret);
