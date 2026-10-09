import './env.js';
import { get, run } from './db.js';
import crypto from 'node:crypto';

export const DEFAULT_ADMIN_PHONE = '+2348000000001';

// Production guard: never auto-create the well-known default admin when
// running with NODE_ENV=production or against Postgres (staging/prod).
function isProductionEnv(): boolean {
  if (process.env.NODE_ENV === 'production') return true;
  const url = process.env.DATABASE_URL ?? '';
  return url.startsWith('postgres://') || url.startsWith('postgresql://');
}

// One-time cleanup for databases that already contain the legacy default
// admin row. Demotes (never deletes — foreign keys may reference the row):
// role reset, account disabled, password hash cleared. Safe to re-run.
export async function demoteDefaultAdmin(): Promise<boolean> {
  const existing = (await get('SELECT * FROM users WHERE phone = ?', DEFAULT_ADMIN_PHONE)) as any;
  if (!existing) {
    console.log('[seed] default admin absent, nothing to clean');
    return false;
  }
  const active = existing.active === 1 || existing.active === true;
  if (existing.role !== 'admin' && !active && !existing.password_hash) {
    console.log('[seed] default admin already demoted, nothing to clean');
    return false;
  }
  await run('UPDATE users SET role=?, active=FALSE, password_hash=NULL WHERE phone=?', 'customer', DEFAULT_ADMIN_PHONE);
  console.log(`[seed] default admin demoted: ${DEFAULT_ADMIN_PHONE}`);
  return true;
}

async function main() {
  if (isProductionEnv()) {
    console.log('[seed] production/postgres guard: skipping default admin creation');
    await demoteDefaultAdmin();
    return;
  }
  // Seeds a demo admin + pilot catalog note. Categories/LGAs live in @waste/shared.
  const adminPhone = DEFAULT_ADMIN_PHONE;
  const existing = (await get('SELECT * FROM users WHERE phone = ?', adminPhone)) as any;
  if (!existing) {
    await run(
      'INSERT INTO users (id, role, phone, phone_verified, name, active, created_at) VALUES (?, ?, ?, TRUE, ?, TRUE, ?)',
      crypto.randomUUID(), 'admin', adminPhone, 'Ops Admin', new Date().toISOString()
    );
    console.log('[seed] admin created:', adminPhone);
  } else {
    console.log('[seed] admin exists:', adminPhone);
  }
  console.log('[seed] pilot LGAs: Eti-Osa, Ikeja; categories: bagged, bulky, rubble, recyclable');
}

const isMain = (process.argv[1] ?? '').replace(/\\/g, '/').endsWith('apps/api/src/seed.ts');
if (isMain) {
  main().catch((e) => {
    console.error('[seed] failed', e?.message ?? e);
    process.exit(1);
  });
}
