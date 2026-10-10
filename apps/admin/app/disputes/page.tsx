'use client';
import { useCallback, useEffect, useState } from 'react';
import { useAdminSession } from '../admin-auth';
import AdminNav from '../admin-nav';
const API = `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}`;
// Dispute center: open/resolved tabs, per-dispute timeline, resolve form.
type Dispute = {
  id: string;
  booking_id: string;
  raised_by: string;
  raised_by_phone?: string | null;
  category: string;
  notes?: string | null;
  status: string;
  resolution?: string | null;
  created_at: string;
  resolved_at?: string | null;
};
type TimelineEvent = { at?: string; recorded_at?: string; created_at?: string; from_status?: string; to_status?: string; label: string };
const ACTIONS = ['refund_vendor', 'refund_customer', 'split'];
export default function Disputes() {
  const { token, ready, logout } = useAdminSession();
  const [tab, setTab] = useState<'open' | 'resolved'>('open');
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [timelines, setTimelines] = useState<Record<string, TimelineEvent[]>>({});
  const [loadingTl, setLoadingTl] = useState<string | null>(null);
  const [forms, setForms] = useState<Record<string, { action: string; note: string; penalty: string }>>({});

  const load = useCallback(async (s: 'open' | 'resolved') => {
    if (!token) return;
    setLoading(true);
    setErr('');
    try {
      const res = await fetch(`${API}/api/v1/admin/disputes?status=${s}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const r = await res.json();
      if (!res.ok) throw new Error(r?.error ? String(r.error) : `HTTP ${res.status}`);
      setDisputes(Array.isArray(r.disputes) ? r.disputes : []);
    } catch (e: any) {
      setErr('load failed: ' + String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (token) load('open');
  }, [token, load]);

  function switchTab(s: 'open' | 'resolved') {
    setTab(s);
    load(s);
  }

  async function viewTimeline(d: Dispute) {
    if (!token) return;
    if (timelines[d.booking_id]) {
      setTimelines((t) => {
        const next = { ...t };
        delete next[d.booking_id];
        return next;
      });
      return;
    }
    setLoadingTl(d.id);
    setErr('');
    try {
      const res = await fetch(`${API}/api/v1/admin/jobs/${d.booking_id}/timeline`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const r = await res.json();
      if (!res.ok) throw new Error(r?.error ? String(r.error) : `HTTP ${res.status}`);
      const events: TimelineEvent[] = [
        ...(r.history ?? []).map((h: any) => ({ at: h.at, label: `${h.from_status} → ${h.to_status} (by ${h.actor_id})` })),
        ...(r.pings ?? []).map((p: any) => ({ at: p.recorded_at, label: `ping ${p.lat}, ${p.lng}` })),
        ...(r.adjustments ?? []).map((a: any) => ({ at: a.created_at, label: `adjustment ${a.old_total} → ${a.new_total} (${a.status})` })),
      ];
      setTimelines((t) => ({ ...t, [d.booking_id]: events }));
    } catch (e: any) {
      setErr('timeline failed: ' + String(e?.message ?? e));
    } finally {
      setLoadingTl(null);
    }
  }

  async function resolve(d: Dispute) {
    if (!token) return;
    const f = forms[d.id] ?? { action: 'refund_customer', note: '', penalty: '' };
    setErr('');
    try {
      const res = await fetch(`${API}/api/v1/admin/disputes/${d.id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          action: f.action,
          note: f.note || undefined,
          penalty_ngn: f.penalty ? Number(f.penalty) : undefined,
        }),
      });
      const r = await res.json();
      if (!res.ok) throw new Error(r?.error ? String(r.error) : `HTTP ${res.status}`);
      await load(tab);
    } catch (e: any) {
      setErr('resolve failed: ' + String(e?.message ?? e));
    }
  }

  type ResolveForm = { action: string; note: string; penalty: string };
  const blankForm = (): ResolveForm => ({ action: 'refund_customer', note: '', penalty: '' });
  function setForm(id: string, patch: Partial<ResolveForm>) {
    setForms((f) => ({ ...f, [id]: { ...blankForm(), ...(f[id] ?? {}), ...patch } }));
  }

  if (!ready || !token) return <main style={{ padding: 24 }}>Loading…</main>;
  return (
    <main style={{ padding: 24, maxWidth: 900 }}>
      <AdminNav onLogout={logout} />
      <h1>Disputes</h1>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button onClick={() => switchTab('open')} disabled={tab === 'open'}>Open</button>
        <button onClick={() => switchTab('resolved')} disabled={tab === 'resolved'}>Resolved</button>
      </div>
      {loading ? <p>Loading…</p> : null}
      {!!err && <p style={{ color: '#b3261e' }}>{err}</p>}
      {!loading && disputes.length === 0 ? <p>No {tab} disputes.</p> : null}
      {disputes.map((d) => {
        const f = forms[d.id] ?? { action: 'refund_customer', note: '', penalty: '' };
        return (
          <div key={d.id} style={{ border: '1px solid #ccc', borderRadius: 8, padding: 12, margin: '12px 0' }}>
            <div><strong>{d.category}</strong> · {d.status}</div>
            {!!d.notes && <div>Notes: {d.notes}</div>}
            <div>Booking: {d.booking_id}</div>
            <div>Raised by: {d.raised_by_phone ?? d.raised_by}</div>
            <div>Created: {new Date(d.created_at).toLocaleString()}</div>
            {!!d.resolution && <div>Resolution: {d.resolution}</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button onClick={() => viewTimeline(d)} disabled={loadingTl === d.id}>
                {timelines[d.booking_id] ? 'Hide timeline' : 'View timeline'}
              </button>
            </div>
            {timelines[d.booking_id] ? (
              <ul>
                {timelines[d.booking_id].length === 0 ? <li>No events.</li> : null}
                {timelines[d.booking_id].map((e, i) => (
                  <li key={i}>{e.at ? new Date(e.at).toLocaleString() + ' — ' : ''}{e.label}</li>
                ))}
              </ul>
            ) : null}
            {d.status === 'open' ? (
              <div style={{ marginTop: 8, borderTop: '1px solid #eee', paddingTop: 8 }}>
                <div style={{ display: 'flex', gap: 12 }}>
                  {ACTIONS.map((a) => (
                    <label key={a}>
                      <input type="radio" name={`action-${d.id}`} checked={f.action === a} onChange={() => setForm(d.id, { action: a })} />
                      {' '}{a}
                    </label>
                  ))}
                </div>
                <input
                  value={f.note} onChange={(e) => setForm(d.id, { note: e.target.value })}
                  placeholder="resolution note" style={{ width: '100%', marginTop: 8 }}
                />
                {f.action === 'split' ? (
                  <input
                    value={f.penalty} onChange={(e) => setForm(d.id, { penalty: e.target.value })}
                    placeholder="penalty_ngn (vendor share)" type="number" style={{ width: 220, marginTop: 8 }}
                  />
                ) : null}
                <div style={{ marginTop: 8 }}>
                  <button onClick={() => resolve(d)}>Resolve</button>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </main>
  );
}
