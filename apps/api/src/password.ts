import crypto from 'node:crypto';

// Password hashing with node:crypto scrypt (no new dependencies).
// Stored format: "scrypt$<salt-hex>$<hash-hex>". The raw password and any
// intermediate secrets are never logged.
const KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, KEYLEN).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, expected] = parts;
  let actual: Buffer;
  try {
    actual = crypto.scryptSync(password, salt, KEYLEN);
  } catch {
    return false;
  }
  const a = Buffer.from(actual.toString('hex'), 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
