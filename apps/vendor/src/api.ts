// Single place for the API base URL. No hardcoded URLs in screens.
// Set via EXPO_PUBLIC_API_URL (see .env + eas.json); falls back to Render prod.
export const API_BASE =
  process.env.EXPO_PUBLIC_API_URL ?? 'https://waste-disposal-marketplace.onrender.com';

export interface Session {
  access: string;
  refresh: string;
}

// Everything the screens need for authenticated calls: the current session,
// a saver for rotated tokens, and an expiry handler that returns to Login.
export interface AuthState {
  session: Session;
  update: (s: Session) => Promise<void>;
  expire: () => void;
}

export function authHeaders(token: string): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

export const TOKEN_KEY = 'vendor.authToken';
export const REFRESH_TOKEN_KEY = 'vendor.refreshToken';
export const SESSION_EXPIRED_MSG = 'Session expired, please log in again';

// Authenticated fetch: on a 401 it uses the refresh token once and retries.
// If refresh fails, the session is expired (caller returns to Login) and the
// original 401 response is returned so screens can show their error state.
export async function apiFetch(
  url: string,
  init: RequestInit | undefined,
  auth: AuthState
): Promise<Response> {
  const send = (access: string) =>
    fetch(url, {
      ...init,
      headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${access}` },
    });
  const first = await send(auth.session.access);
  if (first.status !== 401) return first;
  try {
    const r = await fetch(`${API_BASE}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: auth.session.refresh }),
    });
    if (!r.ok) throw new Error('refresh failed');
    const j: any = await r.json();
    if (!j.access_token || !j.refresh_token) throw new Error('refresh failed');
    const next: Session = { access: j.access_token, refresh: j.refresh_token };
    await auth.update(next);
    return send(next.access);
  } catch {
    auth.expire();
    return first;
  }
}
