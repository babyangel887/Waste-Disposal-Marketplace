process.env.JWT_SECRET = 'test-secret-min-32-chars-xxxxxxxx';
process.env.OTP_MODE = 'mock';
process.env.ADMIN_PHONE = '+2347990000001';
process.env.ADMIN_PASSWORD = 'test-admin-pass-1234';
process.env.ADMIN_NAME = 'Test Admin';
import crypto from 'node:crypto';
import { app } from './index.js';
import { get, run } from './db.js';
import { ensureSeedAdmin } from './seed-admin.js';
import { verifyPassword } from './password.js';
import { demoteDefaultAdmin, runStartupSeed } from './seed.js';
import { ensureSeedAdmin as ensureLegacyAdmin } from './test-setup.js';

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
    // (dev.db is shared across suite runs, so no fresh-DB assumption here)
    const r1 = await ensureSeedAdmin();
    const r2 = await ensureSeedAdmin();
    assert(r1.phone === '+2347990000001' && r2.phone === '+2347990000001', 'seed:admin runs cleanly twice');
    const n = Number(((await get('SELECT COUNT(*) as c FROM users WHERE phone = ?', '+2347990000001')) as any).c);
    assert(n === 1, 'exactly one admin row (idempotent)');
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

    // admins can never use OTP — even in mock mode, no code is issued
    const aReq: any = await post('/api/v1/auth/request-otp', { phone: '+2347990000001' });
    assert(aReq.status === 403, 'admin request-otp → 403');
    assert(!aReq.j._devCode, 'no mock code leaks for admins');
    const plantedCode = '123456';
    const nowIso = new Date().toISOString();
    await run(
      'INSERT INTO otp_codes (phone, code_hash, expires_at, attempts, last_sent_at) VALUES (?, ?, ?, 0, ?) ON CONFLICT(phone) DO UPDATE SET code_hash=excluded.code_hash, expires_at=excluded.expires_at, attempts=0, last_sent_at=excluded.last_sent_at',
      '+2347990000001',
      crypto.createHash('sha256').update(`+2347990000001:${plantedCode}`).digest('hex'),
      new Date(Date.now() + 300_000).toISOString(), nowIso
    );
    const aVerify: any = await post('/api/v1/auth/verify-otp', { phone: '+2347990000001', code: plantedCode });
    assert(aVerify.status === 403, 'admin verify-otp → 403');

    // one-time cleanup demotes the legacy default admin (idempotent)
    await ensureLegacyAdmin();
    const d1 = await demoteDefaultAdmin();
    assert(d1 === true, 'cleanup demotes legacy default admin');
    const legacy = (await get('SELECT * FROM users WHERE phone = ?', '+2348000000001')) as any;
    assert(legacy.role !== 'admin' && !legacy.password_hash, 'legacy admin demoted + password cleared');
    const d2 = await demoteDefaultAdmin();
    assert(d2 === false, 'cleanup re-run is a no-op');
    await ensureLegacyAdmin();

    // startup seed (Render free-plan flow): ADMIN_* vars create the env admin
    const savedPhone = process.env.ADMIN_PHONE;
    const savedPass = process.env.ADMIN_PASSWORD;
    try {
      process.env.ADMIN_PHONE = '+2347990030001';
      process.env.ADMIN_PASSWORD = 'startup-seed-pass-1234';
      await runStartupSeed();
      const srow = (await get('SELECT * FROM users WHERE phone = ?', '+2347990030001')) as any;
      assert(srow?.role === 'admin', 'startup seed creates env admin');
      assert(verifyPassword('startup-seed-pass-1234', srow.password_hash), 'startup admin password verifies');
      await runStartupSeed();
      const sn = Number(((await get('SELECT COUNT(*) as c FROM users WHERE phone = ?', '+2347990030001')) as any).c);
      assert(sn === 1, 'startup seed idempotent');
      delete process.env.ADMIN_PHONE;
      delete process.env.ADMIN_PASSWORD;
      await runStartupSeed();
      assert(true, 'startup seed skips silently without vars');
    } finally {
      if (savedPhone !== undefined) process.env.ADMIN_PHONE = savedPhone; else delete process.env.ADMIN_PHONE;
      if (savedPass !== undefined) process.env.ADMIN_PASSWORD = savedPass; else delete process.env.ADMIN_PASSWORD;
    }

    console.log('\nSeed-admin smoke: ALL PASS');
    server.close();
    process.exit(0);
  } catch (e) {
    console.error('SEED-ADMIN FAIL', e);
    server.close();
    process.exit(1);
  }
});
