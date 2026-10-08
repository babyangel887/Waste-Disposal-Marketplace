import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { Pool } from 'pg';
import { WASTE_CATEGORIES, PILOT_LGAS } from '@waste/shared';

// DATABASE_URL selects the backend:
// - `file:./dev.db` (default) → node:sqlite, used for local dev + tests.
// - `postgres://...` / `postgresql://...` → PostgreSQL via `pg` (staging/prod,
//   tables follow apps/api/db/schema.sql).
const DATABASE_URL = process.env.DATABASE_URL ?? 'file:./dev.db';
export const isPostgres =
  DATABASE_URL.startsWith('postgres://') || DATABASE_URL.startsWith('postgresql://');

// All SQL in the codebase uses `?` placeholders (SQLite style); rewrite to
// $1, $2, ... for Postgres.
function toPg(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

// Normalize driver differences so call sites behave identically:
// - pg returns BOOLEAN as true/false → 0/1 (existing comparisons use 0/1).
// - sqlite may return TEXT stored in JSONB-affinity columns as Buffer → string.
function normRow(row: any): any {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
  for (const k of Object.keys(row)) {
    const v = (row as any)[k];
    if (typeof v === 'boolean') (row as any)[k] = v ? 1 : 0;
    else if (typeof Buffer !== 'undefined' && Buffer.isBuffer(v)) (row as any)[k] = v.toString('utf8');
  }
  return row;
}

// DDL mirrors apps/api/db/schema.sql (Postgres column types; SQLite accepts
// any type names). No CHECK constraints here — validation lives in the API;
// schema.sql stays canonical for prod. Boolean literals use TRUE/FALSE so
// both backends accept them.
const DDL = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    role TEXT NOT NULL,
    phone TEXT NOT NULL UNIQUE,
    phone_verified BOOLEAN NOT NULL DEFAULT FALSE,
    name TEXT,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS otp_codes (
    phone TEXT PRIMARY KEY,
    code_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_sent_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS consent_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    consent_type TEXT NOT NULL,
    version TEXT NOT NULL,
    accepted_at TEXT NOT NULL,
    ip TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS vendor_profiles (
    user_id TEXT PRIMARY KEY,
    business_name TEXT NOT NULL,
    license_no TEXT,
    approved_status TEXT NOT NULL DEFAULT 'pending',
    rejection_reason TEXT,
    approved_by TEXT,
    approved_at TEXT,
    blocked BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS vehicles (
    id TEXT PRIMARY KEY,
    vendor_id TEXT NOT NULL,
    plate_no TEXT NOT NULL,
    type TEXT NOT NULL,
    capacity_kg INTEGER,
    photo_key TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS vendor_documents (
    id TEXT PRIMARY KEY,
    vendor_id TEXT NOT NULL,
    type TEXT NOT NULL,
    file_key TEXT NOT NULL,
    verified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TEXT NOT NULL,
    UNIQUE(vendor_id, type)
  )`,
  `CREATE TABLE IF NOT EXISTS waste_categories (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    base_rate_ngn INTEGER NOT NULL,
    unit TEXT NOT NULL,
    special_fee_ngn INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS lgas (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    surcharge_ngn INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS pricing_history (
    id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    field TEXT NOT NULL,
    old_value INTEGER NOT NULL,
    new_value INTEGER NOT NULL,
    changed_by TEXT NOT NULL,
    changed_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    actor_id TEXT NOT NULL,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    meta TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS bookings (
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
    photo_keys JSONB NOT NULL,
    base_rate INTEGER NOT NULL,
    lga_surcharge INTEGER NOT NULL,
    special_fee INTEGER NOT NULL,
    total_price INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'awaiting_payment',
    vendor_id TEXT,
    arrived_at TEXT,
    cancel_reason TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS payments (
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
  )`,
  `CREATE TABLE IF NOT EXISTS job_offers (
    id TEXT PRIMARY KEY,
    booking_id TEXT NOT NULL,
    vendor_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    attempt_no INTEGER NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS job_status_history (
    id TEXT PRIMARY KEY,
    booking_id TEXT NOT NULL,
    from_status TEXT NOT NULL,
    to_status TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    lat REAL,
    lng REAL,
    at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS location_pings (
    id TEXT PRIMARY KEY,
    booking_id TEXT NOT NULL,
    vendor_id TEXT NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    accuracy REAL,
    recorded_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS quote_adjustments (
    id TEXT PRIMARY KEY,
    booking_id TEXT NOT NULL,
    vendor_id TEXT NOT NULL,
    old_total INTEGER NOT NULL,
    new_total INTEGER NOT NULL,
    reason TEXT NOT NULL,
    photo_key TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    decided_at TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS cancellations (
    id TEXT PRIMARY KEY,
    booking_id TEXT NOT NULL UNIQUE,
    cancelled_by TEXT NOT NULL,
    reason_code TEXT NOT NULL,
    vendor_at_fault BOOLEAN NOT NULL DEFAULT FALSE,
    penalty_ngn INTEGER NOT NULL DEFAULT 0,
    refund_ngn INTEGER NOT NULL DEFAULT 0,
    gateway_reversal_ref TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS disputes (
    id TEXT PRIMARY KEY,
    booking_id TEXT NOT NULL,
    raised_by TEXT NOT NULL,
    category TEXT NOT NULL,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    resolution TEXT,
    created_at TEXT NOT NULL,
    resolved_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS payouts (
    id TEXT PRIMARY KEY,
    booking_id TEXT NOT NULL UNIQUE,
    vendor_id TEXT NOT NULL,
    amount_ngn INTEGER NOT NULL,
    penalty_ngn INTEGER NOT NULL DEFAULT 0,
    provider TEXT NOT NULL,
    transfer_ref TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'completed',
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS otp_sends (
    phone TEXT NOT NULL,
    sent_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS waitlist (
    id TEXT PRIMARY KEY,
    lga TEXT NOT NULL,
    phone TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
];

let sqlite: DatabaseSync | null = null;
let pool: Pool | null = null;
let ready: Promise<void> | null = null;
let initializing = false;

async function init(): Promise<void> {
  initializing = true;
  try {
  if (!isPostgres) {
    const dbPath = DATABASE_URL.replace(/^file:/, '');
    const resolved = path.resolve(process.cwd(), dbPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    sqlite = new DatabaseSync(resolved);
    sqlite.exec(DDL.join(';\n'));
    // Migrate pre-Phase-3 local databases that lack the newer columns.
    const cols = (sqlite.prepare('PRAGMA table_info(bookings)').all() as any[]).map((c) => c.name);
    if (!cols.includes('vendor_id')) sqlite.exec('ALTER TABLE bookings ADD COLUMN vendor_id TEXT');
    if (!cols.includes('arrived_at')) sqlite.exec('ALTER TABLE bookings ADD COLUMN arrived_at TEXT');
  } else {
    pool = new Pool({ connectionString: DATABASE_URL });
    for (const stmt of DDL) await pool.query(stmt);
    await pool.query('ALTER TABLE bookings ADD COLUMN IF NOT EXISTS vendor_id TEXT');
    await pool.query('ALTER TABLE bookings ADD COLUMN IF NOT EXISTS arrived_at TEXT');
  }
  // Seed DB-backed pricing from shared defaults (DB is authoritative).
  for (const c of WASTE_CATEGORIES) {
    await run(
      'INSERT INTO waste_categories (id, slug, label, base_rate_ngn, unit, special_fee_ngn) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING',
      c.id, c.slug, c.label, c.baseRateNGN, c.unit, c.specialFeeNGN
    );
  }
  for (const l of PILOT_LGAS) {
    await run('INSERT INTO lgas (id, name, surcharge_ngn) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING',
      l.id, l.name, l.surchargeNGN);
  }
  } finally {
    initializing = false;
  }
}

function ensure(): Promise<void> {
  // run()/get()/all() call ensure() internally; during init the connection
  // already exists, so skip waiting on the in-flight init promise itself.
  if (initializing) return Promise.resolve();
  if (!ready) ready = init();
  return ready;
}

/** Single-row SELECT. Returns undefined when no row matches (both backends). */
export async function get(sql: string, ...params: any[]): Promise<any> {
  await ensure();
  if (pool) {
    const r = await pool.query(toPg(sql), params);
    return normRow(r.rows[0]);
  }
  return normRow(sqlite!.prepare(sql).get(...params));
}

/** Multi-row SELECT. Always returns an array. */
export async function all(sql: string, ...params: any[]): Promise<any[]> {
  await ensure();
  if (pool) {
    const r = await pool.query(toPg(sql), params);
    return r.rows.map(normRow);
  }
  return (sqlite!.prepare(sql).all(...params) as any[]).map(normRow);
}

/** INSERT/UPDATE/DELETE. Return value intentionally unused by callers. */
export async function run(sql: string, ...params: any[]): Promise<void> {
  await ensure();
  if (pool) {
    await pool.query(toPg(sql), params);
    return;
  }
  sqlite!.prepare(sql).run(...params);
}
