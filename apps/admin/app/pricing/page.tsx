'use client';
import { useState } from 'react';
import { useAdminSession } from '../admin-auth';
import AdminNav from '../admin-nav';
// Phase 1: DB-backed pricing console. Edits change /bookings/estimate immediately.
export default function Pricing() {
  const { token, ready, logout, authFetch } = useAdminSession();
  const [out, setOut] = useState('');
  async function load() {
    if (!token) return;
    const r = await authFetch(`/api/v1/admin/pricing`).then((x) => x.json());
    setOut(JSON.stringify(r, null, 2));
  }
  if (!ready || !token) return <main style={{ padding: 24 }}>Loading…</main>;
  return (
    <main style={{ padding: 24 }}>
      <AdminNav onLogout={logout} />
      <h1>Pricing console</h1>
      <button onClick={load}>Load pricing</button>
      <p>PUT /admin/pricing/categories/:id {"{base_rate_ngn, special_fee_ngn}"} · PUT /admin/pricing/lgas/:id {"{surcharge_ngn}"} — history at /admin/pricing/history.</p>
      <pre>{out}</pre>
    </main>
  );
}
