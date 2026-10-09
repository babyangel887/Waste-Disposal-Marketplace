import crypto from 'node:crypto';
import { get, run } from './db.js';
import { hashPassword } from './password.js';

// Test-only admin password (dummy value, never used outside tests).
export const TEST_ADMIN_PASSWORD = 'test-admin-pass-1234';

// Hermetic tests: every test file must pass on a fresh database.
// The seed admin (+2348000000001) cannot self-register via OTP
// (Phase 1 blocks admin self-registration), so ensure it exists here.
// Admins log in via admin-login with a password, so a known test hash is set.
// This mirrors apps/api/src/seed.ts without depending on CI step order.
export async function ensureSeedAdmin() {
  const adminPhone = '+2348000000001';
  const existing = (await get('SELECT * FROM users WHERE phone = ?', adminPhone)) as any;
  if (!existing) {
    await run(
      'INSERT INTO users (id, role, phone, phone_verified, name, password_hash, active, created_at) VALUES (?, ?, ?, TRUE, ?, ?, TRUE, ?)',
      crypto.randomUUID(), 'admin', adminPhone, 'Ops Admin', hashPassword(TEST_ADMIN_PASSWORD), new Date().toISOString()
    );
  } else {
    await run('UPDATE users SET role=?, password_hash=?, active=TRUE WHERE phone=?', 'admin', hashPassword(TEST_ADMIN_PASSWORD), adminPhone);
  }
}

// Test isolation for the rolling offer queue: offers are transient and the
// matcher routes least-busy-first, so stale offers from earlier runs/suites
// would steal routing. Clearing makes each test's vendor deterministic
// (all vendors at 0 offers → newest vendor wins the tie-break).
export async function clearOffers() {
  await run('DELETE FROM job_offers');
}
