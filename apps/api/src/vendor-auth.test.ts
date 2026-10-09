process.env.JWT_SECRET = 'test-secret-min-32-chars-xxxxxxxx';
process.env.OTP_MODE = 'mock';
import { app } from './index.js';
import { get } from './db.js';
import { ensureSeedAdmin, clearOffers, TEST_ADMIN_PASSWORD } from './test-setup.js';

const base = 'http://127.0.0.1:4111';
const server = app.listen(4111, async () => {
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
    const R = () => String(Math.floor(Math.random() * 9000) + 1000);
    const otpLogin = async (phone: string, role?: string) => {
      const o: any = await post('/api/v1/auth/request-otp', { phone });
      const v: any = await post('/api/v1/auth/verify-otp', { phone, code: o.j._devCode, role });
      return v;
    };
    const onboard = (tok: string, name: string) =>
      post('/api/v1/vendor/onboarding', {
        business_name: name, vehicle: { plate_no: 'VA-1', type: 'tipper' },
        documents: { vehicle_reg: 'd1', drivers_license: 'd2', business_doc: 'd3' },
      }, tok);

    // (1) role escalation: existing customer re-logging in as vendor stays customer
    const cphone = '+234761000' + R();
    const c1: any = await otpLogin(cphone, 'customer');
    assert(c1.j.user.role === 'customer', 'customer registered');
    const c2: any = await otpLogin(cphone, 'vendor');
    assert(c2.status === 200 && c2.j.user.role === 'customer', 'customer re-login as vendor stays customer');
    const me = await get('/api/v1/me', c2.j.access_token);
    assert(me.j.role === 'customer', 'token still customer');

    // reverse: existing vendor re-logging in as customer stays vendor
    const vphone = '+234762000' + R();
    const v1: any = await otpLogin(vphone, 'vendor');
    assert(v1.j.user.role === 'vendor', 'vendor registered');
    const v2: any = await otpLogin(vphone, 'customer');
    assert(v2.status === 200 && v2.j.user.role === 'vendor', 'vendor re-login as customer stays vendor');

    // (2) pending vendor (onboarded, never approved) is locked out of job routes
    const pphone = '+234763000' + R();
    const pv: any = await otpLogin(pphone, 'vendor');
    const ptok: string = pv.j.access_token;
    await onboard(ptok, 'Pending Trucks');
    const pendOffers = await get('/api/v1/vendor/jobs/offers', ptok);
    assert(pendOffers.status === 403, 'pending vendor: offers → 403');
    const pendAccept = await post('/api/v1/vendor/offers/fake-id/accept', {}, ptok);
    assert(pendAccept.status === 403, 'pending vendor: accept → 403');
    const pendJob = await post('/api/v1/vendor/jobs/fake-id/en-route', {}, ptok);
    assert(pendJob.status === 403, 'pending vendor: job transition → 403');
    const pendEarn = await get('/api/v1/vendor/earnings', ptok);
    assert(pendEarn.status === 403, 'pending vendor: earnings → 403');
    const pendPing = await post('/api/v1/tracking/ping', { booking_id: 'fake', lat: 1, lng: 1 }, ptok);
    assert(pendPing.status === 403, 'pending vendor: tracking ping → 403');
    // ...but onboarding + own profile still work (the path to approval)
    const reOb = await onboard(ptok, 'Pending Trucks 2');
    assert(reOb.j.status === 'pending', 'pending vendor can re-submit onboarding');
    const prof = await get('/api/v1/vendor/me/profile', ptok);
    assert(prof.j.profile?.approved_status === 'pending', 'pending vendor can read own profile');

    // set up a real job for approved vendor A
    await ensureSeedAdmin();
    const alogin: any = await post('/api/v1/auth/admin-login', { phone: '+2348000000001', password: TEST_ADMIN_PASSWORD });
    const atok: string = alogin.j.access_token;
    const av: any = await otpLogin('+234764000' + R(), 'vendor');
    const atokV: string = av.j.access_token;
    const aid: string = av.j.user.id;
    await onboard(atokV, 'Vendor A Trucks');
    await post(`/api/v1/admin/vendors/${aid}/approve`, {}, atok);
    await clearOffers(); // deterministic routing: newest vendor (A) wins the tie-break
    const ctok: string = c1.j.access_token;
    const b = await post('/api/v1/bookings', {
      category_slug: 'bagged', qty: 1, lga: 'Ikeja',
      pickup_lat: 6.45, pickup_lng: 3.39, pickup_address: 'VA', photo_keys: ['waste_photo/va'],
    }, ctok);
    const bid: string = b.j.booking.id;
    await post(`/api/v1/bookings/${bid}/authorize-payment`, { provider: 'paystack' }, ctok);
    const offersA = await get('/api/v1/vendor/jobs/offers', atokV);
    assert(offersA.j.offers.length >= 1, 'vendor A got an offer');
    const offerId: string = offersA.j.offers[0].offer.id;

    // (3) approved vendor B cannot touch A's jobs, offers, or payouts
    const bv: any = await otpLogin('+234765000' + R(), 'vendor');
    const btok: string = bv.j.access_token;
    const bid2: string = bv.j.user.id;
    await onboard(btok, 'Vendor B Trucks');
    await post(`/api/v1/admin/vendors/${bid2}/approve`, {}, atok);
    const crossAccept = await post(`/api/v1/vendor/offers/${offerId}/accept`, {}, btok);
    assert(crossAccept.status === 403, "B cannot accept A's offer");
    const crossJob = await post(`/api/v1/vendor/jobs/${bid}/en-route`, {}, btok);
    assert(crossJob.status === 403, "B cannot transition A's job");
    const crossPing = await post('/api/v1/tracking/ping', { booking_id: bid, lat: 1, lng: 1 }, btok);
    assert(crossPing.status === 403, "B cannot ping A's job");
    const crossRead = await get(`/api/v1/bookings/${bid}`, btok);
    assert(crossRead.status === 403, "B cannot read A's booking");
    const earnB = await get('/api/v1/vendor/earnings', btok);
    assert(earnB.status === 200 && earnB.j.transfers.length === 0, "B earnings show only B's (none)");
    const profB = await get('/api/v1/vendor/me/profile', btok);
    assert(profB.j.profile?.user_id === bid2, "B profile shows only B's data");

    // A still works after the attacks (approval gate lets approved vendors through)
    const acceptA = await post(`/api/v1/vendor/offers/${offerId}/accept`, {}, atokV);
    assert(acceptA.j.status === 'accepted', 'A accepts own offer');

    console.log('\nVendor-auth smoke: ALL PASS');
    server.close();
    process.exit(0);
  } catch (e) {
    console.error('VENDOR-AUTH FAIL', e);
    server.close();
    process.exit(1);
  }
});
