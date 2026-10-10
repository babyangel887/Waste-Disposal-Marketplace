import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Button, ActivityIndicator } from 'react-native';
import * as Location from 'expo-location';
import { API_BASE, AuthState, apiFetch } from '../api';
import { theme } from '../theme';

// Active job after Accept: milestone buttons (en route → arrived → loading →
// complete) plus GPS heartbeats to /tracking/ping while en_route.
export function JobScreen({ auth, bookingId, onDone }: {
  auth: AuthState; bookingId: string; onDone: () => void;
}) {
  const [booking, setBooking] = useState<any>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [pingMsg, setPingMsg] = useState('');
  const pingTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const r: any = await apiFetch(`${API_BASE}/api/v1/bookings/${bookingId}`, undefined, auth).then((x) => x.json());
      if (r?.booking) setBooking(r.booking);
      else setMsg(r?.error ? String(r.error) : 'load failed: ' + JSON.stringify(r).slice(0, 200));
    } catch (e: any) {
      setMsg('load failed: ' + String(e?.message ?? e));
    }
  }, [auth, bookingId]);

  useEffect(() => {
    load();
  }, [load]);

  async function transition(path: string, body?: any) {
    setBusy(true);
    setMsg('');
    try {
      const r: any = await apiFetch(`${API_BASE}/api/v1/vendor/jobs/${bookingId}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      }, auth).then((x) => x.json());
      if (r?.ok || r?.status) {
        await load();
        return;
      }
      setMsg(r?.error ? String(r.error) : 'failed: ' + JSON.stringify(r).slice(0, 200));
    } catch (e: any) {
      setMsg('failed: ' + String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  // GPS heartbeats only while en_route (privacy boundary); 30s cadence.
  useEffect(() => {
    if (booking?.status !== 'en_route') return;
    let stopped = false;
    async function ping() {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted' || stopped) return;
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (stopped) return;
        const r: any = await apiFetch(`${API_BASE}/api/v1/tracking/ping`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            booking_id: bookingId,
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy ?? null,
          }),
        }, auth).then((x) => x.json());
        if (!stopped) setPingMsg(r?.ok ? `location sent ${new Date().toLocaleTimeString()}` : String(r?.error ?? 'ping rejected'));
      } catch (e: any) {
        if (!stopped) setPingMsg('ping failed: ' + String(e?.message ?? e));
      }
    }
    ping();
    pingTimer.current = setInterval(ping, 30_000);
    return () => {
      stopped = true;
      if (pingTimer.current) clearInterval(pingTimer.current);
    };
  }, [booking?.status, auth, bookingId]);

  const status = booking?.status ?? '';
  return (
    <View style={theme.card}>
      <Text style={theme.title}>Job {status ? `· ${status}` : ''}</Text>
      {!!booking && (
        <Text style={theme.subtitle}>
          {booking.category_slug} × {booking.qty} · {booking.pickup_address} · {booking.lga_name}
        </Text>
      )}
      <Text style={theme.label}>Total: ₦{(booking?.total_price ?? 0).toLocaleString()}</Text>
      <View style={theme.buttonRow}>
        <Button title="En route" disabled={busy || status !== 'accepted'} onPress={() => { transition('en-route'); }} />
        <Button title="Arrived" disabled={busy || status !== 'en_route'} onPress={() => { transition('arrived'); }} />
      </View>
      <View style={theme.buttonRow}>
        <Button title="Loading" disabled={busy || status !== 'arrived'} onPress={() => { transition('loading'); }} />
        <Button title="Complete" disabled={busy || !(status === 'arrived' || status === 'loading')} onPress={() => { transition('complete'); }} />
      </View>
      {status === 'en_route' ? <Text style={theme.msg}>Sending GPS location…{pingMsg ? ` ${pingMsg}` : ''}</Text> : null}
      {busy ? <ActivityIndicator style={{ marginTop: 12 }} /> : null}
      {!!msg && <Text style={theme.msg}>{msg}</Text>}
      {status === 'completed' ? (
        <View style={theme.buttonRow}>
          <Button title="Back to offers" onPress={onDone} />
        </View>
      ) : null}
    </View>
  );
}
