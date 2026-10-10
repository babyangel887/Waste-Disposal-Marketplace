import { Platform } from 'react-native';

export const isWeb = Platform.OS === 'web';

// Web-only PWA setup: manifest + theme-color links and the service worker.
// No-ops on native and never throws, so startup can't crash on any platform.
export function registerPwa(): void {
  if (!isWeb) return;
  try {
    if (typeof document !== 'undefined') {
      if (!document.querySelector('link[rel="manifest"]')) {
        const link = document.createElement('link');
        link.rel = 'manifest';
        link.href = '/manifest.webmanifest';
        document.head.appendChild(link);
      }
      if (!document.querySelector('meta[name="theme-color"]')) {
        const meta = document.createElement('meta');
        meta.name = 'theme-color';
        meta.content = '#12351f';
        document.head.appendChild(meta);
      }
      if (!document.querySelector('link[rel="apple-touch-icon"]')) {
        const icon = document.createElement('link');
        icon.rel = 'apple-touch-icon';
        icon.href = '/icon-192.png';
        document.head.appendChild(icon);
      }
    }
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // offline/SW unsupported — the app still works online
      });
    }
  } catch {
    // never crash startup
  }
}
