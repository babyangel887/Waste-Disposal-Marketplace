process.env.JWT_SECRET = 'test-secret-min-32-chars-xxxxxxxx';
process.env.OTP_MODE = 'mock';
const savedPhone = process.env.ADMIN_PHONE;
const savedPass = process.env.ADMIN_PASSWORD;
process.env.ADMIN_PHONE = '080799' + String(Math.floor(Math.random() * 90000) + 10000);
process.env.ADMIN_PASSWORD = 'phone-test-pass-1234';
import { app } from './index.js';
import { get } from './db.js';
import { ensureSeedAdmin } from './seed-admin.js';
import { normalizePhone } from './phone.js';

// Pure unit checks (no server needed).
const unit: [string, string][] = [
  ['08067935929', '+2348067935929'],
  ['8067935929', '+2348067935929'],
  ['+2348067935929', '+2348067935929'],
  ['+234 806 793 5929', '+2348067935929'],
  ['0803 123 4567', '+2348031234567'],
];
for (const [input, expected] of unit) {
  const got = normalizePhone(input);
  if (got !== expected) throw new Error(`ASSERT: normalizePhone(${input}) = ${got}, want ${expected}`);
  console.log('ok -', `normalize ${input} -> ${expected}`);
}
for (const bad of ['abc', '12', '', '+', '08067935929!']) {
  let threw = false;
  try {
    normalizePhone(bad);
  } catch {
    threw = true;
  }
  if (!threw) throw new Error(`ASSERT: normalizePhone(${bad}) should throw`);
  console.log('ok -', `reject ${bad || '(empty)'}`);
}

// Live cross-format checks: all spellings share one account.
const base = 'http://127.0.0.1:4112';
const server = app.listen(4112, async () => {
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
    const getMe = (token: string) =>
      fetch(`${base}/api/v1/me`, { headers: { Authorization: `Bearer ${token}` } }).then((x) =>
        x.json().then((j) => ({ status: x.status, j: j as any }))
      );

    // register with 0-prefixed spelling, verify with +234 spelling
    const local = '08077' + String(Math.floor(Math.random() * 900000) + 100000);
    const intl = '+234' + local.slice(1);
    const bare = local.slice(1);
    const o1: any = await post('/api/v1/auth/request-otp', { phone: local });
    assert(!!o1.j._devCode, 'otp requested with 0-prefixed spelling');
    const v1: any = await post('/api/v1/auth/verify-otp', { phone: intl, code: o1.j._devCode, role: 'customer' });
    assert(!!v1.j.access_token, 'verified with +234 spelling');
    assert(v1.j.user.phone === intl, 'stored phone is E.164');
    const id1: string = v1.j.user.id;
    // bare 10-digit spelling maps to the same account (code path only; login check)
    const o2: any = await post('/api/v1/auth/request-otp', { phone: bare });
    await post('/api/v1/auth/verify-otp', { phone: bare, code: '000000' }).catch(() => null);
    const me = await getMe(v1.j.access_token);
    assert(me.j.id === id1, 'same account across spellings');
    void o2;

    // admin seeded with 0-prefixed ADMIN_PHONE, logs in with +234 spelling
    const r = await ensureSeedAdmin();
    assert(r.phone.startsWith('+234'), 'seeded admin phone normalized');
    const login: any = await post('/api/v1/auth/admin-login', { phone: '+234' + (process.env.ADMIN_PHONE as string).slice(1), password: 'phone-test-pass-1234' });
    assert(login.status === 200 && login.j.user.role === 'admin', 'admin-login accepts variant spelling');
    const row = (await get('SELECT * FROM users WHERE id = ?', login.j.user.id)) as any;
    assert(row.phone === r.phone, 'stored admin phone is E.164');

    console.log('\nPhone smoke: ALL PASS');
    server.close();
    process.exit(0);
  } catch (e) {
    console.error('PHONE FAIL', e);
    server.close();
    process.exit(1);
  } finally {
    if (savedPhone !== undefined) process.env.ADMIN_PHONE = savedPhone; else delete process.env.ADMIN_PHONE;
    if (savedPass !== undefined) process.env.ADMIN_PASSWORD = savedPass; else delete process.env.ADMIN_PASSWORD;
  }
});
