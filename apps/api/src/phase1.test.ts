process.env.JWT_SECRET = 'test-secret-min-32-chars-xxxxxxxx';
process.env.OTP_MODE = 'mock';
import { app } from './index.js';
import { ensureSeedAdmin, TEST_ADMIN_PASSWORD } from './test-setup.js';

const base = 'http://127.0.0.1:4102';
const server = app.listen(4102, async () => {
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
      }).then((x) => x.json().then((j) => ({ status: x.status, j })));
    const get = (p: string, token?: string) =>
      fetch(`${base}${p}`, { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) } }).then((x) =>
        x.json().then((j) => ({ status: x.status, j }))
      );
    const put = (p: string, body: any, token?: string) =>
      fetch(`${base}${p}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      }).then((x) => x.json().then((j) => ({ status: x.status, j })));

    // vendor register via OTP
    const vphone = '+234710000' + String(Math.floor(Math.random() * 9000) + 1000);
    let o: any = await post('/api/v1/auth/request-otp', { phone: vphone });
    let v: any = await post('/api/v1/auth/verify-otp', { phone: vphone, code: (o.j as any)._devCode, role: 'vendor' });
    assert(!!v.j.access_token, 'vendor otp login');
    const vtok: string = v.j.access_token;
    const vendorId: string = v.j.user.id;

    // onboarding rejects missing docs
    let bad = await post('/api/v1/vendor/onboarding', { business_name: 'Test Trucks', vehicle: { plate_no: 'AAA', type: 'tipper' }, documents: { vehicle_reg: 'k' } }, vtok);
    assert(bad.status === 400, 'onboarding requires all 3 docs');

    // onboarding ok
    const ob = await post(
      '/api/v1/vendor/onboarding',
      {
        business_name: 'Test Trucks Ltd', license_no: 'LIC1',
        vehicle: { plate_no: 'LAG-123XY', type: 'tipper', capacity_kg: 5000 },
        documents: { vehicle_reg: 'doc1', drivers_license: 'doc2', business_doc: 'doc3' },
      },
      vtok
    );
    assert(ob.j.status === 'pending', 'onboarding → pending');

    const prof = await get('/api/v1/vendor/me/profile', vtok);
    assert((prof.j as any).profile.approved_status === 'pending', 'vendor profile pending');

    // admin login via seeded admin password (admins cannot use OTP)
    await ensureSeedAdmin();
    const av: any = await post('/api/v1/auth/admin-login', { phone: '+2348000000001', password: TEST_ADMIN_PASSWORD });
    assert(!!av.j.access_token, 'seed admin login');
    const atok: string = av.j.access_token;

    // admin queue sees pending vendor
    const q = await get('/api/v1/admin/vendors?status=pending', atok);
    assert(Array.isArray((q.j as any).vendors), 'admin queue returns vendors list');
    assert((q.j as any).vendors.some((x: any) => x.id === vendorId), 'admin queue lists vendor');

    // approve
    const ap = await post(`/api/v1/admin/vendors/${vendorId}/approve`, {}, atok);
    assert(ap.j.status === 'approved', 'vendor approved');
    const prof2 = await get('/api/v1/vendor/me/profile', vtok);
    assert((prof2.j as any).profile.approved_status === 'approved', 'vendor sees approved');

    // pricing change reflects in estimate
    const before: any = await post('/api/v1/bookings/estimate', { category_slug: 'bagged', qty: 1, lga: 'Ikeja' });
    const catList: any = await get('/api/v1/admin/pricing', atok);
    const bagged = (catList.j as any).categories.find((c: any) => c.slug === 'bagged');
    const origBase: number = bagged.baseRateNGN ?? bagged.base_rate_ngn;
    const bump = await put(`/api/v1/admin/pricing/categories/${bagged.id}`, { base_rate_ngn: origBase + 100 }, atok);
    assert(bump.status === 200, 'pricing update ok');
    const after: any = await post('/api/v1/bookings/estimate', { category_slug: 'bagged', qty: 1, lga: 'Ikeja' });
    assert(after.j.total === before.j.total + 100, `estimate reflects pricing (+100): ${before.j.total} → ${after.j.total}`);
    // restore
    await put(`/api/v1/admin/pricing/categories/${bagged.id}`, { base_rate_ngn: origBase }, atok);

    // block/unblock
    const bl = await post(`/api/v1/admin/vendors/${vendorId}/block`, {}, atok);
    assert(bl.j.blocked === true, 'vendor blocked');
    const jobs = await get('/api/v1/admin/jobs/active', atok);
    assert(Array.isArray((jobs.j as any).jobs), 'active jobs stub shape');
    const audit = await get('/api/v1/admin/audit?limit=5', atok);
    assert((audit.j as any).logs.length >= 2, 'audit log records actions');
    await post(`/api/v1/admin/vendors/${vendorId}/unblock`, {}, atok);

    console.log('\nPhase 1 smoke: ALL PASS');
    server.close();
    process.exit(0);
  } catch (e) {
    console.error('PHASE1 FAIL', e);
    server.close();
    process.exit(1);
  }
});
