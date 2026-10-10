// Internal admin overview check. Token comes from the login session.
'use client';
import { useState } from 'react';
import { useAdminSession } from '../admin-auth';
import AdminNav from '../admin-nav';

export default function AdminTools() {
  const { token, ready, logout } = useAdminSession();
  const [out, setOut] = useState('');
  async function check() {
    if (!token) return;
    const r = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/api/v1/admin/overview`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((x) => x.json());
    setOut(JSON.stringify(r, null, 2));
  }
  if (!ready || !token) return <main style={{ padding: 24 }}>Loading…</main>;
  return (
    <main style={{ padding: 24 }}>
      <AdminNav onLogout={logout} />
      <h1>Admin tools</h1>
      <p>Pilot: Eti-Osa, Ikeja.</p>
      <button onClick={check}>Check overview</button>
      <pre>{out}</pre>
      <p><a href="/login">Login</a> · <a href="/privacy">Privacy Policy</a> · <a href="/ops">Ops</a> · <a href="/vendors">Vendors</a> · <a href="/pricing">Pricing</a> · <a href="/jobs">Jobs</a></p>
    </main>
  );
}
