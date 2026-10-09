process.env.JWT_SECRET = 'test-secret-min-32-chars-xxxxxxxx';
process.env.OTP_MODE = 'mock';
process.env.ADMIN_PHONE = '+2347990000001';
process.env.ADMIN_PASSWORD = 'test-admin-pass-1234';
process.env.ADMIN_NAME = 'Test Admin';
import { app } from './index.js';
import { get } from './db.js';
import { ensureSeedAdmin } from './seed-admin.js';
import { verifyPassword } from './password.js';

const base = 'http://127.0.0.1:4109';
const server = app.listen(4109, async () => {
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

    // seeder is idempotent: run twice, still exactly one admin row
    const r1 = await ensureSeedAdmin();
    const r2 = await ensureSeedAdmin();
    assert(r1.created === true && r2.created === false, 'seed:admin idempotent (created then updated)');
    const row = (await get('SELECT * FROM users WHERE phone = ?', '+2347990000001')) as any;
    assert(row?.role === 'admin', 'seeded user has role=admin');
    assert(typeof row.password_hash === 'string' && row.password_hash.startsWith('scrypt$'), 'password stored as scrypt hash');
    assert(!String(row.password_hash).includes('test-admin-pass-1234'), 'hash never contains the plaintext');
    assert(verifyPassword('test-admin-pass-1234', row.password_hash) === true, 'correct password verifies');
    assert(verifyPassword('wrong-password-xxxx', row.password_hash) === false, 'wrong password rejected');

    // registration can never mint an admin
    const aphone = '+234799000' + String(Math.floor(Math.random() * 9000) + 1000);
    const ao: any = await post('/api/v1/auth/request-otp', { phone: aphone });
    const av: any = await post('/api/v1/auth/verify-otp', { phone: aphone, code: ao.j._devCode, role: 'admin' });
    assert(av.status === 403, 'registration with role=admin → 403');
    const arow = (await get('SELECT * FROM users WHERE phone = ?', aphone)) as any;
    assert(!arow, 'no user row created for admin attempt');

    // registration forces customer or vendor
    const cphone = '+234799001' + String(Math.floor(Math.random() * 9000) + 1000);
    const co: any = await post('/api/v1/auth/request-otp', { phone: cphone });
    const cv: any = await post('/api/v1/auth/verify-otp', { phone: cphone, code: co.j._devCode, role: 'superuser' });
    assert(cv.j.user.role === 'customer', 'unknown role forced to customer');

    // vendor starts as pending after onboarding
    const vphone = '+234799002' + String(Math.floor(Math.random() * 9000) + 1000);
    const vo: any = await post('/api/v1/auth/request-otp', { phone: vphone });
    const vv: any = await post('/api/v1/auth/verify-otp', { phone: vphone, code: vo.j._devCode, role: 'vendor' });
    const vtok: string = vv.j.access_token;
    const ob = await post('/api/v1/vendor/onboarding', {
      business_name: 'Seed Test Trucks', vehicle: { plate_no: 'ST-1', type: 'tipper' },
      documents: { vehicle_reg: 'd1', drivers_license: 'd2', business_doc: 'd3' },
    }, vtok);
    assert(ob.j.status === 'pending', 'vendor starts as pending');

    // admin password login works; wrong password and non-admins rejected
    const login = await post('/api/v1/auth/admin-login', { phone: '+2347990000001', password: 'test-admin-pass-1234' });
    assert(login.status === 200 && !!login.j.access_token, 'admin-login with seeded password');
    assert(login.j.user.role === 'admin', 'admin-login returns admin role');
    const badPass = await post('/api/v1/auth/admin-login', { phone: '+2347990000001', password: 'wrong-password-xxxx' });
    assert(badPass.status === 401, 'wrong password → 401');
    const notAdmin = await post('/api/v1/auth/admin-login', { phone: cphone, password: 'whatever-password' });
    assert(notAdmin.status === 401, 'non-admin password login → 401');

    // seeded admin can approve the pending vendor (admin-only gate)
    const atok: string = login.j.access_token;
    const ap = await post(`/api/v1/admin/vendors/${vv.j.user.id}/approve`, {}, atok);
    assert(ap.j.status === 'approved', 'admin approves vendor');
    const nonAdminApprove = await post(`/api/v1/admin/vendors/${vv.j.user.id}/approve`, {}, vtok);
    assert(nonAdminApprove.status === 403, 'vendor cannot approve (admin only)');

    console.log('\nSeed-admin smoke: ALL PASS');
    server.close();
    process.exit(0);
  } catch (e) {
    console.error('SEED-ADMIN FAIL', e);
    server.close();
    process.exit(1);
  }
});
