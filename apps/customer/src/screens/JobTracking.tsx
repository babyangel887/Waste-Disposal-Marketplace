import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Button, ActivityIndicator, AppState, Linking } from 'react-native';
import { API_BASE, AuthState, apiFetch } from '../api';
import { theme } from '../theme';
import { DriverMap, mapsLink } from './DriverMap';

const TERMINAL = ['completed', 'cancelled', 'disputed'];
const WATCH_MS = 15_000;
const DRIVER_MS = 10_000;

type MineRow = {
  id: string; category_slug: string; qty: number;
  pickup_address: string; lga_name: string; status: string; created_at: string;
};

function statusLine(status: string): string {
  switch (status) {
    case 'awaiting_payment': return 'Waiting for payment';
    case 'searching_vendor':
    case 'offered': return 'Finding your driver…';
    case 'accepted': return 'Driver assigned';
    case 'en_route': return 'Driver is on the way';
    case 'arrived': return 'Driver has arrived';
    case 'loading': return 'Loading your waste…';
    case 'adjustment_pending': return 'Quote review in progress';
    case 'completed': return 'Job completed';
    case 'cancelled': return 'Booking cancelled';
    case 'disputed': return 'Booking disputed';
    default: return `Status: ${status}`;
  }
}

// Post-booking screen: pick from your bookings (or the one you just paid),
// watch it to a terminal state, and see the driver on a map while en_route.
// Booking detail refreshes on open and every 15s; the driver pin refreshes
// every 10s only while en_route. Both stop on background/unmount.
// Web-safe: AppState + Linking work on web; the map uses an iframe there.
export function JobTracking({ auth, bookingId: initialId, onDispute }: {
  auth: AuthState; bookingId?: string; onDispute?: (bookingId: string) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(initialId ?? null);
  const [mine, setMine] = useState<MineRow[]>([]);
  const [listMsg, setListMsg] = useState('');
  const [manualId, setManualId] = useState('');
  const [detail, setDetail] = useState<any>(null);
  const [pos, setPos] = useState<{ lat: number; lng: number; recorded_at: string } | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const authRef = useRef(auth);
  authRef.current = auth;

  // A fresh booking (e.g. just paid) takes over the screen automatically.
  useEffect(() => {
    if (initialId) setSelectedId(initialId);
  }, [initialId]);

  const fetchDetail = useCallback(async (id: string) => {
    const r: any = await apiFetch(`${API_BASE}/api/v1/bookings/${id}`, undefined, authRef.current).then((x) => x.json());
    return r;
  }, []);

  const fetchPos = useCallback(async (id: string) => {
    try {
      const r: any = await apiFetch(`${API_BASE}/api/v1/bookings/${id}/location`, undefined, authRef.current).then((x) => x.json());
      if (r?.last) setPos(r.last);
      return r;
    } catch {
      return null;
    }
  }, []);

  // Booking list once (drives the picker when there is no booking context).
  useEffect(() => {
    let gone = false;
    (async () => {
      try {
        const r: any = await apiFetch(`${API_BASE}/api/v1/bookings/mine`, undefined, authRef.current).then((x) => x.json());
        if (gone) return;
        if (Array.isArray(r?.bookings)) {
          setMine(r.bookings);
          setListMsg('');
        } else {
          setListMsg(r?.error ? String(r.error) : 'could not load bookings');
        }
      } catch (e: any) {
        if (!gone) setListMsg('could not load bookings: ' + String(e?.message ?? e));
      }
    })();
    return () => { gone = true; };
  }, []);

  // Watch the selected booking to a terminal state.
  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setPos(null);
      setMsg('');
      return;
    }
    let stopped = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    async function tick() {
      if (stopped) return;
      try {
        const r: any = await apiFetch(`${API_BASE}/api/v1/bookings/${selectedId}`, undefined, authRef.current).then((x) => x.json());
        if (stopped) return;
        if (r?.booking) {
          setDetail(r);
          setMsg('');
          if (TERMINAL.includes(r.booking.status)) stop();
        } else {
          setMsg(r?.error ? String(r.error) : 'watch failed');
        }
      } catch (e: any) {
        if (!stopped) setMsg('watch failed: ' + String(e?.message ?? e));
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
      timer = setInterval(tick, WATCH_MS);
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
  }, [selectedId]);

  // Driver pin: 10s refresh only while en_route.
  const isEnRoute = detail?.booking?.status === 'en_route';
  useEffect(() => {
    if (!selectedId || !isEnRoute) return;
    const id: string = selectedId;
    let stopped = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    async function tick() {
      if (stopped) return;
      await fetchPos(id);
    }
    tick();
    timer = setInterval(tick, DRIVER_MS);
    const sub = AppState.addEventListener('change', (s) => {
      if (stopped) return;
      if (s === 'active') {
        tick();
        if (!timer) timer = setInterval(tick, DRIVER_MS);
      } else if (timer) {
        clearInterval(timer);
        timer = null;
      }
    });
    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
      sub.remove();
    };
  }, [selectedId, isEnRoute, fetchPos]);

  async function refreshNow() {
    if (!selectedId) return;
    setBusy(true);
    try {
      const r: any = await apiFetch(`${API_BASE}/api/v1/bookings/${selectedId}`, undefined, authRef.current).then((x) => x.json());
      if (r?.booking) {
        setDetail(r);
        setMsg('');
      } else {
        setMsg(r?.error ? String(r.error) : 'refresh failed');
      }
      await fetchPos(selectedId);
    } catch (e: any) {
      setMsg('refresh failed: ' + String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  function openMaps(url: string) {
    Linking.openURL(url).catch((e: any) => setMsg('could not open maps: ' + String(e?.message ?? e)));
  }

  const isCompleted = detail?.booking?.status === 'completed';
  const pickup = detail?.booking
    ? { lat: detail.booking.pickup_lat, lng: detail.booking.pickup_lng, label: 'Pickup', color: 'pickup' as const }
    : null;

  return (
    <View style={theme.card}>
      <Text style={theme.title}>Track driver</Text>

      {!selectedId ? (
        <>
          <Text style={theme.subtitle}>Choose one of your bookings</Text>
          {mine.map((b) => (
            <View key={b.id} style={theme.buttonRow}>
              <Button
                title={`${b.category_slug} × ${b.qty} — ${b.status}`}
                onPress={() => setSelectedId(b.id)}
              />
            </View>
          ))}
          {!!listMsg && (
            <>
              <Text style={theme.msg}>{listMsg}</Text>
              <Text style={theme.label}>Booking ID</Text>
              <TextInput value={manualId} onChangeText={setManualId} placeholder="booking id" style={theme.input} />
              <View style={theme.buttonRow}>
                <Button title="Track" onPress={() => { if (manualId.trim()) setSelectedId(manualId.trim()); }} />
              </View>
            </>
          )}
        </>
      ) : (
        <>
          <View style={theme.buttonRow}>
            <Button title="All bookings" onPress={() => setSelectedId(null)} />
            <Button title="Refresh" onPress={refreshNow} disabled={busy} />
          </View>
          {busy ? <ActivityIndicator style={{ marginTop: 12 }} /> : null}
          {!!detail?.booking && !isCompleted ? (
            <Text style={theme.msg}>{statusLine(detail.booking.status)} — watching for updates…</Text>
          ) : null}
          {!!msg && <Text style={theme.msg}>{msg}</Text>}

          {isEnRoute && pickup ? (
            <DriverMap
              driver={pos ? { lat: pos.lat, lng: pos.lng, label: 'Driver', color: 'driver' } : null}
              pickup={pickup}
              onOpenMaps={openMaps}
              onMapError={() => setMsg('Map unavailable offline.')}
            />
          ) : null}
          {isEnRoute && !pos ? (
            <Text style={theme.msg}>Waiting for the driver&apos;s first location…</Text>
          ) : null}
          {isEnRoute && pos ? (
            <Text style={theme.msg}>Last updated: {new Date(pos.recorded_at).toLocaleString()}</Text>
          ) : null}
          {isEnRoute ? (
            <View style={theme.buttonRow}>
              <Button
                title="Open in Google Maps"
                onPress={() => {
                  const ref = pos ?? pickup;
                  if (ref) openMaps(mapsLink(ref.lat, ref.lng));
                }}
              />
            </View>
          ) : null}

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
        </>
      )}
    </View>
  );
}
