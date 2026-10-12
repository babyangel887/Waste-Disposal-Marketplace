import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Button, ActivityIndicator, AppState } from 'react-native';
import { API_BASE, AuthState, apiFetch } from '../api';
import { theme } from '../theme';

const TERMINAL = ['completed', 'cancelled', 'disputed'];
const POLL_MS = 15_000;

// Same API calls: GET /bookings/:id/location (en_route only, privacy boundary)
// plus GET /bookings/:id to watch the job. After a booking is paid the screen
// polls the booking about every 15s and stops on a terminal status
// (completed/cancelled/disputed), on background, or on unmount. Opening the
// screen refreshes immediately. On completed it shows a receipt card.
// AppState is web-safe (react-native-web supports it); no native-only APIs.
export function JobTracking({ auth, bookingId: initialId, onDispute }: {
  auth: AuthState; bookingId?: string; onDispute?: (bookingId: string) => void;
}) {
  const [bookingId, setBookingId] = useState(initialId ?? '');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<any>(null);
  const [watchMsg, setWatchMsg] = useState('');
  const authRef = useRef(auth);
  authRef.current = auth;

  async function load() {
    if (!bookingId.trim()) {
      setMsg('booking id required');
      return;
    }
    setBusy(true);
    try {
      const r: any = await apiFetch(`${API_BASE}/api/v1/bookings/${bookingId.trim()}/location`, undefined, authRef.current).then((x) => x.json());
      setMsg(JSON.stringify(r));
    } catch (e: any) {
      setMsg('load failed: ' + String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const id = bookingId.trim();
    if (!id) {
      setDetail(null);
      setWatchMsg('');
      return;
    }
    let stopped = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    async function tick() {
      if (stopped) return;
      try {
        const r: any = await apiFetch(`${API_BASE}/api/v1/bookings/${id}`, undefined, authRef.current).then((x) => x.json());
        if (stopped) return;
        if (r?.booking) {
          setDetail(r);
          setWatchMsg('');
          if (TERMINAL.includes(r.booking.status)) stop();
        } else {
          setWatchMsg(r?.error ? String(r.error) : 'watch failed');
        }
      } catch (e: any) {
        if (!stopped) setWatchMsg('watch failed: ' + String(e?.message ?? e));
      }
    }
    function stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    }
    function start() {
      stop();
      tick();
      timer = setInterval(tick, POLL_MS);
    }
    start();
    const sub = AppState.addEventListener('change', (s) => {
      if (stopped) return;
      if (s === 'active') start();
      else stop();
    });
    return () => {
      stopped = true;
      stop();
      sub.remove();
    };
  }, [bookingId]);

  const isCompleted = detail?.booking?.status === 'completed';

  return (
    <View style={theme.card}>
      <Text style={theme.title}>Driver location</Text>
      <Text style={theme.subtitle}>Visible only while en_route</Text>
      <Text style={theme.label}>Booking ID</Text>
      <TextInput value={bookingId} onChangeText={setBookingId} placeholder="booking id" style={theme.input} />
      <View style={theme.buttonRow}>
        <Button title="Refresh" onPress={load} disabled={busy} />
      </View>
      {busy ? <ActivityIndicator style={{ marginTop: 12 }} /> : null}
      {!!msg && <Text style={theme.msg}>{msg}</Text>}
      {!!detail?.booking && !isCompleted ? (
        <Text style={theme.msg}>Status: {detail.booking.status} — watching for updates…</Text>
      ) : null}
      {!!watchMsg && <Text style={theme.msg}>{watchMsg}</Text>}
      {isCompleted ? (
        <View style={[theme.card, { marginTop: 12 }]}>
          <Text style={theme.title}>Job completed</Text>
          <Text style={theme.label}>
            Total paid: ₦{(detail.payment?.amount_ngn ?? detail.booking.total_price ?? 0).toLocaleString()}
          </Text>
          <Text style={theme.label}>
            Vendor payout: {detail.payout?.amount_ngn != null ? `₦${detail.payout.amount_ngn.toLocaleString()}` : '—'}
          </Text>
          <Text style={theme.label}>
            Completed: {new Date(detail.booking.updated_at).toLocaleString()}
          </Text>
          <View style={theme.buttonRow}>
            <Button title="Raise dispute" onPress={() => onDispute?.(detail.booking.id)} />
          </View>
        </View>
      ) : null}
    </View>
  );
}
