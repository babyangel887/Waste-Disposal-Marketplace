// Internal admin token tester (moved from the home page).
// Connects to apps/api overview endpoint with admin JWT.
'use client';
import { useState } from 'react';

export default function AdminTools() {
  const [out, setOut] = useState('');
  async function check() {
    const token = (document.getElementById('token') as HTMLInputElement)?.value ?? '';
    const r = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/api/v1/admin/overview`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((x) => x.json());
    setOut(JSON.stringify(r, null, 2));
  }
  return (
    <main style={{ padding: 24 }}>
      <h1>Admin tools</h1>
      <p>Pilot: Eti-Osa, Ikeja.</p>
      <input id="token" placeholder="paste admin JWT" style={{ width: 400 }} />
      <button onClick={check}>Check overview</button>
      <pre>{out}</pre>
      <p><a href="/login">Login</a> · <a href="/privacy">Privacy Policy</a> · <a href="/ops">Ops</a> · <a href="/vendors">Vendors</a> · <a href="/pricing">Pricing</a> · <a href="/jobs">Jobs</a></p>
    </main>
  );
}
