import crypto from 'node:crypto';
import { db } from './db.js';

// Hermetic tests: every test file must pass on a fresh database.
// The seed admin (+2348000000001) cannot self-register via OTP
// (Phase 1 blocks admin self-registration), so ensure it exists here.
// This mirrors apps/api/src/seed.ts without depending on CI step order.
export function ensureSeedAdmin() {
  const adminPhone = '+2348000000001';
  const existing = db.prepare('SELECT * FROM users WHERE phone = ?').get(adminPhone) as any;
  if (!existing) {
    db.prepare(
      'INSERT INTO users (id, role, phone, phone_verified, name, active, created_at) VALUES (?, ?, ?, 1, ?, 1, ?)'
    ).run(crypto.randomUUID(), 'admin', adminPhone, 'Ops Admin', new Date().toISOString());
  } else if (existing.role !== 'admin' || existing.active !== 1) {
    db.prepare('UPDATE users SET role=?, active=? WHERE phone=?').run('admin', 1, adminPhone);
  }
}

// Test isolation for the rolling offer queue: offers are transient and the
// matcher routes least-busy-first, so stale offers from earlier runs/suites
// would steal routing. Clearing makes each test's vendor deterministic
// (all vendors at 0 offers → newest vendor wins the tie-break).
export function clearOffers() {
  db.prepare('DELETE FROM job_offers').run();
}
