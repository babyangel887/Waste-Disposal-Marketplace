process.env.JWT_SECRET = 'test-secret-min-32-chars-xxxxxxxx';
process.env.OTP_MODE = 'mock';
process.env.PAYSTACK_MODE = 'live';
process.env.PAYSTACK_SECRET_KEY = 'test_paystack_secret_xxxxxxxx';
process.env.PAYSTACK_BASE_URL = 'https://api.paystack.test';
import crypto from 'node:crypto';
import { app } from './index.js';
import { get as getRow, run } from './db.js';
import { ensureSeedAdmin, TEST_ADMIN_PASSWORD, clearOffers } from './test-setup.js';

const base = 'http://127.0.0.1:4113';
const SECRET = 'test_paystack_secret_xxxxxxxx';

// Stub Paystack: initialize always succeeds; refund succeeds or fails on demand.
let refundMode: 'ok' | 'fail' = 'ok';
const refundCalls: any[] = [];
const realFetch = globalThis.fetch;
(globalThis as any).fetch = (url: any, init: any) => {
  if (typeof url === 'string' && url.startsWith('https://api.paystack.test/transaction/initialize')) {
    const body = JSON.parse(String(init?.body ?? '{}'));
    return Promise.resolve(
      new Response(JSON.stringify({ status: true, data: { authorization_url: `https://checkout.paystack.test/${body.reference}`, reference: body.reference } }), { status: 200 })
    );
  }
  if (typeof url === 'string' && url.startsWith('https://api.paystack.test/refund')) {
    const body = JSON.parse(String(init?.body ?? '{}'));
    refundCalls.push(body);
    if (refundMode === 'fail') {
      return Promise.resolve(new Response(JSON.stringify({ status: false, message: 'Transaction not settled yet' }), { status: 400 }));
    }
    return Promise.resolve(new Response(JSON.stringify({ status: true, data: { id: 'ref_test_1' } }), { status: 200 }));
  }
  return (realFetch as any)(url, init);
};

const server = app.listen(4113, async () => {
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
    const R = () => String(Math.floor(Math.random() * 9000) + 1000);
    const otpLogin = async (phone: string, role?: string) => {
      const o: any = await post('/api/v1/auth/request-otp', { phone });
      const v: any = await post('/api/v1/auth/verify-otp', { phone, code: o.j._devCode, role });
      return { token: v.j.access_token as string, id: v.j.user.id as string };
    };
    await ensureSeedAdmin();
    const alogin: any = await post('/api/v1/auth/admin-login', { phone: '+2348000000001', password: TEST_ADMIN_PASSWORD });
    const atok: string = alogin.j.access_token;

    const c = await otpLogin('+234770000' + R(), 'customer');
    const v = await otpLogin('+234771000' + R(), 'vendor');
    await post('/api/v1/vendor/onboarding', {
      business_name: 'Refund Trucks', vehicle: { plate_no: 'R-1', type: 'tipper' },
      documents: { vehicle_reg: 'd1', drivers_license: 'd2', business_doc: 'd3' },
    }, v.token);
    await post(`/api/v1/admin/vendors/${v.id}/approve`, {}, atok);
    await clearOffers();

    async function heldBooking(): Promise<{ bid: string; total: number; ref: string }> {
      const b = await post('/api/v1/bookings', {
        category_slug: 'bagged', qty: 1, lga: 'Ikeja',
        pickup_lat: 6.45, pickup_lng: 3.39, pickup_address: 'R', photo_keys: ['waste_photo/r'],
      }, c.token);
      const bid: string = b.j.booking.id;
      await post(`/api/v1/bookings/${bid}/authorize-payment`, { provider: 'paystack' }, c.token);
      const pay = (await getRow('SELECT * FROM payments WHERE booking_id = ?', bid)) as any;
      const evt = { event: 'charge.success', data: { reference: pay.gateway_ref, status: 'success', amount: b.j.booking.total_price * 100 } };
      const raw = JSON.stringify(evt);
      await postRaw('/api/v1/webhooks/paystack', raw, { 'x-paystack-signature': sign(raw) });
      const held = (await getRow('SELECT * FROM payments WHERE booking_id = ?', bid)) as any;
      assert(held.status === 'held', 'payment held before dispute');
      return { bid, total: b.j.booking.total_price, ref: pay.gateway_ref };
    }
    async function openDispute(bid: string): Promise<string> {
      const id = crypto.randomUUID();
      await run(
        'INSERT INTO disputes (id, booking_id, raised_by, category, notes, status, resolution, created_at, resolved_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        id, bid, c.id, 'payment', 'test', 'open', null, new Date().toISOString(), null
      );
      return id;
    }

    // HELD: real refund call, payment marked refunded, moved true
    const h = await heldBooking();
    const hd = await openDispute(h.bid);
    const before = refundCalls.length;
    const hr = await post(`/api/v1/admin/disputes/${hd}/resolve`, { action: 'refund_customer' }, atok);
    assert(hr.status === 200 && hr.j.money?.moved === true, 'held refund moved');
    assert(refundCalls.length === before + 1, 'Paystack refund called once');
    assert(refundCalls[refundCalls.length - 1].transaction === h.ref, 'refund uses stored gateway reference');
    const hp = (await getRow('SELECT * FROM payments WHERE booking_id = ?', h.bid)) as any;
    assert(hp.status === 'refunded', 'payment marked refunded after confirmation');

    // PAYSTACK FAILURE: 502, records unchanged, dispute still open
    refundMode = 'fail';
    const f = await heldBooking();
    const fd = await openDispute(f.bid);
    const fr = await post(`/api/v1/admin/disputes/${fd}/resolve`, { action: 'refund_customer' }, atok);
    assert(fr.status === 502, 'Paystack failure → 502');
    const fp = (await getRow('SELECT * FROM payments WHERE booking_id = ?', f.bid)) as any;
    assert(fp.status === 'held', 'payment stays held after failure');
    const retry = await post(`/api/v1/admin/disputes/${fd}/resolve`, { action: 'refund_customer' }, atok);
    assert(retry.status === 502, 'retry still possible (dispute still open)');
    refundMode = 'ok';

    // SPLIT (vendor already paid): no reversal, payout flagged, manual notice
    await clearOffers(); // deterministic routing: our vendor wins the tie-break
    const s = await heldBooking();
    const offers = await get('/api/v1/vendor/jobs/offers', v.token);
    const mine = (offers.j.offers as any[]).find((o) => o.offer.booking_id === s.bid);
    assert(!!mine, 'offer issued for this booking');
    await post(`/api/v1/vendor/offers/${mine.offer.id}/accept`, {}, v.token);
    await post(`/api/v1/vendor/jobs/${s.bid}/en-route`, {}, v.token);
    await post(`/api/v1/vendor/jobs/${s.bid}/arrived`, {}, v.token);
    await post(`/api/v1/vendor/jobs/${s.bid}/loading`, {}, v.token);
    await post(`/api/v1/vendor/jobs/${s.bid}/complete`, {}, v.token);
    const payoutBefore = (await getRow('SELECT * FROM payouts WHERE booking_id = ?', s.bid)) as any;
    const disp = await post('/api/v1/disputes', { booking_id: s.bid, category: 'payment', notes: 'test' }, c.token);
    assert(disp.status === 201, 'dispute raised on completed job');
    const callsBefore = refundCalls.length;
    const sr = await post(`/api/v1/admin/disputes/${disp.j.dispute.id}/resolve`, { action: 'refund_customer' }, atok);
    assert(sr.status === 200, 'split resolve ok');
    assert(sr.j.money?.moved === false, 'split resolve moves nothing');
    assert(sr.j.requires_manual_reversal === true, 'manual reversal flagged');
    assert(typeof sr.j.message === 'string' && sr.j.message.length > 0, 'plain manual message returned');
    assert(refundCalls.length === callsBefore, 'no Paystack call for settled payment');
    const payoutAfter = (await getRow('SELECT * FROM payouts WHERE booking_id = ?', s.bid)) as any;
    assert(payoutAfter.amount_ngn === payoutBefore.amount_ngn, 'vendor payout untouched');
    assert(!!payoutAfter.needs_manual_reversal, 'payout row flagged for manual recovery');
    const sp = (await getRow('SELECT * FROM payments WHERE booking_id = ?', s.bid)) as any;
    assert(sp.status === 'split', 'payment stays split');

    // MOCK: same held flow, no Paystack call, records move as before
    process.env.PAYSTACK_MODE = 'mock';
    const m = await post('/api/v1/bookings', {
      category_slug: 'bagged', qty: 1, lga: 'Ikeja',
      pickup_lat: 6.45, pickup_lng: 3.39, pickup_address: 'M', photo_keys: ['waste_photo/m'],
    }, c.token);
    await post(`/api/v1/bookings/${m.j.booking.id}/authorize-payment`, { provider: 'paystack' }, c.token);
    const md = await openDispute(m.j.booking.id);
    const mcalls = refundCalls.length;
    const mr = await post(`/api/v1/admin/disputes/${md}/resolve`, { action: 'refund_customer' }, atok);
    assert(mr.status === 200 && mr.j.money?.moved === true, 'mock refund still moves');
    assert(refundCalls.length === mcalls, 'mock never calls Paystack');
    const mp = (await getRow('SELECT * FROM payments WHERE booking_id = ?', m.j.booking.id)) as any;
    assert(mp.status === 'refunded', 'mock payment marked refunded');
    process.env.PAYSTACK_MODE = 'live';

    console.log('\nDispute-refund smoke: ALL PASS');
    (globalThis as any).fetch = realFetch;
    server.close();
    process.exit(0);
  } catch (e) {
    console.error('DISPUTE-REFUND FAIL', e);
    (globalThis as any).fetch = realFetch;
    server.close();
    process.exit(1);
  }
});
