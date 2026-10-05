'use client';
import { useState } from 'react';
const API = 'http://localhost:4000';
// Phase 1: vendor queue approve/reject/block. Seed-admin JWT required.
export default function Vendors() {
  const [token, setToken] = useState('');
  const [out, setOut] = useState('');
  async function load(status = 'pending') {
    const r = await fetch(`${API}/api/v1/admin/vendors?status=${status}`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((x) => x.json());
    setOut(JSON.stringify(r, null, 2));
  }
  async function act(id: string, action: string) {
    const r = await fetch(`${API}/api/v1/admin/vendors/${id}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(action === 'reject' ? { reason: 'docs unclear' } : {}),
    }).then((x) => x.json());
    setOut(JSON.stringify(r, null, 2));
  }
  return (
    <main style={{ padding: 24 }}>
      <h1>Vendors queue</h1>
      <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="admin JWT" style={{ width: 400 }} />
      <div>
        <button onClick={() => load('pending')}>Pending</button>
        <button onClick={() => load('approved')}>Approved</button>
        <button onClick={() => load('blocked')}>Blocked</button>
      </div>
      <p>Approve/reject: call act(id, &apos;approve&apos; | &apos;reject&apos; | &apos;block&apos; | &apos;unblock&apos;) from console or extend UI.</p>
      <pre>{out}</pre>
    </main>
  );
}
