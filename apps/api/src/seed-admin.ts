import './env.js';
import { get, run } from './db.js';
import { hashPassword } from './password.js';
import crypto from 'node:crypto';

// Idempotent admin seeder, fully env-driven:
//   ADMIN_PHONE    (default +2348000000001)
//   ADMIN_PASSWORD (required, min 12 chars) — stored only as a scrypt hash
//   ADMIN_NAME     (default "Ops Admin")
// Safe to run repeatedly: existing admins are updated in place, never duplicated.
// The password value itself is never logged.
export async function ensureSeedAdmin(): Promise<{ created: boolean; phone: string }> {
  const phone = (process.env.ADMIN_PHONE ?? '+2348000000001').replace(/\s/g, '');
  const password = process.env.ADMIN_PASSWORD ?? '';
  if (!/^\+?[0-9]{7,15}$/.test(phone)) throw new Error('ADMIN_PHONE must look like +2348000000001');
  if (password.length < 12) throw new Error('ADMIN_PASSWORD must be set and at least 12 chars');
  const name = process.env.ADMIN_NAME ?? 'Ops Admin';
  const now = new Date().toISOString();

  const existing = (await get('SELECT * FROM users WHERE phone = ?', phone)) as any;
  if (!existing) {
    await run(
      'INSERT INTO users (id, role, phone, phone_verified, name, password_hash, active, created_at) VALUES (?, ?, ?, TRUE, ?, ?, TRUE, ?)',
      crypto.randomUUID(), 'admin', phone, name, hashPassword(password), now
    );
    return { created: true, phone };
  }
  await run(
    'UPDATE users SET role=?, phone_verified=TRUE, name=?, password_hash=?, active=TRUE WHERE phone=?',
    'admin', name, hashPassword(password), phone
  );
  return { created: false, phone };
}

async function main() {
  const r = await ensureSeedAdmin();
  console.log(`[seed:admin] admin ${r.created ? 'created' : 'updated'}: ${r.phone}`);
}

const isMain = (process.argv[1] ?? '').replace(/\\/g, '/').endsWith('apps/api/src/seed-admin.ts');
if (isMain) {
  main().catch((e) => {
    console.error('[seed:admin] failed', e?.message ?? e);
    process.exit(1);
  });
}
