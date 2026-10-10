'use client';
import { useState } from 'react';
import { useAdminSession } from '../admin-auth';
import AdminNav from '../admin-nav';
// Phase 1 stub: empty list with Phase-3 shape. Full map lands in Phase 3.
export default function Jobs() {
  const { token, ready, logout, authFetch } = useAdminSession();
  const [out, setOut] = useState('');
  async function load() {
    if (!token) return;
    const r = await authFetch(`/api/v1/admin/jobs/active`).then((x) => x.json());
    setOut(JSON.stringify(r, null, 2));
  }
  if (!ready || !token) return <main style={{ padding: 24 }}>Loading…</main>;
  return (
    <main style={{ padding: 24 }}>
      <AdminNav onLogout={logout} />
      <h1>Active jobs (stub)</h1>
      <button onClick={load}>Load</button>
      <pre>{out}</pre>
    </main>
  );
}
