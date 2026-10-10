'use client';
import { useState } from 'react';
import { useAdminSession } from '../admin-auth';
const API = `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}`;
// Phase 1: vendor queue approve/reject/block. Token comes from the login session.
type Vendor = {
  id: string;
  phone?: string;
  name?: string | null;
  business_name?: string;
  approved_status?: string;
  blocked?: boolean | number;
};
export default function Vendors() {
  const { token, ready, logout } = useAdminSession();
  const [out, setOut] = useState('');
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [status, setStatus] = useState('pending');
  async function load(s = status) {
    if (!token) return;
    setStatus(s);
    setOut('');
    const r = await fetch(`${API}/api/v1/admin/vendors?status=${s}`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((x) => x.json());
    setVendors(Array.isArray(r.vendors) ? r.vendors : []);
    setOut(JSON.stringify(r, null, 2));
  }
  async function act(id: string, action: string) {
    if (!token) return;
    setOut('');
    const r = await fetch(`${API}/api/v1/admin/vendors/${id}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(action === 'reject' ? { reason: 'docs unclear' } : {}),
    }).then((x) => x.json());
    setOut(JSON.stringify(r, null, 2));
    await load();
  }
  if (!ready || !token) return <main style={{ padding: 24 }}>Loading…</main>;
  return (
    <main style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Vendors queue</h1>
        <button onClick={logout}>Log out</button>
      </div>
      <div>
        <button onClick={() => load('pending')}>Pending</button>
        <button onClick={() => load('approved')}>Approved</button>
        <button onClick={() => load('blocked')}>Blocked</button>
      </div>
      {vendors.map((v) => (
        <div key={v.id} style={{ border: '1px solid #ccc', borderRadius: 8, padding: 12, margin: '12px 0' }}>
          <div><strong>{v.business_name ?? v.id}</strong> — {v.phone} {v.name ? `(${v.name})` : ''}</div>
          <div>Status: {v.approved_status}{v.blocked ? ' · blocked' : ''}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button onClick={() => act(v.id, 'approve')}>Approve</button>
            <button onClick={() => act(v.id, 'reject')}>Reject</button>
            <button onClick={() => act(v.id, 'block')}>Block</button>
            <button onClick={() => act(v.id, 'unblock')}>Unblock</button>
          </div>
        </div>
      ))}
      <pre>{out}</pre>
    </main>
  );
}
