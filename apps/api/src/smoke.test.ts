process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-min-32-chars-xxxxxxxx';
process.env.OTP_MODE = 'mock';
process.env.PORT = '4101';
import { app } from './index.js';

const base = 'http://127.0.0.1:4101';
const server = app.listen(4101, async () => {
  try {
    const assert = (cond: boolean, msg: string) => {
      if (!cond) throw new Error('ASSERT: ' + msg);
      console.log('ok -', msg);
    };
    let r = await fetch(`${base}/health`).then((x) => x.json());
    assert(r.ok === true, 'health');

    r = await fetch(`${base}/api/v1/catalog`).then((x) => x.json());
    assert(r.categories?.length === 4 && r.lgas?.length === 2, 'catalog seed');

    r = await fetch(`${base}/api/v1/bookings/estimate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category_slug: 'bulky', qty: 2, lga: 'Eti-Osa' }),
    }).then((x) => x.json());
    // 12000*2 + 5000 + 2000 = 31000
    assert(r.total === 31000, `estimate bulky x2 Eti-Osa = 31000 (got ${r.total})`);

    const phone = '+2347000000' + String(Math.floor(Math.random() * 900) + 100);
    let o: any = await fetch(`${base}/api/v1/auth/request-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone }),
    }).then((x) => x.json());
    assert(!!o._devCode, 'otp mock returns dev code');

    let v: any = await fetch(`${base}/api/v1/auth/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, code: o._devCode, role: 'customer', name: 'Test User' }),
    }).then((x) => x.json());
    assert(!!v.access_token, 'verify otp issues JWT');

    const me: any = await fetch(`${base}/api/v1/me`, {
      headers: { Authorization: `Bearer ${v.access_token}` },
    }).then((x) => x.json());
    assert(me.phone === phone, 'me returns user');

    const c: any = await fetch(`${base}/api/v1/auth/consent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${v.access_token}` },
      body: JSON.stringify({ consent_type: 'privacy_policy', version: 'v1.0-phase0' }),
    }).then((x) => x.json());
    assert(c.ok === true, 'consent logged');

    console.log('\nPhase 0 smoke: ALL PASS');
    server.close();
    process.exit(0);
  } catch (e) {
    console.error('SMOKE FAIL', e);
    server.close();
    process.exit(1);
  }
});
