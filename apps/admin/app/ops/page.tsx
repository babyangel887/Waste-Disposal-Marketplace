'use client';
import { useState } from 'react';
import { useAdminSession } from '../admin-auth';
import AdminNav from '../admin-nav';
// Phase 5: ops readiness — counts + mocked-gateway reconciliation + waitlist size.
export default function Ops() {
  const { token, ready, logout, authFetch } = useAdminSession();
  const [out, setOut] = useState('');
  async function load(path: string) {
    if (!token) return;
    const r = await authFetch(path).then((x) => x.json());
    setOut(JSON.stringify(r, null, 2));
  }
  if (!ready || !token) return <main style={{ padding: 24 }}>Loading…</main>;
  return (
    <main style={{ padding: 24 }}>
      <AdminNav onLogout={logout} />
      <h1>Ops readiness</h1>
      <div>
        <button onClick={() => load('/api/v1/admin/ops')}>Reconciliation</button>
        <button onClick={() => load('/api/v1/admin/waitlist')}>Waitlist</button>
      </div>
      <pre>{out}</pre>
    </main>
  );
}
