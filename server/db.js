import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

if (config.dbPath !== ':memory:') fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new DatabaseSync(config.dbPath);
db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS preferences (
  user_id TEXT NOT NULL,
  scope TEXT NOT NULL,          -- 'global' or a category such as 'laptop'
  dimension TEXT NOT NULL,      -- 'brand' | 'strategy'
  key TEXT NOT NULL,
  score REAL NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, scope, dimension, key)
);
CREATE TABLE IF NOT EXISTS feedback_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,           -- select | like | reject | purchase
  product_id TEXT,
  product_name TEXT,
  brand TEXT,
  category TEXT,
  strategy TEXT,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  json TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS search_cache (
  key TEXT PRIMARY KEY,
  product_ids TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS carts (
  user_id TEXT PRIMARY KEY,
  budget REAL,
  currency TEXT,
  goal TEXT
);
CREATE TABLE IF NOT EXISTS cart_items (
  user_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  role TEXT,
  strategy TEXT,
  terms TEXT,                   -- JSON array of the requirements this item was chosen for
  PRIMARY KEY (user_id, product_id)
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  blocks TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  paypal_order_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  amount TEXT NOT NULL,
  currency TEXT NOT NULL,
  items_json TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  capture_id TEXT,
  capture_request_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS llm_usage (
  day TEXT PRIMARY KEY,
  calls INTEGER NOT NULL DEFAULT 0
);
`);

export const run = (sql, ...params) => db.prepare(sql).run(...params);
export const get = (sql, ...params) => db.prepare(sql).get(...params);
export const all = (sql, ...params) => db.prepare(sql).all(...params);

export function ensureUser(userId) {
  run('INSERT OR IGNORE INTO users (id) VALUES (?)', userId);
}

export const isValidUserId = (value) => typeof value === 'string' && /^[a-zA-Z0-9-]{8,80}$/.test(value);
