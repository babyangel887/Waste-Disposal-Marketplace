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

app.get('/health', (_req, res) => res.json({ ok: true, phase: 2 }));

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

// --- Customer bookings (Phase 2: creation with photo required, pilot-gated) ---
function serializeBooking(row: any) {
  if (!row) return row;
  try { row.photo_keys = JSON.parse(row.photo_keys); } catch { row.photo_keys = []; }
  return row;
}

app.post('/api/v1/bookings', auth, (req: any, res) => {
  if (req.user.role !== 'customer') return res.status(403).json({ error: 'customer role required' });
  const { category_slug, qty, lga, pickup_lat, pickup_lng, pickup_address, photo_keys } = req.body ?? {};
  const q = Number(qty);
  if (!Number.isInteger(q) || q <= 0 || q > 100)
    return res.status(400).json({ error: 'qty must be integer 1..100' });
  if (!Array.isArray(photo_keys) || photo_keys.length < 1 || photo_keys.length > 5)
    return res.status(400).json({ error: 'photo_keys required: 1..5 file keys' });
  if (!photo_keys.every((k: any) => typeof k === 'string' && k.length > 0))
    return res.status(400).json({ error: 'photo_keys must be non-empty strings' });
  const lat = Number(pickup_lat); const lng = Number(pickup_lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng))
    return res.status(400).json({ error: 'pickup_lat + pickup_lng required' });
  if (!pickup_address || typeof pickup_address !== 'string')
    return res.status(400).json({ error: 'pickup_address required' });
  let price: any;
  try { price = dbEstimate(String(category_slug), q, String(lga)); }
  catch (e: any) { return res.status(400).json({ error: e.message }); }
  const cats = dbCategories() as any[]; const lgas = dbLGAs() as any[];
  const cat = cats.find((c) => c.slug === String(category_slug));
  const lgaRow = lgas.find((l: any) => String(l.name).toLowerCase() === String(lga).toLowerCase());
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO bookings (id, customer_id, category_id, category_slug, lga_id, lga_name, qty,
      pickup_lat, pickup_lng, pickup_address, photo_keys,
      base_rate, lga_surcharge, special_fee, total_price, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'awaiting_payment', ?, ?)`
  ).run(id, req.user.sub, cat.id, cat.slug, lgaRow.id, lgaRow.name, q,
    lat, lng, String(pickup_address), JSON.stringify(photo_keys),
    price.baseRate, price.lgaSurcharge, price.specialFee, price.total, now, now);
  const row = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
  res.status(201).json({ booking: serializeBooking(row) });
});

app.get('/api/v1/bookings/mine', auth, (req: any, res) => {
  if (req.user.role !== 'customer') return res.status(403).json({ error: 'customer role required' });
  const status = req.query.status ? String(req.query.status) : null;
  const rows = (status
    ? db.prepare('SELECT * FROM bookings WHERE customer_id = ? AND status = ? ORDER BY created_at DESC').all(req.user.sub, status)
    : db.prepare('SELECT * FROM bookings WHERE customer_id = ? ORDER BY created_at DESC').all(req.user.sub)) as any[];
  res.json({ bookings: rows.map(serializeBooking) });
});

app.get('/api/v1/bookings/:id', auth, (req: any, res) => {
  const row = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id) as any;
  if (!row) return res.status(404).json({ error: 'booking not found' });
  const isOwner = row.customer_id === req.user.sub;
  if (!isOwner && req.user.role !== 'admin') return res.status(403).json({ error: 'not your booking' });
  const payment = db.prepare('SELECT * FROM payments WHERE booking_id = ?').get(req.params.id) as any;
  res.json({ booking: serializeBooking(row), payment: payment ?? null });
});

// Pre-payment cancel only (Phase 2). Post-payment cancel/refunds land in Phase 4.
app.post('/api/v1/bookings/:id/cancel', auth, (req: any, res) => {
  const row = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id) as any;
  if (!row) return res.status(404).json({ error: 'booking not found' });
  if (row.customer_id !== req.user.sub) return res.status(403).json({ error: 'not your booking' });
  if (row.status !== 'awaiting_payment')
    return res.status(409).json({ error: 'only awaiting_payment bookings can be cancelled in Phase 2' });
  const now = new Date().toISOString();
  db.prepare('UPDATE bookings SET status=?, cancel_reason=?, updated_at=? WHERE id=?').run(
    'cancelled', String(req.body?.reason ?? 'customer_cancelled'), now, req.params.id);
  res.json({ ok: true, status: 'cancelled' });
});

// --- Payments: gateway-led escrow mock (Phase 2). No wallet, no cash. ---
const MOCK_PROVIDERS = ['paystack', 'flutterwave'];
app.post('/api/v1/bookings/:id/authorize-payment', auth, (req: any, res) => {
  if (req.user.role !== 'customer') return res.status(403).json({ error: 'customer role required' });
  const { provider } = req.body ?? {};
  if (typeof provider === 'string' && ['cash', 'cod', 'cash_on_delivery'].includes(provider.toLowerCase()))
    return res.status(400).json({ error: 'cash payments are blocked; use paystack or flutterwave' });
  if (!MOCK_PROVIDERS.includes(provider))
    return res.status(400).json({ error: 'provider must be paystack or flutterwave' });
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id) as any;
  if (!booking) return res.status(404).json({ error: 'booking not found' });
  if (booking.customer_id !== req.user.sub) return res.status(403).json({ error: 'not your booking' });
  if (booking.status !== 'awaiting_payment')
    return res.status(409).json({ error: `booking already ${booking.status}` });
  const existing = db.prepare('SELECT * FROM payments WHERE booking_id = ?').get(req.params.id) as any;
  if (existing) return res.json({ payment: existing, booking: serializeBooking(booking) });
  const now = new Date().toISOString();
  const prefix = provider === 'paystack' ? 'AUTH' : 'FLW';
  const payment = {
    id: crypto.randomUUID(), booking_id: req.params.id, provider,
    authorization_code: `${prefix}_mock_${crypto.randomUUID().slice(0, 8)}`,
    amount_ngn: booking.total_price, status: 'held',
    gateway_ref: `mock_${provider}_charge_success_${Date.now()}`,
    idempotency_key: `auth:${req.params.id}`, created_at: now, updated_at: now,
  };
  db.prepare(
    'INSERT INTO payments (id, booking_id, provider, authorization_code, amount_ngn, status, gateway_ref, idempotency_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(payment.id, payment.booking_id, payment.provider, payment.authorization_code,
    payment.amount_ngn, payment.status, payment.gateway_ref, payment.idempotency_key, now, now);
  db.prepare('UPDATE bookings SET status=?, updated_at=? WHERE id=?').run('searching_vendor', now, req.params.id);
  const updated = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  res.status(201).json({ payment, booking: serializeBooking(updated) });
});

// Idempotent mock webhooks. Real signature verification lands with live keys (Phase 4).
function handleMockWebhook(provider: string, body: any) {
  const { booking_id, event } = body ?? {};
  if (!booking_id) return { status: 400 as const, json: { error: 'booking_id required' } };
  if (provider === 'flutterwave') return { status: 200 as const, json: { ok: true, stub: true } };
  if (event && event !== 'charge.success') return { status: 200 as const, json: { ok: true, ignored: event } };
  const payment = db.prepare('SELECT * FROM payments WHERE booking_id = ?').get(String(booking_id)) as any;
  if (!payment) return { status: 200 as const, json: { ok: true, ignored: 'no payment yet' } };
  const now = new Date().toISOString();
  db.prepare('UPDATE payments SET status=?, gateway_ref=?, updated_at=? WHERE booking_id=?').run(
    'held', payment.gateway_ref ?? `mock_${provider}_charge_success`, now, String(booking_id));
  db.prepare("UPDATE bookings SET status='searching_vendor', updated_at=? WHERE id=? AND status='awaiting_payment'").run(now, String(booking_id));
  return { status: 200 as const, json: { ok: true } };
}
app.post('/api/v1/webhooks/paystack', (req, res) => {
  const r = handleMockWebhook('paystack', req.body);
  res.status(r.status).json(r.json);
});
app.post('/api/v1/webhooks/flutterwave', (req, res) => {
  const r = handleMockWebhook('flutterwave', req.body);
  res.status(r.status).json(r.json);
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
