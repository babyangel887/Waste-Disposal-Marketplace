// Phase 0 Admin Control Center skeleton (expanded in Phase 1).
// Connects to apps/api overview endpoint with admin JWT.
'use client';
import { useState } from 'react';

export default function Home() {
  const [out, setOut] = useState('');
  async function check() {
    const token = (document.getElementById('token') as HTMLInputElement)?.value ?? '';
    const r = await fetch('http://localhost:4000/api/v1/admin/overview', {
      headers: { Authorization: `Bearer ${token}` },
    }).then((x) => x.json());
    setOut(JSON.stringify(r, null, 2));
  }
  return (
    <main style={{ padding: 24 }}>
      <h1>Waste Marketplace — Admin (Phase 0)</h1>
      <p>Pilot: Eti-Osa, Ikeja. Vendor approvals + pricing console land in Phase 1.</p>
      <input id="token" placeholder="paste admin JWT" style={{ width: 400 }} />
      <button onClick={check}>Check overview</button>
      <pre>{out}</pre>
      <p><a href="/privacy">Privacy Policy</a> · <a href="/login">Login</a></p>
    </main>
  );
}
