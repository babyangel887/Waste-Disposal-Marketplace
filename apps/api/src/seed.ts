import 'dotenv/config';
import { db } from './db.js';
import crypto from 'node:crypto';

// Seeds a demo admin + pilot catalog note. Categories/LGAs live in @waste/shared.
const adminPhone = '+2348000000001';
const existing = db.prepare('SELECT * FROM users WHERE phone = ?').get(adminPhone) as any;
if (!existing) {
  db.prepare(
    'INSERT INTO users (id, role, phone, phone_verified, name, active, created_at) VALUES (?, ?, ?, 1, ?, 1, ?)'
  ).run(crypto.randomUUID(), 'admin', adminPhone, 'Ops Admin', new Date().toISOString());
  console.log('[seed] admin created:', adminPhone);
} else {
  console.log('[seed] admin exists:', adminPhone);
}
console.log('[seed] pilot LGAs: Eti-Osa, Ikeja; categories: bagged, bulky, rubble, recyclable');
