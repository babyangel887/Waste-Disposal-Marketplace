import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET ?? 'dev-only-change-me-min-32-chars';
if ((process.env.JWT_SECRET ?? '').length < 10 && process.env.NODE_ENV === 'production') {
  throw new Error('JWT_SECRET must be set in production');
}

export interface TokenPayload {
  sub: string;
  role: string;
  phone: string;
}

export function signAccess(p: TokenPayload) {
  return jwt.sign(p, SECRET, { expiresIn: (process.env.JWT_ACCESS_TTL as any) ?? '15m' });
}

export function signRefresh(p: TokenPayload) {
  return jwt.sign({ ...p, type: 'refresh' }, SECRET, {
    expiresIn: (process.env.JWT_REFRESH_TTL as any) ?? '30d',
  });
}

export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, SECRET) as TokenPayload;
}
