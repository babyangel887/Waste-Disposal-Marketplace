'use client';
import { useState } from 'react';
import { useAdminSession } from '../admin-auth';
import AdminNav from '../admin-nav';
// Phase 1: vendor queue approve/reject/block. Token comes from the login session.
type Vendor = {
  id: string;
  phone?: string;
  name?: string | null;
  business_name?: string;
  approved_status?: string;
  blocked?: boolean | number;
};
const TABS = ['pending', 'approved', 'blocked'] as const;
export default function Vendors() {
  const { token, ready, logout, authFetch } = useAdminSession();
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [status, setStatus] = useState<(typeof TABS)[number]>('pending');
  async function load(s: (typeof TABS)[number] = status) {
    if (!token) return;
    setStatus(s);
    setErr('');
    setLoading(true);
    try {
      const res = await authFetch(`/api/v1/admin/vendors?status=${s}`);
      const r = await res.json();
      if (!res.ok) throw new Error(r?.error ? String(r.error) : `HTTP ${res.status}`);
      setVendors(Array.isArray(r.vendors) ? r.vendors : []);
    } catch (e: any) {
      setErr('load failed: ' + String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }
  async function act(id: string, action: string) {
    if (!token) return;
    setErr('');
    try {
      const res = await authFetch(`/api/v1/admin/vendors/${id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'reject' ? { reason: 'docs unclear' } : {}),
      });
      const r = await res.json();
      if (!res.ok) throw new Error(r?.error ? String(r.error) : `HTTP ${res.status}`);
      await load();
    } catch (e: any) {
      setErr('action failed: ' + String(e?.message ?? e));
    }
  }
  if (!ready || !token) return <main style={{ padding: 24 }}>Loading…</main>;
  return (
    <main style={{ padding: 24, maxWidth: 900 }}>
      <AdminNav onLogout={logout} />
      <h1>Vendors queue</h1>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {TABS.map((t) => (
          <button key={t} onClick={() => load(t)} disabled={status === t}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      {loading ? <p>Loading…</p> : null}
      {!!err && <p style={{ color: '#b3261e' }}>{err}</p>}
      {!loading && vendors.length === 0 ? <p>No {status} vendors.</p> : null}
      {vendors.map((v) => (
        <div key={v.id} style={{ border: '1px solid #ccc', borderRadius: 8, padding: 12, margin: '12px 0' }}>
          <div><strong>{v.business_name ?? v.id}</strong></div>
          <div>Phone: {v.phone}{v.name ? ` (${v.name})` : ''}</div>
          <div>Status: {v.approved_status}{v.blocked ? ' · blocked' : ''}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button onClick={() => act(v.id, 'approve')}>Approve</button>
            <button onClick={() => act(v.id, 'reject')}>Reject</button>
            <button onClick={() => act(v.id, 'block')}>Block</button>
            <button onClick={() => act(v.id, 'unblock')}>Unblock</button>
          </div>
        </div>
      ))}
    </main>
  );
}
