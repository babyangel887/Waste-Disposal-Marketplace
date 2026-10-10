'use client';
import { useState } from 'react';
import { useAdminSession } from '../admin-auth';
const API = `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}`;
// Phase 4: dispute queue + timeline + resolve (refund_vendor|refund_customer|split).
export default function Disputes() {
  const { token, ready, logout } = useAdminSession();
  const [out, setOut] = useState('');
  async function load() {
    if (!token) return;
    const r = await fetch(`${API}/api/v1/admin/disputes?status=open`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((x) => x.json());
    setOut(JSON.stringify(r, null, 2));
  }
  if (!ready || !token) return <main style={{ padding: 24 }}>Loading…</main>;
  return (
    <main style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Disputes</h1>
        <button onClick={logout}>Log out</button>
      </div>
      <button onClick={load}>Load open</button>
      <p>Timeline: GET /admin/jobs/:id/timeline · Resolve: POST /admin/disputes/:id/resolve.</p>
      <pre>{out}</pre>
    </main>
  );
}
