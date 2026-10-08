process.env.JWT_SECRET = 'test-secret-min-32-chars-xxxxxxxx';
process.env.OTP_MODE = 'mock';
import { app } from './index.js';
import { ensureSeedAdmin, clearOffers } from './test-setup.js';

const base = 'http://127.0.0.1:4105';
const server = app.listen(4105, async () => {
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
      return { token: v.j.access_token as string, id: v.j.user.id as string };
    };
    const R = () => String(Math.floor(Math.random() * 9000) + 1000);
    await ensureSeedAdmin();

    const c = await otpLogin('+234740000' + R(), 'customer');
    const v = await otpLogin('+234741000' + R(), 'vendor');
    await post('/api/v1/vendor/onboarding', {
      business_name: 'Phase4 Trucks', vehicle: { plate_no: 'P4-001', type: 'tipper' },
      documents: { vehicle_reg: 'd1', drivers_license: 'd2', business_doc: 'd3' },
    }, v.token);
    const a = await otpLogin('+2348000000001');
    await post(`/api/v1/admin/vendors/${v.id}/approve`, {}, a.token);

    async function paidBooking(total?: number) {
      await clearOffers(); // deterministic routing: newest vendor (ours) wins the tie-break
      const b = await post('/api/v1/bookings', {
        category_slug: 'bagged', qty: 2, lga: 'Ikeja',
        pickup_lat: 6.45, pickup_lng: 3.39, pickup_address: 'P4 addr', photo_keys: ['waste_photo/p4'],
      }, c.token);
      const bid: string = b.j.booking.id;
      await post(`/api/v1/bookings/${bid}/authorize-payment`, { provider: 'paystack' }, c.token);
      return { bid, total: b.j.booking.total_price as number };
    }
    async function acceptAsVendor(bid: string) {
      const offers = await get('/api/v1/vendor/jobs/offers', v.token);
      assert(Array.isArray((offers.j as any).offers), 'offers list');
      const mine = (offers.j.offers as any[]).find((o) => o.booking?.id === bid);
      assert(!!mine, 'offer received');
      await post(`/api/v1/vendor/offers/${mine.offer.id}/accept`, {}, v.token);
    }

    // 7.1A vendor no-show → full refund
    let t = await paidBooking();
    let r = await post(`/api/v1/bookings/${t.bid}/cancel`, { reason: 'vendor_no_show' }, c.token);
    assert(r.j.penalty_ngn === 0 && r.j.refund_ngn === t.total, `7.1A no-show full refund ${t.total}`);
    let det = await get(`/api/v1/bookings/${t.bid}`, c.token);
    assert(det.j.payment.status === 'refunded', '7.1A payment refunded');

    // 7.1B extreme delay → full refund (+ delay evidence)
    t = await paidBooking();
    await acceptAsVendor(t.bid);
    r = await post(`/api/v1/bookings/${t.bid}/cancel`, { reason: 'vendor_late' }, c.token);
    assert(r.j.vendor_at_fault === true && r.j.refund_ngn === t.total, '7.1B late full refund');
    assert(typeof r.j.minutes_since_accept === 'number', '7.1B delay evidence recorded');

    // 7.2A change of mind within grace → no penalty
    t = await paidBooking();
    await acceptAsVendor(t.bid);
    r = await post(`/api/v1/bookings/${t.bid}/cancel`, { reason: 'customer_change_mind' }, c.token);
    assert(r.j.grace === true && r.j.penalty_ngn === 0, '7.2A grace-period full refund');

    // 7.2B absent (arrived + 7min + 3 calls) → ₦3,000 to vendor
    t = await paidBooking();
    await acceptAsVendor(t.bid);
    await post(`/api/v1/vendor/jobs/${t.bid}/en-route`, { lat: 6.45, lng: 3.39 }, v.token);
    await post(`/api/v1/vendor/jobs/${t.bid}/arrived`, { lat: 6.45, lng: 3.39 }, v.token);
    const ns = await post(`/api/v1/vendor/jobs/${t.bid}/no-show`, { calls_made: 3, waited_secs: 420 }, v.token);
    assert(ns.j.penalty_ngn === 3000 && ns.j.refund_ngn === t.total - 3000, '7.2B absent ₦3,000 fuel fee');
    const earn1 = await get('/api/v1/vendor/earnings', v.token);
    assert((earn1.j as any).completed_payout_ngn >= 3000, '7.2B vendor earnings show fuel fee');

    // 7.2C adjustment-reject → ₦3,000 to vendor
    t = await paidBooking();
    await acceptAsVendor(t.bid);
    await post(`/api/v1/vendor/jobs/${t.bid}/en-route`, {}, v.token);
    await post(`/api/v1/vendor/jobs/${t.bid}/arrived`, {}, v.token);
    const adj = await post(`/api/v1/vendor/jobs/${t.bid}/adjust-quote`, { new_total: t.total + 5000, reason: 'extra' }, v.token);
    await post(`/api/v1/bookings/${t.bid}/adjustments/${adj.j.adjustment.id}/reject`, {}, c.token);
    r = await post(`/api/v1/bookings/${t.bid}/cancel`, { reason: 'adjustment_rejected' }, c.token);
    assert(r.j.penalty_ngn === 3000, '7.2C reject ₦3,000 fuel fee');

    // complete → split + receipt + earnings
    t = await paidBooking();
    await acceptAsVendor(t.bid);
    await post(`/api/v1/vendor/jobs/${t.bid}/en-route`, {}, v.token);
    await post(`/api/v1/vendor/jobs/${t.bid}/arrived`, {}, v.token);
    await post(`/api/v1/vendor/jobs/${t.bid}/loading`, {}, v.token);
    const done = await post(`/api/v1/vendor/jobs/${t.bid}/complete`, {}, v.token);
    assert(done.j.status === 'completed' && done.j.receipt.vendor_payout_ngn === t.total, 'complete split + receipt');
    det = await get(`/api/v1/bookings/${t.bid}`, c.token);
    assert(det.j.payment.status === 'split' && det.j.payout.status === 'completed', 'payment split recorded');

    // dispute raise → timeline → admin resolve
    const disp = await post('/api/v1/disputes', { booking_id: t.bid, category: 'payment', notes: 'test' }, c.token);
    assert(disp.status === 201, 'dispute raised');
    const tl = await get(`/api/v1/admin/jobs/${t.bid}/timeline`, a.token);
    assert(Array.isArray((tl.j as any).history) && (tl.j as any).payment, 'timeline has history + payment');
    const res = await post(`/api/v1/admin/disputes/${disp.j.dispute.id}/resolve`, { action: 'refund_customer', note: 'goodwill' }, a.token);
    assert(res.j.status === 'resolved', 'dispute resolved');

    console.log('\nPhase 4 smoke: ALL PASS');
    server.close();
    process.exit(0);
  } catch (e) {
    console.error('PHASE4 FAIL', e);
    server.close();
    process.exit(1);
  }
});
