'use client';
import { useState } from 'react';
const API = `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}`;
// Phase 4: dispute queue + timeline + resolve (refund_vendor|refund_customer|split).
export default function Disputes() {
  const [token, setToken] = useState('');
  const [out, setOut] = useState('');
  async function load() {
    const r = await fetch(`${API}/api/v1/admin/disputes?status=open`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((x) => x.json());
    setOut(JSON.stringify(r, null, 2));
  }
  return (
    <main style={{ padding: 24 }}>
      <h1>Disputes</h1>
      <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="admin JWT" style={{ width: 400 }} />
      <button onClick={load}>Load open</button>
      <p>Timeline: GET /admin/jobs/:id/timeline · Resolve: POST /admin/disputes/:id/resolve.</p>
      <pre>{out}</pre>
    </main>
  );
}
