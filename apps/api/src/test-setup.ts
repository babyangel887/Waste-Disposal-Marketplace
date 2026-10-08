import crypto from 'node:crypto';
import { get, run } from './db.js';

// Hermetic tests: every test file must pass on a fresh database.
// The seed admin (+2348000000001) cannot self-register via OTP
// (Phase 1 blocks admin self-registration), so ensure it exists here.
// This mirrors apps/api/src/seed.ts without depending on CI step order.
export async function ensureSeedAdmin() {
  const adminPhone = '+2348000000001';
  const existing = (await get('SELECT * FROM users WHERE phone = ?', adminPhone)) as any;
  if (!existing) {
    await run(
      'INSERT INTO users (id, role, phone, phone_verified, name, active, created_at) VALUES (?, ?, ?, TRUE, ?, TRUE, ?)',
      crypto.randomUUID(), 'admin', adminPhone, 'Ops Admin', new Date().toISOString()
    );
  } else if (existing.role !== 'admin' || existing.active !== 1) {
    await run('UPDATE users SET role=?, active=TRUE WHERE phone=?', 'admin', adminPhone);
  }
}

// Test isolation for the rolling offer queue: offers are transient and the
// matcher routes least-busy-first, so stale offers from earlier runs/suites
// would steal routing. Clearing makes each test's vendor deterministic
// (all vendors at 0 offers → newest vendor wins the tie-break).
export async function clearOffers() {
  await run('DELETE FROM job_offers');
}
