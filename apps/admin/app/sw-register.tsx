'use client';
import { useEffect } from 'react';

// Registers the service worker in production builds only, so local dev
// (next dev) never serves stale cached pages. Never throws.
export default function SwRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // offline/SW unsupported — the app still works online
    });
  }, []);
  return null;
}
