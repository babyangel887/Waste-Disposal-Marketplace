process.env.JWT_SECRET = 'test-secret-min-32-chars-xxxxxxxx';
process.env.OTP_MODE = 'mock';
process.env.ADMIN_PHONE = '+2347990040001';
process.env.ADMIN_PASSWORD = 'rate-limit-pass-1234';
import { app } from './index.js';
import { run } from './db.js';
import { ensureSeedAdmin } from './seed-admin.js';

const base = 'http://127.0.0.1:4110';
const ATTACKER = '9.9.9.9';
const LEGIT = '8.8.8.8';
const server = app.listen(4110, async () => {
  try {
    const assert = (cond: boolean, msg: string) => {
      if (!cond) throw new Error('ASSERT: ' + msg);
      console.log('ok -', msg);
    };
    const post = (p: string, body: any, ip?: string) =>
      fetch(`${base}${p}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(ip ? { 'X-Forwarded-For': ip } : {}) },
        body: JSON.stringify(body),
      }).then((x) => x.json().then((j) => ({ status: x.status, j: j as any })));

    await ensureSeedAdmin();
    const aphone = '+2347990040001';

    // 5 failed logins from the attacker IP → 401 each
    for (let i = 0; i < 5; i++) {
      const r: any = await post('/api/v1/auth/admin-login', { phone: aphone, password: 'wrong-password-xxxx' }, ATTACKER);
      assert(r.status === 401, `attacker failure ${i + 1}/5 → 401`);
    }
    // 6th failure → 429 with the generic message
    const sixth: any = await post('/api/v1/auth/admin-login', { phone: aphone, password: 'wrong-password-xxxx' }, ATTACKER);
    assert(sixth.status === 429, '6th failure → 429');
    assert(sixth.j.error === 'Too many attempts, try again later', 'generic 429 message');

    // Correct login from a different IP still succeeds (not blocked by the attack)
    const legit: any = await post('/api/v1/auth/admin-login', { phone: aphone, password: 'rate-limit-pass-1234' }, LEGIT);
    assert(legit.status === 200 && !!legit.j.access_token, 'legit login from other IP succeeds');

    // The attacker's own IP stays blocked, even with the right password
    const blocked: any = await post('/api/v1/auth/admin-login', { phone: aphone, password: 'rate-limit-pass-1234' }, ATTACKER);
    assert(blocked.status === 429, 'blocked IP stays 429');

    // Lighter OTP limit: 5 requests per phone per 10 minutes, then 429.
    // (DELETE otp_codes between sends to bypass the separate 30s resend guard,
    // mirroring phase5 — the otp_sends 5/hour guard would also 429, but our
    // limiter runs first and returns the generic message.)
    const p6 = '+234799004' + String(Math.floor(Math.random() * 9000) + 1000);
    for (let i = 0; i < 5; i++) {
      const o: any = await post('/api/v1/auth/request-otp', { phone: p6 });
      assert(!!o.j._devCode, `otp ${i + 1}/5 sent`);
      await run('DELETE FROM otp_codes WHERE phone=?', p6);
    }
    const o6: any = await post('/api/v1/auth/request-otp', { phone: p6 });
    assert(o6.status === 429, '6th OTP request → 429');
    assert(o6.j.error === 'Too many attempts, try again later', 'generic OTP 429 message');

    console.log('\nRate-limit smoke: ALL PASS');
    server.close();
    process.exit(0);
  } catch (e) {
    console.error('RATE-LIMIT FAIL', e);
    server.close();
    process.exit(1);
  }
});
