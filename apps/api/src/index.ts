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

app.get('/health', (_req, res) => res.json({ ok: true, phase: 1 }));

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
      const requestedRole = role === 'vendor' ? 'vendor' : 'customer';
      if (role === 'admin') return res.status(403).json({ error: 'admin accounts are seed-only in Phase 1' });
      const id = crypto.randomUUID();
      const r = requestedRole;
      db.prepare(
        'INSERT INTO users (id, role, phone, phone_verified, name, active, created_at) VALUES (?, ?, ?, 1, ?, 1, ?)'
      ).run(id, r, cleanPhone, name ?? null, new Date().toISOString());
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any;
    } else {
      db.prepare('UPDATE users SET phone_verified = 1 WHERE phone = ?').run(cleanPhone);
    }
    if (user && user.active === 0) return res.status(403).json({ error: 'account blocked' });
    const fresh = db.prepare('SELECT * FROM users WHERE phone = ?').get(cleanPhone) as any;
    const payload = { sub: fresh.id, role: fresh.role, phone: fresh.phone };
    res.json({
      access_token: signAccess(payload),
      refresh_token: signRefresh(payload),
      user: { id: fresh.id, role: fresh.role, phone: fresh.phone, name: fresh.name },
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

// --- Pricing: DB-backed (Phase 1 authoritative, shared as seed/fallback) ---
function dbCategories() {
  const rows = db.prepare('SELECT * FROM waste_categories').all() as any[];
  if (rows.length === 0) return WASTE_CATEGORIES;
  return rows.map((r) => ({
    id: r.id, slug: r.slug, label: r.label,
    baseRateNGN: r.base_rate_ngn, unit: r.unit, specialFeeNGN: r.special_fee_ngn,
  }));
}
function dbLGAs() {
  const rows = db.prepare('SELECT * FROM lgas').all() as any[];
  if (rows.length === 0) return PILOT_LGAS;
  return rows.map((r) => ({ id: r.id, name: r.name, surchargeNGN: r.surcharge_ngn }));
}
function dbEstimate(categorySlug: string, qty: number, lgaName: string) {
  const cats = dbCategories() as any[];
  const lgas = dbLGAs() as any[];
  const cat = cats.find((c) => c.slug === categorySlug);
  if (!cat) throw new Error(`unknown category: ${categorySlug}`);
  const lga = lgas.find((l) => String(l.name).toLowerCase() === String(lgaName).toLowerCase());
  if (!lga) throw new Error(`outside pilot area: ${lgaName}. Pilot: ${lgas.map((l: any) => l.name).join(', ')}`);
  if (!Number.isFinite(qty) || qty <= 0) throw new Error('qty must be > 0');
  const baseRate = cat.baseRateNGN * qty;
  return { baseRate, lgaSurcharge: lga.surchargeNGN, specialFee: cat.specialFeeNGN, total: baseRate + lga.surchargeNGN + cat.specialFeeNGN };
}

// --- Pricing estimate (PRD §4.2, server-side authoritative) ---
app.post('/api/v1/bookings/estimate', (req, res) => {
  try {
    const { category_slug, qty, lga } = req.body ?? {};
    const result = dbEstimate(String(category_slug), Number(qty), String(lga));
    res.json({ ...result, currency: 'NGN', pilot_lgas: dbLGAs().map((l: any) => l.name) });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/v1/catalog', (_req, res) => {
  res.json({ categories: dbCategories(), lgas: dbLGAs(), currency: 'NGN' });
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

// --- Vendor onboarding (Phase 1: all 3 docs required → pending) ---
const REQUIRED_DOCS = ['vehicle_reg', 'drivers_license', 'business_doc'];
app.post('/api/v1/vendor/onboarding', auth, (req: any, res) => {
  if (req.user.role !== 'vendor') return res.status(403).json({ error: 'vendor role required' });
  const { business_name, license_no, vehicle, documents } = req.body ?? {};
  if (!business_name || typeof business_name !== 'string')
    return res.status(400).json({ error: 'business_name required' });
  if (!vehicle?.plate_no || !vehicle?.type)
    return res.status(400).json({ error: 'vehicle.plate_no + vehicle.type required' });
  for (const d of REQUIRED_DOCS) {
    if (!documents?.[d] || typeof documents[d] !== 'string')
      return res.status(400).json({ error: `documents.${d} file key required (all 3 docs)` });
  }
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO vendor_profiles (user_id, business_name, license_no, approved_status, created_at, updated_at)
     VALUES (?, ?, ?, 'pending', ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET business_name=excluded.business_name, license_no=excluded.license_no,
       approved_status='pending', rejection_reason=NULL, approved_by=NULL, approved_at=NULL, updated_at=excluded.updated_at`
  ).run(req.user.sub, business_name, license_no ?? null, now, now);
  db.prepare('DELETE FROM vehicles WHERE vendor_id = ?').run(req.user.sub);
  db.prepare(
    'INSERT INTO vehicles (id, vendor_id, plate_no, type, capacity_kg, photo_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(
    crypto.randomUUID(), req.user.sub, String(vehicle.plate_no),
    String(vehicle.type), vehicle.capacity_kg ?? null, vehicle.photo_key ?? null, now
  );
  for (const d of REQUIRED_DOCS) {
    db.prepare(
      `INSERT INTO vendor_documents (id, vendor_id, type, file_key, verified, created_at) VALUES (?, ?, ?, ?, 0, ?)
       ON CONFLICT(vendor_id, type) DO UPDATE SET file_key=excluded.file_key, verified=0`
    ).run(crypto.randomUUID(), req.user.sub, d, String(documents[d]), now);
  }
  res.json({ ok: true, status: 'pending' });
});

app.get('/api/v1/vendor/me/profile', auth, (req: any, res) => {
  if (req.user.role !== 'vendor') return res.status(403).json({ error: 'vendor role required' });
  const profile = db.prepare('SELECT * FROM vendor_profiles WHERE user_id = ?').get(req.user.sub) as any;
  if (!profile) return res.status(404).json({ error: 'no onboarding submitted' });
  const vehicle = db.prepare('SELECT * FROM vehicles WHERE vendor_id = ?').get(req.user.sub);
  const docs = db.prepare('SELECT type, file_key, verified FROM vendor_documents WHERE vendor_id = ?').all(req.user.sub);
  res.json({ profile, vehicle, documents: docs });
});

// --- Admin: vendor queue + block/unblock + audit (Phase 1, seed admin only) ---
function requireAdmin(req: any, res: any, next: any) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'admin only' });
  const me = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.sub) as any;
  if (!me || me.active === 0) return res.status(403).json({ error: 'admin blocked' });
  next();
}
function audit(actorId: string, action: string, targetType: string, targetId: string, meta?: any) {
  db.prepare(
    'INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(crypto.randomUUID(), actorId, action, targetType, targetId, meta ? JSON.stringify(meta) : null, new Date().toISOString());
}

app.get('/api/v1/admin/vendors', auth, requireAdmin, (req: any, res) => {
  const status = String(req.query.status ?? 'pending');
  let rows: any[];
  if (status === 'all') {
    rows = db.prepare(
      `SELECT u.id, u.phone, u.name, u.active, p.business_name, p.license_no, p.approved_status, p.rejection_reason, p.blocked, p.created_at
       FROM users u JOIN vendor_profiles p ON p.user_id = u.id ORDER BY p.created_at DESC`
    ).all();
  } else if (status === 'blocked') {
    rows = db.prepare(
      `SELECT u.id, u.phone, u.name, u.active, p.business_name, p.license_no, p.approved_status, p.rejection_reason, p.blocked, p.created_at
       FROM users u JOIN vendor_profiles p ON p.user_id = u.id WHERE p.blocked = 1 ORDER BY p.created_at DESC`
    ).all();
  } else {
    rows = db.prepare(
      `SELECT u.id, u.phone, u.name, u.active, p.business_name, p.license_no, p.approved_status, p.rejection_reason, p.blocked, p.created_at
       FROM users u JOIN vendor_profiles p ON p.user_id = u.id WHERE p.approved_status = ? ORDER BY p.created_at DESC`
    ).all(status);
  }
  res.json({ vendors: rows });
});

app.get('/api/v1/admin/vendors/:id', auth, requireAdmin, (req: any, res) => {
  const profile = db.prepare('SELECT * FROM vendor_profiles WHERE user_id = ?').get(req.params.id) as any;
  if (!profile) return res.status(404).json({ error: 'vendor not found' });
  const user = db.prepare('SELECT id, phone, name, active FROM users WHERE id = ?').get(req.params.id);
  const vehicle = db.prepare('SELECT * FROM vehicles WHERE vendor_id = ?').get(req.params.id);
  const docs = db.prepare('SELECT type, file_key, verified FROM vendor_documents WHERE vendor_id = ?').all(req.params.id);
  res.json({ user, profile, vehicle, documents: docs });
});

app.post('/api/v1/admin/vendors/:id/approve', auth, requireAdmin, (req: any, res) => {
  const now = new Date().toISOString();
  const p = db.prepare('SELECT * FROM vendor_profiles WHERE user_id = ?').get(req.params.id) as any;
  if (!p) return res.status(404).json({ error: 'vendor not found' });
  db.prepare(
    "UPDATE vendor_profiles SET approved_status='approved', rejection_reason=NULL, approved_by=?, approved_at=?, updated_at=? WHERE user_id=?"
  ).run(req.user.sub, now, now, req.params.id);
  db.prepare('UPDATE vendor_documents SET verified=1 WHERE vendor_id=?').run(req.params.id);
  audit(req.user.sub, 'vendor.approve', 'vendor', req.params.id, null);
  res.json({ ok: true, status: 'approved' });
});

app.post('/api/v1/admin/vendors/:id/reject', auth, requireAdmin, (req: any, res) => {
  const { reason } = req.body ?? {};
  if (!reason) return res.status(400).json({ error: 'reason required' });
  const p = db.prepare('SELECT * FROM vendor_profiles WHERE user_id = ?').get(req.params.id) as any;
  if (!p) return res.status(404).json({ error: 'vendor not found' });
  db.prepare(
    "UPDATE vendor_profiles SET approved_status='rejected', rejection_reason=?, approved_by=?, approved_at=?, updated_at=? WHERE user_id=?"
  ).run(String(reason), req.user.sub, new Date().toISOString(), new Date().toISOString(), req.params.id);
  audit(req.user.sub, 'vendor.reject', 'vendor', req.params.id, { reason });
  res.json({ ok: true, status: 'rejected' });
});

app.post('/api/v1/admin/vendors/:id/block', auth, requireAdmin, (req: any, res) => {
  db.prepare('UPDATE vendor_profiles SET blocked=1 WHERE user_id=?').run(req.params.id);
  db.prepare('UPDATE users SET active=0 WHERE id=?').run(req.params.id);
  audit(req.user.sub, 'vendor.block', 'vendor', req.params.id, null);
  res.json({ ok: true, blocked: true });
});

app.post('/api/v1/admin/vendors/:id/unblock', auth, requireAdmin, (req: any, res) => {
  db.prepare('UPDATE vendor_profiles SET blocked=0 WHERE user_id=?').run(req.params.id);
  db.prepare('UPDATE users SET active=1 WHERE id=?').run(req.params.id);
  audit(req.user.sub, 'vendor.unblock', 'vendor', req.params.id, null);
  res.json({ ok: true, blocked: false });
});

app.get('/api/v1/admin/audit', auth, requireAdmin, (req: any, res) => {
  const limit = Math.min(Number(req.query.limit ?? 50), 200);
  const rows = db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?').all(limit);
  res.json({ logs: rows });
});

// --- Admin: pricing console (Phase 1, DB-backed + history) ---
app.get('/api/v1/admin/pricing', auth, requireAdmin, (_req: any, res) => {
  res.json({ categories: dbCategories(), lgas: dbLGAs(), currency: 'NGN' });
});

app.put('/api/v1/admin/pricing/categories/:id', auth, requireAdmin, (req: any, res) => {
  const { base_rate_ngn, special_fee_ngn } = req.body ?? {};
  const row = db.prepare('SELECT * FROM waste_categories WHERE id = ?').get(req.params.id) as any;
  if (!row) return res.status(404).json({ error: 'category not found' });
  const now = new Date().toISOString();
  if (base_rate_ngn !== undefined) {
    const v = Number(base_rate_ngn);
    if (!Number.isInteger(v) || v < 0) return res.status(400).json({ error: 'base_rate_ngn must be int >= 0' });
    db.prepare('UPDATE waste_categories SET base_rate_ngn=? WHERE id=?').run(v, req.params.id);
    db.prepare(
      'INSERT INTO pricing_history (id, entity_type, entity_id, field, old_value, new_value, changed_by, changed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(crypto.randomUUID(), 'category', req.params.id, 'base_rate_ngn', row.base_rate_ngn, v, req.user.sub, now);
  }
  if (special_fee_ngn !== undefined) {
    const v = Number(special_fee_ngn);
    if (!Number.isInteger(v) || v < 0) return res.status(400).json({ error: 'special_fee_ngn must be int >= 0' });
    db.prepare('UPDATE waste_categories SET special_fee_ngn=? WHERE id=?').run(v, req.params.id);
    db.prepare(
      'INSERT INTO pricing_history (id, entity_type, entity_id, field, old_value, new_value, changed_by, changed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(crypto.randomUUID(), 'category', req.params.id, 'special_fee_ngn', row.special_fee_ngn, v, req.user.sub, now);
  }
  audit(req.user.sub, 'pricing.update_category', 'category', req.params.id, req.body);
  res.json({ ok: true, category: db.prepare('SELECT * FROM waste_categories WHERE id = ?').get(req.params.id) });
});

app.put('/api/v1/admin/pricing/lgas/:id', auth, requireAdmin, (req: any, res) => {
  const { surcharge_ngn } = req.body ?? {};
  const row = db.prepare('SELECT * FROM lgas WHERE id = ?').get(req.params.id) as any;
  if (!row) return res.status(404).json({ error: 'lga not found' });
  const v = Number(surcharge_ngn);
  if (!Number.isInteger(v) || v < 0) return res.status(400).json({ error: 'surcharge_ngn must be int >= 0' });
  const now = new Date().toISOString();
  db.prepare('UPDATE lgas SET surcharge_ngn=? WHERE id=?').run(v, req.params.id);
  db.prepare(
    'INSERT INTO pricing_history (id, entity_type, entity_id, field, old_value, new_value, changed_by, changed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(crypto.randomUUID(), 'lga', req.params.id, 'surcharge_ngn', row.surcharge_ngn, v, req.user.sub, now);
  audit(req.user.sub, 'pricing.update_lga', 'lga', req.params.id, req.body);
  res.json({ ok: true, lga: db.prepare('SELECT * FROM lgas WHERE id = ?').get(req.params.id) });
});

app.get('/api/v1/admin/pricing/history', auth, requireAdmin, (req: any, res) => {
  const limit = Math.min(Number(req.query.limit ?? 50), 200);
  res.json({ history: db.prepare('SELECT * FROM pricing_history ORDER BY changed_at DESC LIMIT ?').all(limit) });
});

// --- Admin: active jobs map stub (Phase 1; live tracking lands in Phase 3) ---
app.get('/api/v1/admin/jobs/active', auth, requireAdmin, (_req: any, res) => {
  res.json({ jobs: [], note: 'Phase 1 stub — shape: [{booking_id, vendor_id, last_lat, last_lng, last_at, status}]. Live heartbeats in Phase 3.' });
});

// --- Admin stub (expanded in Phase 1) ---
app.get('/api/v1/admin/overview', auth, (req: any, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'admin only' });
  const users = (db.prepare('SELECT COUNT(*) as c FROM users').get() as any).c;
  const pending = (db.prepare("SELECT COUNT(*) as c FROM vendor_profiles WHERE approved_status='pending'").get() as any).c;
  res.json({ users, vendors_pending: pending, pilot_lgas: dbLGAs().map((l: any) => l.name), pricing_version: 'phase1-db' });
});

const PORT = Number(process.env.PORT ?? 4000);
const isMain = (process.argv[1] ?? '').replace(/\\/g, '/').endsWith('apps/api/src/index.ts')
  || (process.argv[1] ?? '').replace(/\\/g, '/').endsWith('apps/api/dist/index.js');
if (isMain) {
  app.listen(PORT, () => console.log(`[api] Phase 0 listening on :${PORT}`));
}
