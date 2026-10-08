import crypto from 'node:crypto';
import { db } from './db.js';

const OTP_TTL_SEC = Number(process.env.OTP_TTL_SEC ?? 300);

function hash(code: string, phone: string) {
  return crypto.createHash('sha256').update(`${phone}:${code}`).digest('hex');
}

async function sendViaTermii(phone: string, code: string) {
  // All settings from .env only — never hard-coded, never logged.
  const key = process.env.TERMII_API_KEY;
  if (!key) throw new Error('OTP_MODE=termii but TERMII_API_KEY is not set');
  const from = process.env.TERMII_SENDER ?? 'WasteApp';
  const channel = process.env.TERMII_CHANNEL ?? 'generic';
  let res: Response;
  try {
    res = await fetch('https://api.ng.termii.com/api/sms/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: phone,
        from,
        sms: `Your WasteApp code is ${code}. Expires in 5 minutes.`,
        type: 'plain',
        channel,
        api_key: key,
      }),
    });
  } catch {
    throw new Error('SMS provider unreachable, try again later');
  }
  // Log only the HTTP status — never the key or message body.
  console.log(`[otp] termii status=${res.status}`);
  if (!res.ok) throw new Error(`SMS provider error (status ${res.status}), try again later`);
}

export async function requestOtp(phone: string) {
  const clean = phone.replace(/\s/g, '');
  if (!/^\+?[0-9]{7,15}$/.test(clean)) throw new Error('invalid phone format');

  const now = new Date();
  const existing = db.prepare('SELECT * FROM otp_codes WHERE phone = ?').get(clean) as any;
  if (existing) {
    const lastSent = new Date(existing.last_sent_at).getTime();
    if (Date.now() - lastSent < 30_000) throw new Error('OTP already sent, wait 30s');
  }
  // Fraud guardrail (Phase 5): max 5 OTP sends per phone per hour.
  const hourAgo = new Date(now.getTime() - 3600_000).toISOString();
  const sent = (db.prepare('SELECT COUNT(*) as c FROM otp_sends WHERE phone=? AND sent_at > ?').get(clean, hourAgo) as any).c as number;
  if (sent >= 5) throw new Error('OTP rate limit: max 5 per hour');
  db.prepare('INSERT INTO otp_sends (phone, sent_at) VALUES (?, ?)').run(clean, now.toISOString());
  db.prepare("DELETE FROM otp_sends WHERE sent_at < ?").run(new Date(now.getTime() - 24 * 3600_000).toISOString());

  const code = String(crypto.randomInt(100000, 999999));
  const expiresAt = new Date(now.getTime() + OTP_TTL_SEC * 1000).toISOString();
  db.prepare(
    `INSERT INTO otp_codes (phone, code_hash, expires_at, attempts, last_sent_at)
     VALUES (?, ?, ?, 0, ?)
     ON CONFLICT(phone) DO UPDATE SET code_hash=excluded.code_hash, expires_at=excluded.expires_at, attempts=0, last_sent_at=excluded.last_sent_at`
  ).run(clean, hash(code, clean), expiresAt, now.toISOString());

  const mode = process.env.OTP_MODE ?? 'mock';
  if (mode === 'termii') await sendViaTermii(clean, code);
  else console.log(`[otp mock] ${clean} -> ${code}`);

  // In mock mode return code so Phase 0 can be tested without SMS. Never do this in prod.
  return mode === 'mock' ? { expiresIn: OTP_TTL_SEC, _devCode: code } : { expiresIn: OTP_TTL_SEC };
}

export function verifyOtp(phone: string, code: string) {
  const clean = phone.replace(/\s/g, '');
  const row = db.prepare('SELECT * FROM otp_codes WHERE phone = ?').get(clean) as any;
  if (!row) throw new Error('no OTP requested for this phone');
  if (new Date(row.expires_at).getTime() < Date.now()) throw new Error('OTP expired');
  if (row.attempts >= 5) throw new Error('too many attempts, request a new code');
  if (row.code_hash !== hash(code, clean)) {
    db.prepare('UPDATE otp_codes SET attempts = attempts + 1 WHERE phone = ?').run(clean);
    throw new Error('invalid code');
  }
  db.prepare('DELETE FROM otp_codes WHERE phone = ?').run(clean);
  return true;
}
