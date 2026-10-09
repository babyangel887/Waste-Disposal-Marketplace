process.env.JWT_SECRET = 'test-secret-min-32-chars-xxxxxxxx';
process.env.OTP_MODE = 'mock';
// Start without S3 vars so the first half runs in mock/dev mode.
delete process.env.S3_ENDPOINT;
delete process.env.S3_BUCKET;
delete process.env.S3_ACCESS_KEY;
delete process.env.S3_SECRET_KEY;
delete process.env.S3_PUBLIC_BASE_URL;
import { app } from './index.js';

const base = 'http://127.0.0.1:4108';
const server = app.listen(4108, async () => {
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

    const cphone = '+234760000' + String(Math.floor(Math.random() * 9000) + 1000);
    const oo: any = await post('/api/v1/auth/request-otp', { phone: cphone });
    const vv: any = await post('/api/v1/auth/verify-otp', { phone: cphone, code: oo.j._devCode, role: 'customer' });
    assert(!!vv.j.access_token, 'customer otp login');
    const tok: string = vv.j.access_token;

    // mock/dev mode: key returned, no upload URL, clearly marked mock
    const mock = await post('/api/v1/uploads/presign', { kind: 'waste_photo', contentType: 'image/jpeg' }, tok);
    assert(mock.status === 200, 'mock presign 200');
    assert(mock.j.mock === true, 'mock flag set');
    assert(typeof mock.j.key === 'string' && mock.j.key.startsWith('waste_photo/'), 'mock key shape');
    assert(mock.j.uploadUrl === null && mock.j.publicUrl === null, 'mock has no URLs');

    // mock key books end to end
    const created = await post('/api/v1/bookings', {
      category_slug: 'bagged', qty: 1, lga: 'Ikeja',
      pickup_lat: 6.45, pickup_lng: 3.39, pickup_address: 'T', photo_keys: [mock.j.key],
    }, tok);
    assert(created.status === 201, 'booking accepts mock key');

    // invalid kind rejected
    const bad = await post('/api/v1/uploads/presign', { kind: 'selfie' }, tok);
    assert(bad.status === 400, 'invalid kind → 400');

    // real mode with dummy S3 vars: presigned PUT URL is generated offline
    // (signing is local, no network), public URL built from the base.
    process.env.S3_ENDPOINT = 'https://abc123.r2.cloudflarestorage.com';
    process.env.S3_BUCKET = 'waste-test';
    process.env.S3_ACCESS_KEY = 'dummy-access';
    process.env.S3_SECRET_KEY = 'dummy-secret';
    process.env.S3_PUBLIC_BASE_URL = 'https://photos.example.com';
    const real = await post('/api/v1/uploads/presign', { kind: 'waste_photo', contentType: 'image/jpeg' }, tok);
    assert(real.status === 200, 'real presign 200');
    assert(real.j.mock === false, 'mock flag off');
    assert(typeof real.j.uploadUrl === 'string' && real.j.uploadUrl.includes('abc123.r2.cloudflarestorage.com'), 'upload URL targets endpoint');
    assert(typeof real.j.publicUrl === 'string' && real.j.publicUrl.startsWith('https://photos.example.com/waste_photo/'), 'public URL from base');

    console.log('\nUploads smoke: ALL PASS');
    server.close();
    process.exit(0);
  } catch (e) {
    console.error('UPLOADS FAIL', e);
    server.close();
    process.exit(1);
  }
});
