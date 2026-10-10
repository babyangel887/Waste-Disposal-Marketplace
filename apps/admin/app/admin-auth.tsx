'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export const API_BASE = `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}`;

// Admin session: both tokens in sessionStorage only (never localStorage,
// never logged). Login writes them; every page reads them from here.
export const ADMIN_TOKEN_KEY = 'admin.accessToken';
export const ADMIN_REFRESH_KEY = 'admin.refreshToken';
export const SESSION_EXPIRED_MSG = 'Session expired, please log in again';
const EXPIRED_FLAG = 'admin.sessionExpired';

export function readAdminToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.sessionStorage.getItem(ADMIN_TOKEN_KEY);
}

export function readAdminRefresh(): string | null {
  if (typeof window === 'undefined') return null;
  return window.sessionStorage.getItem(ADMIN_REFRESH_KEY);
}

export function storeAdminSession(access: string, refresh: string): void {
  window.sessionStorage.setItem(ADMIN_TOKEN_KEY, access);
  window.sessionStorage.setItem(ADMIN_REFRESH_KEY, refresh);
}

/** @deprecated Use storeAdminSession so refresh keeps working. */
export function storeAdminToken(token: string): void {
  window.sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
}

export function clearAdminSession(): void {
  window.sessionStorage.removeItem(ADMIN_TOKEN_KEY);
  window.sessionStorage.removeItem(ADMIN_REFRESH_KEY);
}

/** @deprecated Use clearAdminSession. */
export function clearAdminToken(): void {
  clearAdminSession();
}

export function takeExpiredFlag(): boolean {
  if (typeof window === 'undefined') return false;
  const v = window.sessionStorage.getItem(EXPIRED_FLAG) === '1';
  window.sessionStorage.removeItem(EXPIRED_FLAG);
  return v;
}

// Returns the session once loaded. Redirects to /login when either token is
// missing. authFetch retries once via /auth/refresh on any 401; if refresh
// fails it clears the session and redirects to /login with an expiry notice.
// Usage: const { token, ready, logout, authFetch } = useAdminSession();
export function useAdminSession() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!readAdminToken() || !readAdminRefresh()) {
      router.replace('/login');
      return;
    }
    setToken(readAdminToken());
    setReady(true);
  }, [router]);

  const updateSession = useCallback((access: string, refresh: string) => {
    storeAdminSession(access, refresh);
    setToken(access);
  }, []);

  const expireSession = useCallback(() => {
    clearAdminSession();
    setToken(null);
    window.sessionStorage.setItem(EXPIRED_FLAG, '1');
    router.replace('/login');
  }, [router]);

  function logout() {
    clearAdminSession();
    setToken(null);
    router.replace('/login');
  }

  const authFetch = useCallback(async (path: string, init?: RequestInit): Promise<Response> => {
    const send = (t: string | null) =>
      fetch(`${API_BASE}${path}`, {
        ...init,
        headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${t}` },
      });
    const first = await send(readAdminToken());
    if (first.status !== 401) return first;
    try {
      const r = await fetch(`${API_BASE}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: readAdminRefresh() }),
      });
      if (!r.ok) throw new Error('refresh failed');
      const j = await r.json();
      if (!j.access_token || !j.refresh_token) throw new Error('refresh failed');
      updateSession(j.access_token, j.refresh_token);
      return send(j.access_token);
    } catch {
      clearAdminSession();
      setToken(null);
      window.sessionStorage.setItem(EXPIRED_FLAG, '1');
      router.replace('/login');
      return first;
    }
  }, [router, updateSession]);

  return { token, ready, logout, authFetch };
}
