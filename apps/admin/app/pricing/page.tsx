'use client';
import { useState } from 'react';
import { useAdminSession } from '../admin-auth';
const API = `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}`;
// Phase 1: DB-backed pricing console. Edits change /bookings/estimate immediately.
export default function Pricing() {
  const { token, ready, logout } = useAdminSession();
  const [out, setOut] = useState('');
  async function load() {
    if (!token) return;
    const r = await fetch(`${API}/api/v1/admin/pricing`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((x) => x.json());
    setOut(JSON.stringify(r, null, 2));
  }
  if (!ready || !token) return <main style={{ padding: 24 }}>Loading…</main>;
  return (
    <main style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Pricing console</h1>
        <button onClick={logout}>Log out</button>
      </div>
      <button onClick={load}>Load pricing</button>
      <p>PUT /admin/pricing/categories/:id {"{base_rate_ngn, special_fee_ngn}"} · PUT /admin/pricing/lgas/:id {"{surcharge_ngn}"} — history at /admin/pricing/history.</p>
      <pre>{out}</pre>
    </main>
  );
}
