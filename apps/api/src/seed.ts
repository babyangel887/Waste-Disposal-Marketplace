import './env.js';
import { get, run } from './db.js';
import crypto from 'node:crypto';

async function main() {
  // Seeds a demo admin + pilot catalog note. Categories/LGAs live in @waste/shared.
  const adminPhone = '+2348000000001';
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

main().catch((e) => {
  console.error('[seed] failed', e?.message ?? e);
  process.exit(1);
});
