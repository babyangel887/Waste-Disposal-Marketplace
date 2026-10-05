import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';

const dbPath = process.env.DATABASE_URL?.startsWith('file:')
  ? process.env.DATABASE_URL.replace('file:', '')
  : './dev.db';

const resolved = path.resolve(process.cwd(), dbPath);
fs.mkdirSync(path.dirname(resolved), { recursive: true });

export const db = new DatabaseSync(resolved);

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  phone_verified INTEGER NOT NULL DEFAULT 0,
  name TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS otp_codes (
  phone TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_sent_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS consent_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  consent_type TEXT NOT NULL,
  version TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  ip TEXT
);
CREATE TABLE IF NOT EXISTS vendor_profiles (
  user_id TEXT PRIMARY KEY,
  business_name TEXT NOT NULL,
  license_no TEXT,
  approved_status TEXT NOT NULL DEFAULT 'pending',
  rejection_reason TEXT,
  approved_by TEXT,
  approved_at TEXT,
  blocked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS vehicles (
  id TEXT PRIMARY KEY,
  vendor_id TEXT NOT NULL,
  plate_no TEXT NOT NULL,
  type TEXT NOT NULL,
  capacity_kg INTEGER,
  photo_key TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS vendor_documents (
  id TEXT PRIMARY KEY,
  vendor_id TEXT NOT NULL,
  type TEXT NOT NULL,
  file_key TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE(vendor_id, type)
);
CREATE TABLE IF NOT EXISTS waste_categories (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  base_rate_ngn INTEGER NOT NULL,
  unit TEXT NOT NULL,
  special_fee_ngn INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS lgas (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  surcharge_ngn INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pricing_history (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  field TEXT NOT NULL,
  old_value INTEGER NOT NULL,
  new_value INTEGER NOT NULL,
  changed_by TEXT NOT NULL,
  changed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  meta TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  category_id TEXT NOT NULL,
  category_slug TEXT NOT NULL,
  lga_id TEXT NOT NULL,
  lga_name TEXT NOT NULL,
  qty INTEGER NOT NULL,
  pickup_lat REAL NOT NULL,
  pickup_lng REAL NOT NULL,
  pickup_address TEXT NOT NULL,
  photo_keys TEXT NOT NULL,
  base_rate INTEGER NOT NULL,
  lga_surcharge INTEGER NOT NULL,
  special_fee INTEGER NOT NULL,
  total_price INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'awaiting_payment',
  cancel_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL,
  authorization_code TEXT,
  amount_ngn INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'authorized',
  gateway_ref TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`);

// Seed DB-backed pricing from shared defaults (Phase 1: DB is authoritative).
import { WASTE_CATEGORIES, PILOT_LGAS } from '@waste/shared';
for (const c of WASTE_CATEGORIES) {
  db.prepare(
    'INSERT INTO waste_categories (id, slug, label, base_rate_ngn, unit, special_fee_ngn) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING'
  ).run(c.id, c.slug, c.label, c.baseRateNGN, c.unit, c.specialFeeNGN);
}
for (const l of PILOT_LGAS) {
  db.prepare('INSERT INTO lgas (id, name, surcharge_ngn) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING').run(
    l.id,
    l.name,
    l.surchargeNGN
  );
}
