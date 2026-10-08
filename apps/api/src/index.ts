import './env.js';
import { initializeTransaction } from './paystack.js';
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

app.get('/health', (_req, res) => res.json({ ok: true, phase: 5 }));

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

// --- NDPA privacy info: policy version, DPO contact, retention (no secrets) ---
app.get('/api/v1/privacy', (_req, res) => {
  res.json({
    policy_version: PRIVACY_POLICY_VERSION,
    dpo: process.env.DPO_CONTACT ?? 'dpo@example.com (placeholder — replace before launch)',
    retention_days: { location_pings: 90, waste_photos: 365 },
    tracking: 'location collected only during active jobs, heartbeat 30–60s, stops on complete/cancel',
    payments: 'funds held by licensed gateway only; no proprietary wallet',
  });
});

// --- NDPA data rights: export my data + delete my account ---
app.get('/api/v1/me/export', auth, (req: any, res) => {
  const user = db.prepare('SELECT id, role, phone, name, created_at FROM users WHERE id = ?').get(req.user.sub);
  res.json({
    user,
    consent_logs: db.prepare('SELECT consent_type, version, accepted_at FROM consent_logs WHERE user_id=?').all(req.user.sub),
    bookings: db.prepare('SELECT * FROM bookings WHERE customer_id=? OR vendor_id=?').all(req.user.sub, req.user.sub),
    payments: db.prepare('SELECT * FROM payments WHERE booking_id IN (SELECT id FROM bookings WHERE customer_id=? OR vendor_id=?)').all(req.user.sub, req.user.sub),
    payouts: db.prepare('SELECT * FROM payouts WHERE vendor_id=?').all(req.user.sub),
    disputes: db.prepare('SELECT * FROM disputes WHERE raised_by=?').all(req.user.sub),
  });
});

app.delete('/api/v1/me', auth, (req: any, res) => {
  const now = new Date().toISOString();
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.sub) as any;
  if (!u) return res.status(404).json({ error: 'not found' });
  db.prepare('UPDATE users SET name=NULL, phone=?, active=0 WHERE id=?').run(`deleted_${req.user.sub}`, req.user.sub);
  db.prepare('UPDATE vendor_profiles SET blocked=1 WHERE user_id=?').run(req.user.sub);
  db.prepare('DELETE FROM otp_codes WHERE phone=?').run(u.phone);
  audit(req.user.sub, 'account.delete', 'user', req.user.sub, { at: now });
  res.json({ ok: true, deleted_at: now });
});

// --- Retention purge: location pings older than 90 days (admin; run as cron) ---
const RETENTION_PING_DAYS = 90;
app.post('/api/v1/admin/retention/purge', auth, requireAdmin, (req: any, res) => {
  const cutoff = new Date(Date.now() - RETENTION_PING_DAYS * 24 * 3600 * 1000).toISOString();
  const n = (db.prepare('SELECT COUNT(*) as c FROM location_pings WHERE recorded_at < ?').get(cutoff) as any).c as number;
  db.prepare('DELETE FROM location_pings WHERE recorded_at < ?').run(cutoff);
  audit(req.user.sub, 'retention.purge_pings', 'system', 'location_pings', { cutoff, deleted: n });
  res.json({ ok: true, deleted_pings: n, cutoff, retention_days: RETENTION_PING_DAYS });
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
  const isVendor = row.vendor_id === req.user.sub;
  if (!isOwner && !isVendor && req.user.role !== 'admin') return res.status(403).json({ error: 'not your booking' });
  const payment = db.prepare('SELECT * FROM payments WHERE booking_id = ?').get(req.params.id) as any;
  const payout = db.prepare('SELECT * FROM payouts WHERE booking_id = ?').get(req.params.id) as any;
  const adjustment = db.prepare("SELECT * FROM quote_adjustments WHERE booking_id=? AND status='pending'").get(req.params.id) as any;
  const history = db.prepare('SELECT * FROM job_status_history WHERE booking_id=? ORDER BY at ASC').all(req.params.id);
  const booking = serializeBooking(row);
  if (req.user.role === 'customer' && booking.vendor_id) {
    const v = db.prepare('SELECT id FROM users WHERE id = ?').get(booking.vendor_id) as any;
    booking.vendor = v ? { id: String(v.id).slice(0, 8) + '…' } : null;
  }
  res.json({ booking, payment: payment ?? null, payout: payout ?? null, adjustment: adjustment ?? null, history });
});

// Cancel rules (Phase 4, PRD §7, mocked gateway; amounts in NGN).
// 7.1 vendor fault (no-show, >30min late) → full refund, no penalty.
// 7.2 customer fault (late change-mind, absent, adjustment-reject) → ₦3,000 fuel fee to vendor, rest refunded.
const FUEL_PENALTY_NGN = 3000;
const VENDOR_FAULT_CODES = ['vendor_no_show', 'vendor_late'];
const CUSTOMER_FAULT_CODES = ['customer_change_mind', 'customer_absent', 'adjustment_rejected'];
function minutesSince(bookingId: string, toStatus: string) {
  const h = db.prepare('SELECT at FROM job_status_history WHERE booking_id=? AND to_status=? ORDER BY at ASC LIMIT 1').get(bookingId, toStatus) as any;
  if (!h) return null;
  return (Date.now() - new Date(h.at).getTime()) / 60000;
}
function settleCancel(booking: any, cancelledBy: string, reasonCode: string, vendorAtFault: boolean, penalty: number) {
  const now = new Date().toISOString();
  const total = booking.total_price;
  const pen = Math.max(0, Math.min(penalty, total));
  const refund = total - pen;
  const payment = db.prepare('SELECT * FROM payments WHERE booking_id = ?').get(booking.id) as any;
  const reversalRef = `mock_reversal_${crypto.randomUUID().slice(0, 8)}`;
  if (payment && payment.status === 'held') {
    db.prepare('UPDATE payments SET status=?, gateway_ref=?, updated_at=? WHERE booking_id=?').run(
      pen > 0 ? (refund > 0 ? 'partial_refund' : 'refunded') : 'refunded', reversalRef, now, booking.id);
  }
  let payout: any = null;
  if (pen > 0 && booking.vendor_id) {
    payout = {
      id: crypto.randomUUID(), booking_id: booking.id, vendor_id: booking.vendor_id,
      amount_ngn: pen, penalty_ngn: pen, provider: payment?.provider ?? 'paystack',
      transfer_ref: `mock_fuel_${crypto.randomUUID().slice(0, 8)}`, status: 'completed', created_at: now,
    };
    db.prepare(
      'INSERT INTO payouts (id, booking_id, vendor_id, amount_ngn, penalty_ngn, provider, transfer_ref, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(payout.id, payout.booking_id, payout.vendor_id, payout.amount_ngn, pen, payout.provider, payout.transfer_ref, 'completed', now);
  }
  db.prepare(
    'INSERT INTO cancellations (id, booking_id, cancelled_by, reason_code, vendor_at_fault, penalty_ngn, refund_ngn, gateway_reversal_ref, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(crypto.randomUUID(), booking.id, cancelledBy, reasonCode, vendorAtFault ? 1 : 0, pen, refund, reversalRef, now);
  db.prepare('UPDATE bookings SET status=?, cancel_reason=?, updated_at=? WHERE id=?').run('cancelled', reasonCode, now, booking.id);
  recordHistory(booking.id, booking.status, 'cancelled', cancelledBy, null, null);
  return { penalty_ngn: pen, refund_ngn: refund, payout, reversal_ref: reversalRef };
}

app.post('/api/v1/bookings/:id/cancel', auth, (req: any, res) => {
  const row = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id) as any;
  if (!row) return res.status(404).json({ error: 'booking not found' });
  if (row.customer_id !== req.user.sub) return res.status(403).json({ error: 'not your booking' });
  if (['completed', 'cancelled', 'disputed'].includes(row.status))
    return res.status(409).json({ error: `booking already ${row.status}` });
  const reason = String(req.body?.reason ?? 'customer_change_mind');
  const now = new Date().toISOString();
  // Pre-payment: no money moves (Phase 2 path preserved).
  if (row.status === 'awaiting_payment') {
    db.prepare(
      'INSERT INTO cancellations (id, booking_id, cancelled_by, reason_code, vendor_at_fault, penalty_ngn, refund_ngn, gateway_reversal_ref, created_at) VALUES (?, ?, ?, ?, 0, 0, 0, NULL, ?)'
    ).run(crypto.randomUUID(), row.id, req.user.sub, reason, now);
    db.prepare('UPDATE bookings SET status=?, cancel_reason=?, updated_at=? WHERE id=?').run('cancelled', reason, now, row.id);
    recordHistory(row.id, row.status, 'cancelled', req.user.sub, null, null);
    return res.json({ ok: true, status: 'cancelled', penalty_ngn: 0, refund_ngn: 0 });
  }
  // Post-payment active window only.
  if (!['searching_vendor', 'offered', 'accepted', 'en_route', 'arrived', 'loading', 'adjustment_pending'].includes(row.status))
    return res.status(409).json({ error: `cannot cancel from ${row.status}` });
  if (VENDOR_FAULT_CODES.includes(reason)) {
    const mins = minutesSince(row.id, 'accepted');
    const s = settleCancel(row, req.user.sub, reason, true, 0);
    return res.json({ ok: true, status: 'cancelled', vendor_at_fault: true, minutes_since_accept: mins, ...s });
  }
  if (CUSTOMER_FAULT_CODES.includes(reason)) {
    // Grace: change-mind within 5 min of accept → no penalty.
    if (reason === 'customer_change_mind') {
      const mins = minutesSince(row.id, 'accepted');
      if (mins !== null && mins <= 5) {
        const s = settleCancel(row, req.user.sub, reason, false, 0);
        return res.json({ ok: true, status: 'cancelled', vendor_at_fault: false, grace: true, ...s });
      }
    }
    const s = settleCancel(row, req.user.sub, reason, false, FUEL_PENALTY_NGN);
    return res.json({ ok: true, status: 'cancelled', vendor_at_fault: false, ...s });
  }
  return res.status(400).json({ error: `reason must be ${[...VENDOR_FAULT_CODES, ...CUSTOMER_FAULT_CODES].join('|')} (or cancel pre-payment)` });
});

// Vendor flags customer absent: arrived + waited 7 min + 3 calls → customer-fault cancel.
app.post('/api/v1/vendor/jobs/:id/no-show', auth, (req: any, res) => {
  if (req.user.role !== 'vendor') return res.status(403).json({ error: 'vendor role required' });
  const r = requireBookingVendor(req.params.id, req.user.sub) as any;
  if (r.error) return res.status(r.status).json({ error: r.error });
  if (r.booking.status !== 'arrived') return res.status(409).json({ error: `must be arrived, is ${r.booking.status}` });
  const { calls_made, waited_secs } = req.body ?? {};
  if (Number(calls_made) < 3) return res.status(400).json({ error: 'calls_made must be >= 3' });
  if (Number(waited_secs) < 7 * 60) return res.status(400).json({ error: 'waited_secs must be >= 420 (7 min)' });
  // Fraud guardrail (Phase 5): max 3 no-show flags per vendor per day.
  const today = new Date().toISOString().slice(0, 10);
  const flags = (db.prepare("SELECT COUNT(*) as c FROM cancellations WHERE cancelled_by=? AND reason_code='customer_absent' AND substr(created_at,1,10)=?").get(req.user.sub, today) as any).c as number;
  if (flags >= 3) return res.status(429).json({ error: 'no-show flag limit: max 3 per day' });
  const s = settleCancel(r.booking, req.user.sub, 'customer_absent', false, FUEL_PENALTY_NGN);
  res.json({ ok: true, status: 'cancelled', ...s });
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
  recordHistory(req.params.id, 'awaiting_payment', 'searching_vendor', req.user.sub, null, null);
  createOffer(req.params.id);
  const updated = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  res.status(201).json({ payment, booking: serializeBooking(updated) });
});

// --- Matching: rolling 60s offer queue (Phase 3 mock; Redis/BullMQ in staging) ---
const OFFER_TTL_SEC = Number(process.env.OFFER_TTL_SEC ?? 60);
function recordHistory(bookingId: string, from: string, to: string, actorId: string, lat: number | null, lng: number | null) {
  db.prepare(
    'INSERT INTO job_status_history (id, booking_id, from_status, to_status, actor_id, lat, lng, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(crypto.randomUUID(), bookingId, from, to, actorId, lat, lng, new Date().toISOString());
}
function eligibleVendors() {
  // Least-busy first (fewest offers received), newest tie-break — fair + deterministic.
  return db.prepare(
    `SELECT u.id FROM users u JOIN vendor_profiles p ON p.user_id = u.id
     LEFT JOIN job_offers o ON o.vendor_id = u.id
     WHERE u.role='vendor' AND u.active=1 AND p.approved_status='approved' AND p.blocked=0
     GROUP BY u.id ORDER BY COUNT(o.id) ASC, u.created_at DESC`
  ).all() as any[];
}
function pendingOffer(bookingId: string) {
  expireDueOffers();
  return db.prepare(
    "SELECT * FROM job_offers WHERE booking_id=? AND status='pending' AND expires_at > ? ORDER BY attempt_no DESC LIMIT 1"
  ).get(bookingId, new Date().toISOString()) as any;
}
function createOffer(bookingId: string) {
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId) as any;
  if (!booking || !['searching_vendor', 'offered'].includes(booking.status)) return null;
  if (pendingOffer(bookingId)) return null;
  const vendors = eligibleVendors();
  if (vendors.length === 0) return null;
  const attempt = ((db.prepare('SELECT COUNT(*) as c FROM job_offers WHERE booking_id=?').get(bookingId) as any).c as number) + 1;
  if (attempt > 10) return null;
  const vendor = vendors[(attempt - 1) % vendors.length];
  const now = new Date();
  const offer = {
    id: crypto.randomUUID(), booking_id: bookingId, vendor_id: vendor.id,
    expires_at: new Date(now.getTime() + OFFER_TTL_SEC * 1000).toISOString(),
    status: 'pending', attempt_no: attempt, created_at: now.toISOString(),
  };
  db.prepare(
    'INSERT INTO job_offers (id, booking_id, vendor_id, expires_at, status, attempt_no, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(offer.id, offer.booking_id, offer.vendor_id, offer.expires_at, offer.status, offer.attempt_no, offer.created_at);
  if (booking.status === 'searching_vendor') {
    db.prepare('UPDATE bookings SET status=?, updated_at=? WHERE id=?').run('offered', now.toISOString(), bookingId);
    recordHistory(bookingId, 'searching_vendor', 'offered', vendor.id, null, null);
  }
  return offer;
}
function expireDueOffers() {
  const now = new Date().toISOString();
  const due = db.prepare("SELECT * FROM job_offers WHERE status='pending' AND expires_at <= ?").all(now) as any[];
  for (const o of due) {
    db.prepare("UPDATE job_offers SET status='expired' WHERE id=?").run(o.id);
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(o.booking_id) as any;
    if (booking && ['offered', 'searching_vendor'].includes(booking.status)) createOffer(o.booking_id);
  }
  return due.length;
}

app.get('/api/v1/vendor/jobs/offers', auth, (req: any, res) => {
  if (req.user.role !== 'vendor') return res.status(403).json({ error: 'vendor role required' });
  expireDueOffers();
  const offers = db.prepare(
    "SELECT * FROM job_offers WHERE vendor_id=? AND status='pending' AND expires_at > ? ORDER BY created_at DESC"
  ).all(req.user.sub, new Date().toISOString()) as any[];
  const enriched = offers.map((o: any) => {
    const b = db.prepare('SELECT * FROM bookings WHERE id = ?').get(o.booking_id) as any;
    return { offer: o, booking: b ? serializeBooking(b) : null, payout_ngn: b?.total_price ?? null };
  });
  res.json({ offers: enriched });
});

app.post('/api/v1/vendor/offers/:id/accept', auth, (req: any, res) => {
  if (req.user.role !== 'vendor') return res.status(403).json({ error: 'vendor role required' });
  expireDueOffers();
  const offer = db.prepare('SELECT * FROM job_offers WHERE id = ?').get(req.params.id) as any;
  if (!offer) return res.status(404).json({ error: 'offer not found' });
  if (offer.vendor_id !== req.user.sub) return res.status(403).json({ error: 'not your offer' });
  if (offer.status !== 'pending' || new Date(offer.expires_at).getTime() <= Date.now())
    return res.status(409).json({ error: 'offer expired' });
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(offer.booking_id) as any;
  if (!booking || !['offered', 'searching_vendor'].includes(booking.status))
    return res.status(409).json({ error: `booking already ${booking?.status}` });
  const now = new Date().toISOString();
  db.prepare("UPDATE job_offers SET status='accepted' WHERE id=?").run(offer.id);
  db.prepare("UPDATE job_offers SET status='expired' WHERE booking_id=? AND status='pending' AND id != ?").run(offer.booking_id, offer.id);
  db.prepare('UPDATE bookings SET status=?, vendor_id=?, updated_at=? WHERE id=?').run('accepted', req.user.sub, now, offer.booking_id);
  recordHistory(offer.booking_id, booking.status, 'accepted', req.user.sub, null, null);
  res.json({ ok: true, booking_id: offer.booking_id, status: 'accepted' });
});

app.post('/api/v1/vendor/offers/:id/decline', auth, (req: any, res) => {
  if (req.user.role !== 'vendor') return res.status(403).json({ error: 'vendor role required' });
  const offer = db.prepare('SELECT * FROM job_offers WHERE id = ?').get(req.params.id) as any;
  if (!offer) return res.status(404).json({ error: 'offer not found' });
  if (offer.vendor_id !== req.user.sub) return res.status(403).json({ error: 'not your offer' });
  if (offer.status !== 'pending') return res.status(409).json({ error: `offer already ${offer.status}` });
  db.prepare("UPDATE job_offers SET status='declined' WHERE id=?").run(offer.id);
  const next = createOffer(offer.booking_id);
  res.json({ ok: true, status: 'declined', next_offer: next });
});

// Test/admin hook: expire pending offers now and roll to next vendor.
app.post('/api/v1/admin/matching/expire-due', auth, requireAdmin, (_req: any, res) => {
  const n = expireDueOffers();
  res.json({ ok: true, expired: n });
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

// --- Transit milestones (Phase 3; complete/split lands in Phase 4) ---
const ACTIVE_TRACKING = ['accepted', 'en_route', 'arrived', 'loading', 'adjustment_pending'];
function transitionBooking(bookingId: string, from: string, to: string, actorId: string, lat: number | null, lng: number | null) {
  const now = new Date().toISOString();
  db.prepare('UPDATE bookings SET status=?, updated_at=? WHERE id=?').run(to, now, bookingId);
  recordHistory(bookingId, from, to, actorId, lat, lng);
}
function requireBookingVendor(bookingId: string, vendorId: string) {
  const b = db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId) as any;
  if (!b) return { error: 'booking not found', status: 404 as const };
  if (b.vendor_id !== vendorId) return { error: 'not your job', status: 403 as const };
  return { booking: b };
}

app.post('/api/v1/vendor/jobs/:id/en-route', auth, (req: any, res) => {
  if (req.user.role !== 'vendor') return res.status(403).json({ error: 'vendor role required' });
  const r = requireBookingVendor(req.params.id, req.user.sub) as any;
  if (r.error) return res.status(r.status).json({ error: r.error });
  if (r.booking.status !== 'accepted') return res.status(409).json({ error: `must be accepted, is ${r.booking.status}` });
  const lat = req.body?.lat != null ? Number(req.body.lat) : null;
  const lng = req.body?.lng != null ? Number(req.body.lng) : null;
  transitionBooking(req.params.id, 'accepted', 'en_route', req.user.sub, lat, lng);
  res.json({ ok: true, status: 'en_route' });
});

app.post('/api/v1/vendor/jobs/:id/arrived', auth, (req: any, res) => {
  if (req.user.role !== 'vendor') return res.status(403).json({ error: 'vendor role required' });
  const r = requireBookingVendor(req.params.id, req.user.sub) as any;
  if (r.error) return res.status(r.status).json({ error: r.error });
  if (r.booking.status !== 'en_route') return res.status(409).json({ error: `must be en_route, is ${r.booking.status}` });
  const now = new Date().toISOString();
  const lat = req.body?.lat != null ? Number(req.body.lat) : null;
  const lng = req.body?.lng != null ? Number(req.body.lng) : null;
  db.prepare('UPDATE bookings SET arrived_at=?, updated_at=? WHERE id=?').run(now, now, req.params.id);
  transitionBooking(req.params.id, 'en_route', 'arrived', req.user.sub, lat, lng);
  res.json({ ok: true, status: 'arrived', arrived_at: now, wait_secs: 7 * 60 });
});

app.post('/api/v1/vendor/jobs/:id/loading', auth, (req: any, res) => {
  if (req.user.role !== 'vendor') return res.status(403).json({ error: 'vendor role required' });
  const r = requireBookingVendor(req.params.id, req.user.sub) as any;
  if (r.error) return res.status(r.status).json({ error: r.error });
  if (r.booking.status !== 'arrived') return res.status(409).json({ error: `must be arrived, is ${r.booking.status}` });
  transitionBooking(req.params.id, 'arrived', 'loading', req.user.sub, null, null);
  res.json({ ok: true, status: 'loading' });
});

// --- Completion + mock split transfer (Phase 4; licensed provider in prod) ---
app.post('/api/v1/vendor/jobs/:id/complete', auth, (req: any, res) => {
  if (req.user.role !== 'vendor') return res.status(403).json({ error: 'vendor role required' });
  const r = requireBookingVendor(req.params.id, req.user.sub) as any;
  if (r.error) return res.status(r.status).json({ error: r.error });
  if (r.booking.status === 'completed') {
    const payout = db.prepare('SELECT * FROM payouts WHERE booking_id = ?').get(req.params.id);
    return res.json({ ok: true, status: 'completed', payout, idempotent: true });
  }
  if (!['arrived', 'loading'].includes(r.booking.status))
    return res.status(409).json({ error: `complete allowed from arrived|loading, is ${r.booking.status}` });
  const payment = db.prepare('SELECT * FROM payments WHERE booking_id = ?').get(req.params.id) as any;
  if (!payment || payment.status !== 'held')
    return res.status(409).json({ error: 'no held payment to split' });
  const now = new Date().toISOString();
  const payout = {
    id: crypto.randomUUID(), booking_id: req.params.id, vendor_id: req.user.sub,
    amount_ngn: r.booking.total_price, penalty_ngn: 0, provider: payment.provider,
    transfer_ref: `mock_transfer_${crypto.randomUUID().slice(0, 8)}`,
    status: 'completed', created_at: now,
  };
  db.prepare(
    'INSERT INTO payouts (id, booking_id, vendor_id, amount_ngn, penalty_ngn, provider, transfer_ref, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(payout.id, payout.booking_id, payout.vendor_id, payout.amount_ngn, 0, payout.provider, payout.transfer_ref, 'completed', now);
  db.prepare('UPDATE payments SET status=?, updated_at=? WHERE booking_id=?').run('split', now, req.params.id);
  transitionBooking(req.params.id, r.booking.status, 'completed', req.user.sub,
    req.body?.lat != null ? Number(req.body.lat) : null,
    req.body?.lng != null ? Number(req.body.lng) : null);
  res.json({
    ok: true, status: 'completed',
    receipt: {
      booking_id: req.params.id, total_ngn: r.booking.total_price,
      vendor_payout_ngn: payout.amount_ngn, transfer_ref: payout.transfer_ref,
      completed_at: now, currency: 'NGN',
    },
  });
});

// --- Adjust-quote (Phase 3, no cap; cancel-on-reject lands in Phase 4) ---
app.post('/api/v1/vendor/jobs/:id/adjust-quote', auth, (req: any, res) => {
  if (req.user.role !== 'vendor') return res.status(403).json({ error: 'vendor role required' });
  const r = requireBookingVendor(req.params.id, req.user.sub) as any;
  if (r.error) return res.status(r.status).json({ error: r.error });
  if (!['arrived', 'loading'].includes(r.booking.status))
    return res.status(409).json({ error: `adjust-quote allowed in arrived|loading, is ${r.booking.status}` });
  const { new_total, reason, photo_key } = req.body ?? {};
  const nt = Number(new_total);
  if (!Number.isInteger(nt) || nt <= 0) return res.status(400).json({ error: 'new_total must be int > 0' });
  // Fraud guardrail (Phase 5): adjustments capped at 2x original total.
  if (nt > 2 * r.booking.total_price)
    return res.status(422).json({ error: `new_total capped at 2x original (${2 * r.booking.total_price} NGN)` });
  if (!reason || typeof reason !== 'string') return res.status(400).json({ error: 'reason required' });
  const existing = db.prepare("SELECT * FROM quote_adjustments WHERE booking_id=? AND status='pending'").get(req.params.id) as any;
  if (existing) return res.status(409).json({ error: 'adjustment already pending' });
  const now = new Date().toISOString();
  const adj = {
    id: crypto.randomUUID(), booking_id: req.params.id, vendor_id: req.user.sub,
    old_total: r.booking.total_price, new_total: nt, reason: String(reason),
    photo_key: photo_key ?? null, status: 'pending', decided_at: null, created_at: now,
  };
  db.prepare(
    'INSERT INTO quote_adjustments (id, booking_id, vendor_id, old_total, new_total, reason, photo_key, status, decided_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(adj.id, adj.booking_id, adj.vendor_id, adj.old_total, adj.new_total, adj.reason, adj.photo_key, adj.status, adj.decided_at, adj.created_at);
  transitionBooking(req.params.id, r.booking.status, 'adjustment_pending', req.user.sub, null, null);
  res.status(201).json({ adjustment: adj });
});

app.post('/api/v1/bookings/:id/adjustments/:adjId/approve', auth, (req: any, res) => {
  if (req.user.role !== 'customer') return res.status(403).json({ error: 'customer role required' });
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id) as any;
  if (!booking) return res.status(404).json({ error: 'booking not found' });
  if (booking.customer_id !== req.user.sub) return res.status(403).json({ error: 'not your booking' });
  const adj = db.prepare('SELECT * FROM quote_adjustments WHERE id = ?').get(req.params.adjId) as any;
  if (!adj || adj.booking_id !== req.params.id) return res.status(404).json({ error: 'adjustment not found' });
  if (adj.status !== 'pending') return res.status(409).json({ error: `adjustment already ${adj.status}` });
  const now = new Date().toISOString();
  db.prepare("UPDATE quote_adjustments SET status='approved', decided_at=? WHERE id=?").run(now, adj.id);
  db.prepare('UPDATE bookings SET total_price=?, updated_at=? WHERE id=?').run(adj.new_total, now, req.params.id);
  db.prepare('UPDATE payments SET amount_ngn=?, gateway_ref=?, updated_at=? WHERE booking_id=?').run(
    adj.new_total, `mock_rehold_adj_${adj.id.slice(0, 8)}`, now, req.params.id);
  transitionBooking(req.params.id, 'adjustment_pending', 'loading', req.user.sub, null, null);
  res.json({ ok: true, status: 'loading', new_total: adj.new_total });
});

app.post('/api/v1/bookings/:id/adjustments/:adjId/reject', auth, (req: any, res) => {
  if (req.user.role !== 'customer') return res.status(403).json({ error: 'customer role required' });
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id) as any;
  if (!booking) return res.status(404).json({ error: 'booking not found' });
  if (booking.customer_id !== req.user.sub) return res.status(403).json({ error: 'not your booking' });
  const adj = db.prepare('SELECT * FROM quote_adjustments WHERE id = ?').get(req.params.adjId) as any;
  if (!adj || adj.booking_id !== req.params.id) return res.status(404).json({ error: 'adjustment not found' });
  if (adj.status !== 'pending') return res.status(409).json({ error: `adjustment already ${adj.status}` });
  const now = new Date().toISOString();
  db.prepare("UPDATE quote_adjustments SET status='rejected', decided_at=? WHERE id=?").run(now, adj.id);
  transitionBooking(req.params.id, 'adjustment_pending', 'arrived', req.user.sub, null, null);
  res.json({ ok: true, status: 'arrived', note: 'cancel with reason adjustment_rejected to apply ₦3,000 fuel fee' });
});

// --- Heartbeat tracking (Phase 3 mock; window-only, no 30s reject) ---
app.post('/api/v1/tracking/ping', auth, (req: any, res) => {
  if (req.user.role !== 'vendor') return res.status(403).json({ error: 'vendor role required' });
  const { booking_id, lat, lng, accuracy } = req.body ?? {};
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(String(booking_id)) as any;
  if (!booking) return res.status(404).json({ error: 'booking not found' });
  if (booking.vendor_id !== req.user.sub) return res.status(403).json({ error: 'not your job' });
  if (!ACTIVE_TRACKING.includes(booking.status))
    return res.status(409).json({ error: `tracking closed (status ${booking.status})` });
  const la = Number(lat); const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return res.status(400).json({ error: 'lat + lng required' });
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO location_pings (id, booking_id, vendor_id, lat, lng, accuracy, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(crypto.randomUUID(), String(booking_id), req.user.sub, la, ln, accuracy != null ? Number(accuracy) : null, now);
  res.json({ ok: true, recorded_at: now });
});

function lastPing(bookingId: string) {
  return db.prepare('SELECT lat, lng, recorded_at FROM location_pings WHERE booking_id=? ORDER BY recorded_at DESC LIMIT 1').get(bookingId) as any;
}

app.get('/api/v1/bookings/:id/location', auth, (req: any, res) => {
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id) as any;
  if (!booking) return res.status(404).json({ error: 'booking not found' });
  if (req.user.role === 'customer') {
    if (booking.customer_id !== req.user.sub) return res.status(403).json({ error: 'not your booking' });
    if (booking.status !== 'en_route') return res.status(403).json({ error: 'location visible only while en_route' });
  } else if (req.user.role === 'vendor') {
    if (booking.vendor_id !== req.user.sub) return res.status(403).json({ error: 'not your job' });
  } else if (req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  if (req.user.role === 'admin' && !ACTIVE_TRACKING.includes(booking.status))
    return res.status(403).json({ error: 'tracking closed' });
  res.json({ last: lastPing(req.params.id) ?? null, status: booking.status });
});

// --- Admin: active jobs map stub (Phase 1; live tracking lands in Phase 3) ---
app.get('/api/v1/admin/jobs/active', auth, requireAdmin, (_req: any, res) => {
  const rows = db.prepare(
    `SELECT id as booking_id, vendor_id, status FROM bookings WHERE status IN ('accepted','en_route','arrived','loading','adjustment_pending') ORDER BY updated_at DESC LIMIT 100`
  ).all() as any[];
  res.json({
    jobs: rows.map((r: any) => {
      const lp = lastPing(r.booking_id) as any;
      return { ...r, last_lat: lp?.lat ?? null, last_lng: lp?.lng ?? null, last_at: lp?.recorded_at ?? null };
    }),
  });
});

// --- Dispute center (Phase 4 mock; photos/pings/adjustments timeline) ---
app.post('/api/v1/disputes', auth, (req: any, res) => {
  if (!['customer', 'vendor'].includes(req.user.role)) return res.status(403).json({ error: 'customer/vendor only' });
  const { booking_id, category, notes } = req.body ?? {};
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(String(booking_id)) as any;
  if (!booking) return res.status(404).json({ error: 'booking not found' });
  const involved = booking.customer_id === req.user.sub || booking.vendor_id === req.user.sub;
  if (!involved) return res.status(403).json({ error: 'not your booking' });
  if (!['completed', 'cancelled'].includes(booking.status))
    return res.status(409).json({ error: `disputes allowed on completed|cancelled, is ${booking.status}` });
  if (!category || typeof category !== 'string') return res.status(400).json({ error: 'category required' });
  const now = new Date().toISOString();
  const d = {
    id: crypto.randomUUID(), booking_id: String(booking_id), raised_by: req.user.sub,
    category: String(category), notes: notes ?? null, status: 'open',
    resolution: null, created_at: now, resolved_at: null,
  };
  db.prepare(
    'INSERT INTO disputes (id, booking_id, raised_by, category, notes, status, resolution, created_at, resolved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(d.id, d.booking_id, d.raised_by, d.category, d.notes, d.status, d.resolution, d.created_at, d.resolved_at);
  res.status(201).json({ dispute: d });
});

app.get('/api/v1/disputes/mine', auth, (req: any, res) => {
  if (!['customer', 'vendor'].includes(req.user.role)) return res.status(403).json({ error: 'customer/vendor only' });
  res.json({ disputes: db.prepare('SELECT * FROM disputes WHERE raised_by=? ORDER BY created_at DESC').all(req.user.sub) });
});

app.get('/api/v1/admin/disputes', auth, requireAdmin, (req: any, res) => {
  const status = req.query.status ? String(req.query.status) : 'open';
  const rows = (status === 'all'
    ? db.prepare('SELECT * FROM disputes ORDER BY created_at DESC').all()
    : db.prepare('SELECT * FROM disputes WHERE status=? ORDER BY created_at DESC').all(status)) as any[];
  res.json({ disputes: rows });
});

app.get('/api/v1/admin/jobs/:id/timeline', auth, requireAdmin, (req: any, res) => {
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id) as any;
  if (!booking) return res.status(404).json({ error: 'booking not found' });
  res.json({
    booking: serializeBooking(booking),
    history: db.prepare('SELECT * FROM job_status_history WHERE booking_id=? ORDER BY at ASC').all(req.params.id),
    pings: db.prepare('SELECT lat, lng, accuracy, recorded_at FROM location_pings WHERE booking_id=? ORDER BY recorded_at ASC').all(req.params.id),
    adjustments: db.prepare('SELECT * FROM quote_adjustments WHERE booking_id=? ORDER BY created_at ASC').all(req.params.id),
    payment: db.prepare('SELECT * FROM payments WHERE booking_id = ?').get(req.params.id) ?? null,
    payout: db.prepare('SELECT * FROM payouts WHERE booking_id = ?').get(req.params.id) ?? null,
    cancellation: db.prepare('SELECT * FROM cancellations WHERE booking_id = ?').get(req.params.id) ?? null,
    disputes: db.prepare('SELECT * FROM disputes WHERE booking_id=? ORDER BY created_at ASC').all(req.params.id),
  });
});

app.post('/api/v1/admin/disputes/:id/resolve', auth, requireAdmin, (req: any, res) => {
  const { action, penalty_ngn, note } = req.body ?? {};
  if (!['refund_vendor', 'refund_customer', 'split'].includes(action))
    return res.status(400).json({ error: 'action must be refund_vendor|refund_customer|split' });
  const d = db.prepare('SELECT * FROM disputes WHERE id = ?').get(req.params.id) as any;
  if (!d) return res.status(404).json({ error: 'dispute not found' });
  if (d.status !== 'open') return res.status(409).json({ error: `dispute already ${d.status}` });
  const now = new Date().toISOString();
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(d.booking_id) as any;
  const payment = db.prepare('SELECT * FROM payments WHERE booking_id = ?').get(d.booking_id) as any;
  const pen = Math.max(0, Number(penalty_ngn ?? 0) || 0);
  // Money moves only if escrow still held; settled jobs get record-only resolution + audit.
  let money: any = { moved: false };
  if (payment && payment.status === 'held' && booking) {
    if (action === 'refund_customer') {
      db.prepare('UPDATE payments SET status=?, updated_at=? WHERE booking_id=?').run('refunded', now, d.booking_id);
      money = { moved: true, refund_ngn: payment.amount_ngn };
    } else if (action === 'refund_vendor' && booking.vendor_id) {
      const payout = {
        id: crypto.randomUUID(), booking_id: d.booking_id, vendor_id: booking.vendor_id,
        amount_ngn: payment.amount_ngn, penalty_ngn: 0, provider: payment.provider,
        transfer_ref: `mock_dispute_${crypto.randomUUID().slice(0, 8)}`, status: 'completed', created_at: now,
      };
      db.prepare(
        'INSERT INTO payouts (id, booking_id, vendor_id, amount_ngn, penalty_ngn, provider, transfer_ref, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(payout.id, payout.booking_id, payout.vendor_id, payout.amount_ngn, 0, payout.provider, payout.transfer_ref, 'completed', now);
      db.prepare('UPDATE payments SET status=?, updated_at=? WHERE booking_id=?').run('split', now, d.booking_id);
      money = { moved: true, vendor_payout_ngn: payout.amount_ngn };
    } else if (action === 'split' && booking.vendor_id) {
      const vendorShare = Math.min(pen > 0 ? pen : FUEL_PENALTY_NGN, payment.amount_ngn);
      money = { moved: true, vendor_payout_ngn: vendorShare, refund_ngn: payment.amount_ngn - vendorShare };
      db.prepare('UPDATE payments SET status=?, updated_at=? WHERE booking_id=?').run('partial_refund', now, d.booking_id);
    }
  }
  const resolution = JSON.stringify({ action, penalty_ngn: pen, note: note ?? null, money });
  db.prepare("UPDATE disputes SET status='resolved', resolution=?, resolved_at=? WHERE id=?").run(resolution, now, req.params.id);
  if (booking && booking.status !== 'disputed') {
    db.prepare('UPDATE bookings SET status=?, updated_at=? WHERE id=?').run('disputed', now, d.booking_id);
    recordHistory(d.booking_id, booking.status, 'disputed', req.user.sub, null, null);
  }
  audit(req.user.sub, 'dispute.resolve', 'dispute', req.params.id, { action, penalty_ngn: pen });
  res.json({ ok: true, status: 'resolved', money });
});

// --- Vendor earnings (Phase 4 mock transfers) ---
app.get('/api/v1/vendor/earnings', auth, (req: any, res) => {
  if (req.user.role !== 'vendor') return res.status(403).json({ error: 'vendor role required' });
  const transfers = db.prepare('SELECT * FROM payouts WHERE vendor_id=? ORDER BY created_at DESC').all(req.user.sub) as any[];
  const completed = transfers.filter((t) => t.status === 'completed').reduce((s: number, t: any) => s + t.amount_ngn, 0);
  const active = (db.prepare("SELECT COUNT(*) as c FROM bookings WHERE vendor_id=? AND status IN ('accepted','en_route','arrived','loading','adjustment_pending')").get(req.user.sub) as any).c;
  res.json({ completed_payout_ngn: completed, currency: 'NGN', transfers, active_jobs: active });
});

// --- Pilot waitlist: outside-pilot LGAs join the queue instead of booking ---
app.post('/api/v1/waitlist', (req, res) => {
  const { lga, phone } = req.body ?? {};
  if (!lga || typeof lga !== 'string') return res.status(400).json({ error: 'lga required' });
  const clean = String(phone ?? '').replace(/\s/g, '');
  if (!/^\+?[0-9]{7,15}$/.test(clean)) return res.status(400).json({ error: 'invalid phone format' });
  const pilot = (dbLGAs() as any[]).some((l) => String(l.name).toLowerCase() === String(lga).toLowerCase());
  if (pilot) return res.status(400).json({ error: 'pilot already covers this LGA — book directly' });
  const now = new Date().toISOString();
  const entry = { id: crypto.randomUUID(), lga: String(lga), phone: clean, created_at: now };
  db.prepare('INSERT INTO waitlist (id, lga, phone, created_at) VALUES (?, ?, ?, ?)').run(entry.id, entry.lga, entry.phone, now);
  res.status(201).json({ waitlist: entry, note: 'pilot covers Eti-Osa + Ikeja only for now' });
});

app.get('/api/v1/admin/waitlist', auth, requireAdmin, (_req: any, res) => {
  res.json({ waitlist: db.prepare('SELECT * FROM waitlist ORDER BY created_at DESC LIMIT 200').all() });
});

// --- Ops readiness: counts + mocked-gateway reconciliation (endpoints only, no SDKs) ---
app.get('/api/v1/admin/ops', auth, requireAdmin, (_req: any, res) => {
  const q = (sql: string) => db.prepare(sql).all() as any[];
  const bookingsByStatus = q('SELECT status, COUNT(*) as n FROM bookings GROUP BY status');
  const paymentsByStatus = q('SELECT status, COUNT(*) as n FROM payments GROUP BY status');
  const held = q("SELECT booking_id, amount_ngn FROM payments WHERE status='held'");
  const mismatches: any[] = [];
  for (const p of held) {
    const b = db.prepare('SELECT status FROM bookings WHERE id=?').get(p.booking_id) as any;
    if (!b || !['searching_vendor', 'offered', 'accepted', 'en_route', 'arrived', 'loading', 'adjustment_pending'].includes(b.status))
      mismatches.push({ booking_id: p.booking_id, issue: 'held payment on inactive booking', status: b?.status ?? 'missing' });
  }
  const splits = q("SELECT booking_id FROM payments WHERE status='split'");
  for (const s of splits) {
    const po = db.prepare('SELECT id FROM payouts WHERE booking_id=?').get(s.booking_id);
    if (!po) mismatches.push({ booking_id: s.booking_id, issue: 'split payment without payout record' });
  }
  res.json({
    bookings_by_status: bookingsByStatus,
    payments_by_status: paymentsByStatus,
    open_disputes: (db.prepare("SELECT COUNT(*) as c FROM disputes WHERE status='open'").get() as any).c,
    waitlist_size: (db.prepare('SELECT COUNT(*) as c FROM waitlist').get() as any).c,
    reconciliation: { mismatches, ok: mismatches.length === 0 },
    heartbeat: { min_sec: 30, max_sec: 60 },
  });
});

// --- Admin overview ---
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
  app.listen(PORT, () => console.log(`[api] Phase 5 listening on :${PORT}`));
}
// Add temporary verification route for testing Paystack
app.post('/api/v1/payments/initialize', async (req, res) => {
  const { email, amount } = req.body;
  
  if (!email || !amount) {
    return res.status(400).json({ error: 'Missing email or amount parameters.' });
  }

try {
  const result = await initializeTransaction(email, Number(amount));
  return res.status(200).json(result);
} catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});
