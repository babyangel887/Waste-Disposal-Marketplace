'use client';
import { useState } from 'react';
import { useAdminSession } from '../admin-auth';
const API = `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}`;
// Phase 1 stub: empty list with Phase-3 shape. Full map lands in Phase 3.
export default function Jobs() {
  const { token, ready, logout } = useAdminSession();
  const [out, setOut] = useState('');
  async function load() {
    if (!token) return;
    const r = await fetch(`${API}/api/v1/admin/jobs/active`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((x) => x.json());
    setOut(JSON.stringify(r, null, 2));
  }
  if (!ready || !token) return <main style={{ padding: 24 }}>Loading…</main>;
  return (
    <main style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Active jobs (stub)</h1>
        <button onClick={logout}>Log out</button>
      </div>
      <button onClick={load}>Load</button>
      <pre>{out}</pre>
    </main>
  );
}
