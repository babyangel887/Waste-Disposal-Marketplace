'use client';
import { useState } from 'react';
const API = `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}`;
// Phase 5: ops readiness — counts + mocked-gateway reconciliation + waitlist size.
export default function Ops() {
  const [token, setToken] = useState('');
  const [out, setOut] = useState('');
  async function load(path: string) {
    const r = await fetch(`${API}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((x) => x.json());
    setOut(JSON.stringify(r, null, 2));
  }
  return (
    <main style={{ padding: 24 }}>
      <h1>Ops readiness</h1>
      <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="admin JWT" style={{ width: 400 }} />
      <div>
        <button onClick={() => load('/api/v1/admin/ops')}>Reconciliation</button>
        <button onClick={() => load('/api/v1/admin/waitlist')}>Waitlist</button>
      </div>
      <pre>{out}</pre>
    </main>
  );
}
