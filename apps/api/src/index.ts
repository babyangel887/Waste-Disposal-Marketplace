import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import { db } from './db.js';
import { requestOtp, verifyOtp } from './otp.js';
import { signAccess, signRefresh, verifyToken } from './jwt.js';
import { estimatePrice, PILOT_LGAS, WASTE_CATEGORIES, PRIVACY_POLICY_VERSION } from '@waste/shared';

export const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true, phase: 0 }));

// --- Auth: phone OTP (PRD §2.1) ---
app.post('/api/v1/auth/request-otp', async (req, res) => {
  try {
    const { phone } = req.body ?? {};
    if (!phone) return res.status(400).json({ error: 'phone required' });
    const r = await requestOtp(String(phone));
    res.json(r);
  } catch (e: any) {
    res.status(429).json({ error: e.message });
  }
});

app.post('/api/v1/auth/verify-otp', (req, res) => {
  try {
    const { phone, code, role, name } = req.body ?? {};
    if (!phone || !code) return res.status(400).json({ error: 'phone + code required' });
    verifyOtp(String(phone), String(code));

    const cleanPhone = String(phone).replace(/\s/g, '');
    let user = db.prepare('SELECT * FROM users WHERE phone = ?').get(cleanPhone) as any;
    if (!user) {
      const id = crypto.randomUUID();
      const r = role === 'vendor' || role === 'admin' ? role : 'customer';
      db.prepare(
        'INSERT INTO users (id, role, phone, phone_verified, name, active, created_at) VALUES (?, ?, ?, 1, ?, 1, ?)'
      ).run(id, r, cleanPhone, name ?? null, new Date().toISOString());
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any;
    } else {
      db.prepare('UPDATE users SET phone_verified = 1 WHERE phone = ?').run(cleanPhone);
    }
    const payload = { sub: user.id, role: user.role, phone: user.phone };
    res.json({
      access_token: signAccess(payload),
      refresh_token: signRefresh(payload),
      user: { id: user.id, role: user.role, phone: user.phone, name: user.name },
    });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

function auth(req: any, res: any, next: any) {
  const h = req.headers.authorization ?? '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'missing token' });
  try {
    (req as any).user = verifyToken(token);
    next();
  } catch {
    return res.status(401).json({ error: 'invalid token' });
  }
}

app.get('/api/v1/me', auth, (req: any, res) => {
  const u = db.prepare('SELECT id, role, phone, name FROM users WHERE id = ?').get(req.user.sub);
  res.json(u);
});

// --- NDPA consent (PRD §5.1) ---
app.post('/api/v1/auth/consent', auth, (req: any, res) => {
  const { consent_type, version } = req.body ?? {};
  if (!consent_type) return res.status(400).json({ error: 'consent_type required' });
  db.prepare(
    'INSERT INTO consent_logs (id, user_id, consent_type, version, accepted_at, ip) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(
    crypto.randomUUID(),
    req.user.sub,
    String(consent_type),
    String(version ?? PRIVACY_POLICY_VERSION),
    new Date().toISOString(),
    req.ip ?? null
  );
  res.json({ ok: true, version: version ?? PRIVACY_POLICY_VERSION });
});

// --- Pricing estimate (PRD §4.2, server-side authoritative) ---
app.post('/api/v1/bookings/estimate', (req, res) => {
  try {
    const { category_slug, qty, lga } = req.body ?? {};
    const result = estimatePrice(String(category_slug), Number(qty), String(lga));
    res.json({ ...result, currency: 'NGN', pilot_lgas: PILOT_LGAS.map((l) => l.name) });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/v1/catalog', (_req, res) => {
  res.json({ categories: WASTE_CATEGORIES, lgas: PILOT_LGAS, currency: 'NGN' });
});

// --- Upload presign (photos/docs). Phase 0: local signed URL; prod: S3. ---
app.post('/api/v1/uploads/presign', auth, (req, res) => {
  const { kind, contentType } = req.body ?? {}; // kind: waste_photo | vendor_doc
  if (!['waste_photo', 'vendor_doc'].includes(kind)) return res.status(400).json({ error: 'invalid kind' });
  const key = `${kind}/${Date.now()}-${crypto.randomUUID()}`;
  const base = process.env.S3_PUBLIC_BASE_URL ?? 'http://localhost:4000/uploads';
  // TODO Phase 1: return real S3 presigned PUT URL when S3_ENDPOINT configured.
  res.json({ key, uploadUrl: `${base}/${key}?signed=1`, publicUrl: `${base}/${key}`, expiresIn: 600, contentType });
});

// --- Admin stub (expanded in Phase 1) ---
app.get('/api/v1/admin/overview', auth, (req: any, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'admin only' });
  const users = (db.prepare('SELECT COUNT(*) as c FROM users').get() as any).c;
  res.json({ users, pilot_lgas: PILOT_LGAS.map((l) => l.name), pricing_version: 'phase0-seed' });
});

const PORT = Number(process.env.PORT ?? 4000);
const isMain = (process.argv[1] ?? '').replace(/\\/g, '/').endsWith('apps/api/src/index.ts')
  || (process.argv[1] ?? '').replace(/\\/g, '/').endsWith('apps/api/dist/index.js');
if (isMain) {
  app.listen(PORT, () => console.log(`[api] Phase 0 listening on :${PORT}`));
}
