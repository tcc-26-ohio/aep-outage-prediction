// Customers who asked for updates about the outage at their premise. Only stores the sign-up; nothing is sent from here yet.
import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type Channel = 'email' | 'sms';
export interface ContactOk { channel: Channel; contact: string }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** An email address or a US phone number -> the normalized contact, or null when it is neither. */
export function parseContact(raw: unknown): ContactOk | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  if (t.length > 254) return null;
  if (EMAIL.test(t)) return { channel: 'email', contact: t.toLowerCase() };
  const digits = t.replace(/[^\d]/g, '');
  const national = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  return /^[2-9]\d{9}$/.test(national) && /^[\d\s()+.-]+$/.test(t) ? { channel: 'sms', contact: `+1${national}` } : null;
}

let db: Database | null = null;
function open() {
  if (db) return db;
  const path = process.env.DATABASE_PATH || './data/outages.sqlite';
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  db = new Database(path, { create: true });
  db.exec(`PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS update_subscriptions (
      id TEXT PRIMARY KEY, pid TEXT NOT NULL, channel TEXT NOT NULL CHECK(channel IN ('email', 'sms')),
      contact TEXT NOT NULL, createdAt TEXT NOT NULL, UNIQUE(pid, contact)
    );`);
  return db;
}

/** Idempotent: signing up twice with the same contact for the same premise keeps one row. */
export function subscribe(pid: string, c: ContactOk) {
  open().query('INSERT OR IGNORE INTO update_subscriptions (id, pid, channel, contact, createdAt) VALUES (?, ?, ?, ?, ?)')
    .run(crypto.randomUUID(), pid, c.channel, c.contact, new Date().toISOString());
}
