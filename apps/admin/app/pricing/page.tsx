'use client';
import { useState } from 'react';
const API = `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}`;
// Phase 1: DB-backed pricing console. Edits change /bookings/estimate immediately.
export default function Pricing() {
  const [token, setToken] = useState('');
  const [out, setOut] = useState('');
  async function load() {
    const r = await fetch(`${API}/api/v1/admin/pricing`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((x) => x.json());
    setOut(JSON.stringify(r, null, 2));
  }
  return (
    <main style={{ padding: 24 }}>
      <h1>Pricing console</h1>
      <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="admin JWT" style={{ width: 400 }} />
      <button onClick={load}>Load pricing</button>
      <p>PUT /admin/pricing/categories/:id {"{base_rate_ngn, special_fee_ngn}"} · PUT /admin/pricing/lgas/:id {"{surcharge_ngn}"} — history at /admin/pricing/history.</p>
      <pre>{out}</pre>
    </main>
  );
}
