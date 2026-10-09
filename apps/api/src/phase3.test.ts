process.env.JWT_SECRET = 'test-secret-min-32-chars-xxxxxxxx';
process.env.OTP_MODE = 'mock';
import { app } from './index.js';
import { ensureSeedAdmin, TEST_ADMIN_PASSWORD } from './test-setup.js';

const base = 'http://127.0.0.1:4104';
const server = app.listen(4104, async () => {
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
    const otpLogin = async (phone: string, role?: string) => {
      const o: any = await post('/api/v1/auth/request-otp', { phone });
      const v: any = await post('/api/v1/auth/verify-otp', { phone, code: o.j._devCode, role });
      return v.j.access_token as string;
    };

    const ctok = await otpLogin('+234730000' + String(Math.floor(Math.random() * 9000) + 1000), 'customer');
    const vtok = await otpLogin('+234731000' + String(Math.floor(Math.random() * 9000) + 1000), 'vendor');
    const vendorId = (await get('/api/v1/me', vtok)).j.id as string;
    assert(!!ctok && !!vtok, 'customer + vendor login');

    // onboard + approve vendor
    await post('/api/v1/vendor/onboarding', {
      business_name: 'Phase3 Trucks', vehicle: { plate_no: 'P3-001', type: 'tipper' },
      documents: { vehicle_reg: 'd1', drivers_license: 'd2', business_doc: 'd3' },
    }, vtok);
    await ensureSeedAdmin();
    const atok = (await post('/api/v1/auth/admin-login', { phone: '+2348000000001', password: TEST_ADMIN_PASSWORD })).j.access_token as string;
    const ap = await post(`/api/v1/admin/vendors/${vendorId}/approve`, {}, atok);
    assert(ap.j.status === 'approved', 'vendor approved');

    // customer creates + pays
    const b = await post('/api/v1/bookings', {
      category_slug: 'bulky', qty: 1, lga: 'Ikeja',
      pickup_lat: 6.45, pickup_lng: 3.39, pickup_address: 'P3 addr', photo_keys: ['waste_photo/p3'],
    }, ctok);
    assert(b.status === 201, 'booking created');
    const bid: string = b.j.booking.id;
    const pay = await post(`/api/v1/bookings/${bid}/authorize-payment`, { provider: 'paystack' }, ctok);
    assert(pay.j.payment.status === 'held', 'held');

    // vendor offer → accept
    const offers = await get('/api/v1/vendor/jobs/offers', vtok);
    assert(Array.isArray((offers.j as any).offers), 'offers list returned');
    const mine = (offers.j.offers as any[]).find((o) => o.booking?.id === bid);
    assert(!!mine, 'rolling offer received with payout');
    assert(mine.payout_ngn === b.j.booking.total_price, 'offer shows volume + payout');
    const acc = await post(`/api/v1/vendor/offers/${mine.offer.id}/accept`, {}, vtok);
    assert(acc.j.status === 'accepted', 'offer accepted');

    // privacy: hidden before en_route
    const hidden = await get(`/api/v1/bookings/${bid}/location`, ctok);
    assert(hidden.status === 403, 'location hidden before en_route');

    // en_route → ping → visible
    const er = await post(`/api/v1/vendor/jobs/${bid}/en-route`, { lat: 6.45, lng: 3.39 }, vtok);
    assert(er.j.status === 'en_route', 'en_route');
    const ping = await post('/api/v1/tracking/ping', { booking_id: bid, lat: 6.451, lng: 3.391, accuracy: 8 }, vtok);
    assert(ping.j.ok === true, 'heartbeat ping accepted');
    const vis = await get(`/api/v1/bookings/${bid}/location`, ctok);
    assert(vis.j.last?.lat === 6.451, 'customer sees location en_route');

    // arrived (7-min timer) → adjust-quote → approve
    const arr = await post(`/api/v1/vendor/jobs/${bid}/arrived`, { lat: 6.452, lng: 3.392 }, vtok);
    assert(arr.j.status === 'arrived' && !!arr.j.arrived_at, 'arrived + timer');
    const origTotal = (await get(`/api/v1/bookings/${bid}`, ctok)).j.booking.total_price;
    const adj = await post(`/api/v1/vendor/jobs/${bid}/adjust-quote`, { new_total: origTotal + 2000, reason: 'extra pile', photo_key: 'waste_photo/extra' }, vtok);
    assert(adj.status === 201, 'adjust-quote submitted (no cap)');
    const appr = await post(`/api/v1/bookings/${bid}/adjustments/${adj.j.adjustment.id}/approve`, {}, ctok);
    assert(appr.j.new_total === origTotal + 2000 && appr.j.status === 'loading', 'approve → re-hold + loading');
    const det = await get(`/api/v1/bookings/${bid}`, ctok);
    assert(det.j.payment.amount_ngn === origTotal + 2000, 'payment re-held to new total');

    // admin live map shows job + last ping
    const active = await get('/api/v1/admin/jobs/active', atok);
    assert((active.j.jobs as any[]).some((j) => j.booking_id === bid && j.last_lat != null), 'admin live map with last ping');

    console.log('\nPhase 3 smoke: ALL PASS');
    server.close();
    process.exit(0);
  } catch (e) {
    console.error('PHASE3 FAIL', e);
    server.close();
    process.exit(1);
  }
});
