// In-memory rate limits (single process; use Redis for multi-instance).
// Nothing sensitive is stored here — only timestamps keyed by phone/IP.
const WINDOW_15MIN = 15 * 60 * 1000;
const WINDOW_10MIN = 10 * 60 * 1000;
export const MAX_ADMIN_FAILURES = 5;
export const MAX_OTP_REQUESTS = 5;

const adminPhoneHits = new Map<string, number[]>();
const adminIpHits = new Map<string, number[]>();
const otpPhoneHits = new Map<string, number[]>();

function prune(map: Map<string, number[]>, key: string, windowMs: number, now: number): number[] {
  const kept = (map.get(key) ?? []).filter((t) => t > now - windowMs);
  if (kept.length) map.set(key, kept);
  else map.delete(key);
  return kept;
}

// Pre-check: is this IP already over the admin-failure budget?
export function isIpBlocked(ip: string): boolean {
  return prune(adminIpHits, ip, WINDOW_15MIN, Date.now()).length >= MAX_ADMIN_FAILURES;
}

// Record a failed admin-login. Returns true when over budget (phone or IP):
// the first MAX failures return 401, further ones 429.
export function recordAdminFailure(phone: string, ip: string): boolean {
  const now = Date.now();
  const p = prune(adminPhoneHits, phone, WINDOW_15MIN, now);
  p.push(now);
  adminPhoneHits.set(phone, p);
  const i = prune(adminIpHits, ip, WINDOW_15MIN, now);
  i.push(now);
  adminIpHits.set(ip, i);
  return p.length > MAX_ADMIN_FAILURES || i.length > MAX_ADMIN_FAILURES;
}

// A successful login clears the phone + calling-IP counters, so earlier
// failures (e.g. typos, or another IP's attack on the same phone) never
// block a correct login from a different IP.
export function clearAdminFailures(phone: string, ip: string): void {
  adminPhoneHits.delete(phone);
  adminIpHits.delete(ip);
}

// Lighter OTP limit: at most MAX_OTP_REQUESTS per phone per 10 minutes.
// Returns true when the request may proceed (and records it).
export function checkOtpRequest(phone: string): boolean {
  const now = Date.now();
  const hits = prune(otpPhoneHits, phone, WINDOW_10MIN, now);
  if (hits.length >= MAX_OTP_REQUESTS) return false;
  hits.push(now);
  otpPhoneHits.set(phone, hits);
  return true;
}
