process.env.JWT_SECRET = 'test-secret-min-32-chars-xxxxxxxx';
process.env.OTP_MODE = 'mock';
import { app } from './index.js';

const base = 'http://127.0.0.1:4103';
const server = app.listen(4103, async () => {
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

    const cphone = '+234720000' + String(Math.floor(Math.random() * 9000) + 1000);
    const oo: any = await post('/api/v1/auth/request-otp', { phone: cphone });
    const vv: any = await post('/api/v1/auth/verify-otp', { phone: cphone, code: oo.j._devCode, role: 'customer' });
    assert(!!vv.j.access_token, 'customer otp login');
    const tok: string = vv.j.access_token;

    // validation: photo required
    const noPhoto = await post('/api/v1/bookings', {
      category_slug: 'bagged', qty: 2, lga: 'Ikeja',
      pickup_lat: 6.45, pickup_lng: 3.39, pickup_address: 'A', photo_keys: [],
    }, tok);
    assert(noPhoto.status === 400, 'photo required (1..5)');

    // validation: pilot gate
    const outside = await post('/api/v1/bookings', {
      category_slug: 'bagged', qty: 2, lga: 'Surulere',
      pickup_lat: 6.45, pickup_lng: 3.39, pickup_address: 'A', photo_keys: ['k1'],
    }, tok);
    assert(outside.status === 400, 'outside pilot LGA rejected');

    // create booking
    const created = await post('/api/v1/bookings', {
      category_slug: 'bagged', qty: 2, lga: 'Ikeja',
      pickup_lat: 6.45, pickup_lng: 3.39, pickup_address: 'Lekki Phase 1', photo_keys: ['waste_photo/k1'],
    }, tok);
    assert(created.status === 201 && created.j.booking.status === 'awaiting_payment', 'booking created awaiting_payment');
    // bagged 1500*2 + Ikeja 3500 = 6500
    assert(created.j.booking.total_price === 6500, `server pricing snapshot 6500 (got ${created.j.booking.total_price})`);
    const bid: string = created.j.booking.id;

    // cash blocked
    const cash = await post(`/api/v1/bookings/${bid}/authorize-payment`, { provider: 'cash' }, tok);
    assert(cash.status === 400, 'cash payments blocked');

    // authorize (mock hold) → exit criteria
    const pay = await post(`/api/v1/bookings/${bid}/authorize-payment`, { provider: 'paystack' }, tok);
    assert(pay.status === 201 && pay.j.payment.status === 'held', 'mock hold created');
    assert(pay.j.booking.status === 'searching_vendor', 'paid booking → searching_vendor');

    // webhook idempotent
    const wh = await post('/api/v1/webhooks/paystack', { booking_id: bid, event: 'charge.success' });
    assert(wh.status === 200 && wh.j.ok === true, 'webhook idempotent ok');
    const detail = await get(`/api/v1/bookings/${bid}`, tok);
    assert(detail.j.booking.status === 'searching_vendor' && detail.j.payment.status === 'held', 'held persists after webhook');

    // pre-payment cancel path on a second booking
    const b2 = await post('/api/v1/bookings', {
      category_slug: 'recyclable', qty: 1, lga: 'Eti-Osa',
      pickup_lat: 6.45, pickup_lng: 3.39, pickup_address: 'VI', photo_keys: ['k1'],
    }, tok);
    const cancel = await post(`/api/v1/bookings/${b2.j.booking.id}/cancel`, { reason: 'changed mind' }, tok);
    assert(cancel.j.status === 'cancelled', 'pre-payment cancel works');
    const mine = await get('/api/v1/bookings/mine?status=searching_vendor', tok);
    assert(mine.j.bookings.some((b: any) => b.id === bid), 'mine filter lists paid booking');

    console.log('\nPhase 2 smoke: ALL PASS');
    server.close();
    process.exit(0);
  } catch (e) {
    console.error('PHASE2 FAIL', e);
    server.close();
    process.exit(1);
  }
});
