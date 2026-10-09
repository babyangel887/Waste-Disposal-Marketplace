process.env.JWT_SECRET = 'test-secret-min-32-chars-xxxxxxxx';
process.env.OTP_MODE = 'mock';
process.env.PAYSTACK_MODE = 'live';
process.env.PAYSTACK_SECRET_KEY = 'test_paystack_secret_xxxxxxxx';
process.env.PAYSTACK_BASE_URL = 'https://api.paystack.test';
import crypto from 'node:crypto';
import { app } from './index.js';

const base = 'http://127.0.0.1:4107';
const SECRET = 'test_paystack_secret_xxxxxxxx';

// Stub only Paystack network calls; everything else goes to the real fetch
// (the test client below uses global fetch to talk to the API server).
const realFetch = globalThis.fetch;
(globalThis as any).fetch = (url: any, init: any) => {
  if (typeof url === 'string' && url.startsWith('https://api.paystack.test/transaction/initialize')) {
    const body = JSON.parse(String(init?.body ?? '{}'));
    return Promise.resolve(
      new Response(
        JSON.stringify({
          status: true,
          data: { authorization_url: `https://checkout.paystack.test/${body.reference}`, reference: body.reference },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
  }
  return (realFetch as any)(url, init);
};

const server = app.listen(4107, async () => {
  try {
    const assert = (cond: boolean, msg: string) => {
      if (!cond) throw new Error('ASSERT: ' + msg);
      console.log('ok -', msg);
    };
    const post = (p: string, body: any, token?: string, extraHeaders?: Record<string, string>) =>
      fetch(`${base}${p}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(extraHeaders ?? {}) },
        body: JSON.stringify(body),
      }).then((x) => x.json().then((j) => ({ status: x.status, j: j as any })));
    const postRaw = (p: string, raw: string, extraHeaders?: Record<string, string>) =>
      fetch(`${base}${p}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(extraHeaders ?? {}) },
        body: raw,
      }).then((x) => x.json().then((j) => ({ status: x.status, j: j as any })));
    const get = (p: string, token?: string) =>
      fetch(`${base}${p}`, { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) } }).then((x) =>
        x.json().then((j) => ({ status: x.status, j: j as any }))
      );
    const sign = (raw: string) => crypto.createHmac('sha512', SECRET).update(Buffer.from(raw)).digest('hex');

    const cphone = '+234730000' + String(Math.floor(Math.random() * 9000) + 1000);
    const oo: any = await post('/api/v1/auth/request-otp', { phone: cphone });
    const vv: any = await post('/api/v1/auth/verify-otp', { phone: cphone, code: oo.j._devCode, role: 'customer' });
    assert(!!vv.j.access_token, 'customer otp login');
    const tok: string = vv.j.access_token;

    const created = await post('/api/v1/bookings', {
      category_slug: 'bagged', qty: 2, lga: 'Ikeja',
      pickup_lat: 6.45, pickup_lng: 3.39, pickup_address: 'Lekki Phase 1', photo_keys: ['waste_photo/k1'],
    }, tok);
    assert(created.status === 201, 'booking created');
    const bid: string = created.j.booking.id;
    const total: number = created.j.booking.total_price;

    // live checkout initializes instead of holding
    const pay = await post(`/api/v1/bookings/${bid}/authorize-payment`, { provider: 'paystack' }, tok);
    assert(pay.status === 201, 'live authorize 201');
    assert(pay.j.payment.status === 'authorized', 'payment authorized (not held)');
    assert(typeof pay.j.payment.gateway_ref === 'string' && pay.j.payment.gateway_ref.startsWith(`waste_${bid}_`), 'unique reference stored');
    assert(typeof pay.j.authorization_url === 'string', 'authorization_url returned');
    assert(pay.j.booking.status === 'awaiting_payment', 'booking waits for webhook');
    const ref: string = pay.j.payment.gateway_ref;

    // unsigned webhook rejected
    const noSig = await post('/api/v1/webhooks/paystack', { event: 'charge.success', data: { reference: ref } });
    assert(noSig.status === 401, 'missing signature → 401');

    // wrong signature rejected
    const evt = { event: 'charge.success', data: { reference: ref, status: 'success', amount: total * 100 } };
    const raw = JSON.stringify(evt);
    const bad = await postRaw('/api/v1/webhooks/paystack', raw, { 'x-paystack-signature': 'deadbeef' });
    assert(bad.status === 401, 'bad signature → 401');

    // valid charge.success marks paid
    const good = await postRaw('/api/v1/webhooks/paystack', raw, { 'x-paystack-signature': sign(raw) });
    assert(good.status === 200 && good.j.ok === true, 'valid webhook ok');
    const detail = await get(`/api/v1/bookings/${bid}`, tok);
    assert(detail.j.payment.status === 'held', 'payment held after webhook');
    assert(['searching_vendor', 'offered', 'accepted'].includes(detail.j.booking.status), 'booking advanced');

    // replay is idempotent
    const replay = await postRaw('/api/v1/webhooks/paystack', raw, { 'x-paystack-signature': sign(raw) });
    assert(replay.status === 200 && replay.j.idempotent === true, 'replay idempotent');

    // amount mismatch on a second booking is rejected and stays unpaid
    const b2 = await post('/api/v1/bookings', {
      category_slug: 'bagged', qty: 1, lga: 'Ikeja',
      pickup_lat: 6.45, pickup_lng: 3.39, pickup_address: 'VI', photo_keys: ['k1'],
    }, tok);
    const p2 = await post(`/api/v1/bookings/${b2.j.booking.id}/authorize-payment`, { provider: 'paystack' }, tok);
    const ref2: string = p2.j.payment.gateway_ref;
    const badEvt = { event: 'charge.success', data: { reference: ref2, status: 'success', amount: b2.j.booking.total_price * 100 + 1 } };
    const badRaw = JSON.stringify(badEvt);
    const mismatch = await postRaw('/api/v1/webhooks/paystack', badRaw, { 'x-paystack-signature': sign(badRaw) });
    assert(mismatch.status === 400, 'amount mismatch → 400');
    const d2 = await get(`/api/v1/bookings/${b2.j.booking.id}`, tok);
    assert(d2.j.payment.status === 'authorized', 'mismatched payment stays authorized');

    console.log('\nPaystack live smoke: ALL PASS');
    (globalThis as any).fetch = realFetch;
    server.close();
    process.exit(0);
  } catch (e) {
    console.error('PAYSTACK LIVE FAIL', e);
    (globalThis as any).fetch = realFetch;
    server.close();
    process.exit(1);
  }
});
