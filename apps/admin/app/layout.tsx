import type { Metadata, Viewport } from 'next';
import SwRegister from './sw-register';

export const metadata: Metadata = {
  title: 'Waste Disposal Admin',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'WasteAdmin' },
  icons: {
    icon: [{ url: '/icon-192.png' }, { url: '/icon-512.png' }],
    apple: [{ url: '/icon-192.png' }],
  },
};

export const viewport: Viewport = {
  themeColor: '#1e3a5f',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui', margin: 0 }}>
        <SwRegister />
        {children}
      </body>
    </html>
  );
}
