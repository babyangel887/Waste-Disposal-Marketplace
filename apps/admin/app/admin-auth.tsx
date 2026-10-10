'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

// Admin session: access token in sessionStorage only (never localStorage,
// never logged). All admin pages read it from here; login writes it.
export const ADMIN_TOKEN_KEY = 'admin.accessToken';

export function readAdminToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.sessionStorage.getItem(ADMIN_TOKEN_KEY);
}

export function storeAdminToken(token: string): void {
  window.sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
}

export function clearAdminToken(): void {
  window.sessionStorage.removeItem(ADMIN_TOKEN_KEY);
}

// Returns the session token once loaded. Redirects to /login when missing.
// Usage: const { token, ready, logout } = useAdminSession();
// if (!ready) return loading; if (!token) return null;
export function useAdminSession() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = readAdminToken();
    if (!t) {
      router.replace('/login');
      return;
    }
    setToken(t);
    setReady(true);
  }, [router]);
  function logout() {
    clearAdminToken();
    setToken(null);
    router.replace('/login');
  }
  return { token, ready, logout };
}
