process.env.JWT_SECRET = 'test-secret-min-32-chars-xxxxxxxx';
process.env.OTP_MODE = 'mock';
import { app } from './index.js';
import { ensureSeedAdmin, clearOffers, TEST_ADMIN_PASSWORD } from './test-setup.js';
import { run } from './db.js';

const base = 'http://127.0.0.1:4106';
const server = app.listen(4106, async () => {
  try {
    const assert = (cond: boolean, msg: string) => {
      if (!cond) throw new Error('ASSERT: ' + msg);
      console.log('ok -', msg);
    };
    const post = (p: string, body: any, token?: string) =>
      fetch(`${base}${p}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      }).then((x) => x.json().then((j) => ({ status: x.status, j: j as any })));
    const get = (p: string, token?: string) =>
      fetch(`${base}${p}`, { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) } }).then((x) =>
        x.json().then((j) => ({ status: x.status, j: j as any }))
      );
    const del = (p: string, token?: string) =>
      fetch(`${base}${p}`, { method: 'DELETE', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) } }).then((x) =>
        x.json().then((j) => ({ status: x.status, j: j as any }))
      );
    const otpLogin = async (phone: string, role?: string) => {
      const o: any = await post('/api/v1/auth/request-otp', { phone });
      const v: any = await post('/api/v1/auth/verify-otp', { phone, code: o.j._devCode, role });
      return { token: v.j.access_token as string, id: v.j.user.id as string };
    };
    const R = () => String(Math.floor(Math.random() * 9000) + 1000);
    await ensureSeedAdmin();

    // privacy info + export
    const priv = await get('/api/v1/privacy');
    assert(priv.j.policy_version && priv.j.retention_days?.location_pings === 90, 'privacy info + retention policy');
    const c = await otpLogin('+234750000' + R(), 'customer');
    const exp = await get('/api/v1/me/export', c.token);
    assert((exp.j as any).user && Array.isArray((exp.j as any).bookings), 'export returns own data');

    // vendor setup
    const v = await otpLogin('+234751000' + R(), 'vendor');
    await post('/api/v1/vendor/onboarding', {
      business_name: 'Phase5 Trucks', vehicle: { plate_no: 'P5-001', type: 'tipper' },
      documents: { vehicle_reg: 'd1', drivers_license: 'd2', business_doc: 'd3' },
    }, v.token);
    const alogin: any = await post('/api/v1/auth/admin-login', { phone: '+2348000000001', password: TEST_ADMIN_PASSWORD });
    const a = { token: alogin.j.access_token as string, id: '' as string };
    await post(`/api/v1/admin/vendors/${v.id}/approve`, {}, a.token);

    async function arrivedBooking() {
      await clearOffers();
      const b = await post('/api/v1/bookings', {
        category_slug: 'bagged', qty: 1, lga: 'Ikeja',
        pickup_lat: 6.45, pickup_lng: 3.39, pickup_address: 'P5', photo_keys: ['waste_photo/p5'],
      }, c.token);
      const bid: string = b.j.booking.id;
      await post(`/api/v1/bookings/${bid}/authorize-payment`, { provider: 'paystack' }, c.token);
      const offers = await get('/api/v1/vendor/jobs/offers', v.token);
      const mine = (offers.j.offers as any[]).find((o) => o.booking?.id === bid);
      assert(!!mine, 'offer received');
      await post(`/api/v1/vendor/offers/${mine.offer.id}/accept`, {}, v.token);
      await post(`/api/v1/vendor/jobs/${bid}/en-route`, {}, v.token);
      await post(`/api/v1/vendor/jobs/${bid}/arrived`, {}, v.token);
      return { bid, total: b.j.booking.total_price as number };
    }

    // retention purge deletes 100-day-old ping
    let t = await arrivedBooking();
    await post('/api/v1/tracking/ping', { booking_id: t.bid, lat: 6.45, lng: 3.39 }, v.token);
    await run("UPDATE location_pings SET recorded_at=? WHERE booking_id=?",
      new Date(Date.now() - 100 * 24 * 3600 * 1000).toISOString(), t.bid);
    const purge = await post('/api/v1/admin/retention/purge', {}, a.token);
    assert(purge.j.deleted_pings >= 1, '90-day retention purge deletes old pings');

    // adjust cap: 3x rejected, 2x allowed
    t = await arrivedBooking();
    const over = await post(`/api/v1/vendor/jobs/${t.bid}/adjust-quote`, { new_total: 3 * t.total, reason: 'x' }, v.token);
    assert(over.status === 422, 'adjust capped above 2x');
    const edge = await post(`/api/v1/vendor/jobs/${t.bid}/adjust-quote`, { new_total: 2 * t.total, reason: 'x' }, v.token);
    assert(edge.status === 201, 'adjust at exactly 2x allowed');

    // no-show rate limit: 3/day ok, 4th rejected
    for (let i = 0; i < 3; i++) {
      const n = await arrivedBooking();
      const ns = await post(`/api/v1/vendor/jobs/${n.bid}/no-show`, { calls_made: 3, waited_secs: 420 }, v.token);
      assert(ns.j.status === 'cancelled', `no-show ${i + 1}/3 accepted`);
    }
    const n4 = await arrivedBooking();
    const lim = await post(`/api/v1/vendor/jobs/${n4.bid}/no-show`, { calls_made: 3, waited_secs: 420 }, v.token);
    assert(lim.status === 429, '4th no-show rejected (3/day)');

    // OTP rate limit: 5/hour ok, 6th rejected
    const p6 = '+234752000' + R();
    for (let i = 0; i < 5; i++) {
      const o: any = await post('/api/v1/auth/request-otp', { phone: p6 });
      assert(!!(o.j as any)._devCode, `otp ${i + 1}/5 sent`);
      await run('DELETE FROM otp_codes WHERE phone=?', p6);
    }
    const o6: any = await post('/api/v1/auth/request-otp', { phone: p6 });
    assert(o6.status === 429, '6th OTP rejected (5/hour)');

    // waitlist: outside pilot joins, pilot LGA bookings direct
    const w = await post('/api/v1/waitlist', { lga: 'Surulere', phone: '+2347530001111' });
    assert(w.status === 201, 'outside-pilot waitlist joins');
    const w2 = await post('/api/v1/waitlist', { lga: 'Ikeja', phone: '+2347530002222' });
    assert(w2.status === 400, 'pilot LGA books directly');

    // ops reconciliation green + heartbeat tuning
    const ops = await get('/api/v1/admin/ops', a.token);
    assert((ops.j as any).reconciliation?.ok === true, 'reconciliation green');
    assert((ops.j as any).heartbeat?.min_sec === 30, 'heartbeat 30-60s tuning');

    // delete account scrubs PII
    const bye = await del('/api/v1/me', c.token);
    assert(bye.j.ok === true, 'account deleted');
    const me = await get('/api/v1/me', c.token);
    assert(String((me.j as any).phone).startsWith('deleted_'), 'PII scrubbed');

    console.log('\nPhase 5 smoke: ALL PASS');
    server.close();
    process.exit(0);
  } catch (e) {
    console.error('PHASE5 FAIL', e);
    server.close();
    process.exit(1);
  }
});
