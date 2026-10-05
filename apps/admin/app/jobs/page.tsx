'use client';
import { useState } from 'react';
const API = 'http://localhost:4000';
// Phase 1 stub: empty list with Phase-3 shape. Full map lands in Phase 3.
export default function Jobs() {
  const [token, setToken] = useState('');
  const [out, setOut] = useState('');
  async function load() {
    const r = await fetch(`${API}/api/v1/admin/jobs/active`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((x) => x.json());
    setOut(JSON.stringify(r, null, 2));
  }
  return (
    <main style={{ padding: 24 }}>
      <h1>Active jobs (stub)</h1>
      <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="admin JWT" style={{ width: 400 }} />
      <button onClick={load}>Load</button>
      <pre>{out}</pre>
    </main>
  );
}
