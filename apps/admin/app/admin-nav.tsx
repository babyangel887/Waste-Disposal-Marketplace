'use client';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/vendors', label: 'Vendors' },
  { href: '/jobs', label: 'Jobs' },
  { href: '/ops', label: 'Ops' },
  { href: '/disputes', label: 'Disputes' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/admin-tools', label: 'Admin tools' },
];

// Shared top bar for every logged-in admin page. Token stays in
// sessionStorage (see admin-auth); it is never displayed or logged here.
export default function AdminNav({ onLogout }: { onLogout: () => void }) {
  const path = usePathname();
  return (
    <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
      <nav style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {LINKS.map((l) => {
          const active = path === l.href;
          return (
            <a
              key={l.href}
              href={l.href}
              style={{
                padding: '6px 12px',
                borderRadius: 8,
                textDecoration: 'none',
                color: active ? '#fff' : '#12351f',
                background: active ? '#12351f' : 'transparent',
                fontWeight: active ? 700 : 400,
              }}
            >
              {l.label}
            </a>
          );
        })}
      </nav>
      <button onClick={onLogout}>Log out</button>
    </header>
  );
}
