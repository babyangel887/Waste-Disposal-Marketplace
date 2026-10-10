import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Button, ActivityIndicator } from 'react-native';
import { API_BASE, AuthState, apiFetch } from '../api';
import { theme, colors } from '../theme';

export interface EnrichedOffer {
  offer: { id: string; booking_id: string; expires_at: string; status: string; attempt_no: number };
  booking: {
    id: string; category_slug: string; qty: number;
    pickup_address: string; lga_name: string; status: string;
  } | null;
  payout_ngn: number | null;
}

// Rolling offer queue: polls every 5s while open so vendors see and accept
// offers before the expiry window closes. Expired offers are hidden with a
// notice instead of raw JSON.
export function OffersScreen({ auth, onAccepted }: { auth: AuthState; onAccepted: (bookingId: string) => void }) {
  const [offers, setOffers] = useState<EnrichedOffer[]>([]);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [acting, setActing] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const clock = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (silent: boolean) => {
    if (!silent) {
      setBusy(true);
      setMsg('');
    }
    try {
      const r: any = await apiFetch(`${API_BASE}/api/v1/vendor/jobs/offers`, undefined, auth).then((x) => x.json());
      if (Array.isArray(r.offers)) {
        const live = (r.offers as EnrichedOffer[]).filter(
          (o) => o.offer?.status === 'pending' && new Date(o.offer.expires_at).getTime() > Date.now()
        );
        if (live.length < (r.offers as EnrichedOffer[]).length) {
          setMsg('Offer expired');
        } else if (!silent) {
          setMsg(r.offers.length === 0 ? 'No offers right now — new jobs appear automatically.' : '');
        }
        setOffers(live);
      } else if (!silent) {
        setMsg(r?.error ? String(r.error) : 'load failed: ' + JSON.stringify(r).slice(0, 200));
      }
    } catch (e: any) {
      if (!silent) setMsg('load failed: ' + String(e?.message ?? e));
    } finally {
      if (!silent) setBusy(false);
    }
  }, [auth]);

  useEffect(() => {
    load(false);
    timer.current = setInterval(() => { load(true); }, 5000);
    clock.current = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      if (timer.current) clearInterval(timer.current);
      if (clock.current) clearInterval(clock.current);
    };
  }, [load]);

  async function accept(id: string, bookingId: string) {
    setActing(id);
    setMsg('');
    try {
      const r: any = await apiFetch(`${API_BASE}/api/v1/vendor/offers/${id}/accept`, {
        method: 'POST',
      }, auth).then((x) => x.json());
      if (r?.status === 'accepted' || r?.ok) {
        onAccepted(bookingId);
        return;
      }
      if (r?.error === 'offer expired') {
        setMsg('Offer expired');
        load(true);
        return;
      }
      setMsg(r?.error ? String(r.error) : 'accept failed: ' + JSON.stringify(r).slice(0, 200));
    } catch (e: any) {
      setMsg('accept failed: ' + String(e?.message ?? e));
    } finally {
      setActing(null);
    }
  }

  async function decline(id: string) {
    setActing(id);
    setMsg('');
    try {
      const r: any = await apiFetch(`${API_BASE}/api/v1/vendor/offers/${id}/decline`, {
        method: 'POST',
      }, auth).then((x) => x.json());
      if (r?.status === 'declined' || r?.ok) {
        load(true);
        return;
      }
      setMsg(r?.error ? String(r.error) : 'decline failed: ' + JSON.stringify(r).slice(0, 200));
    } catch (e: any) {
      setMsg('decline failed: ' + String(e?.message ?? e));
    } finally {
      setActing(null);
    }
  }

  return (
    <View>
      <View style={theme.card}>
        <Text style={theme.title}>Job offers</Text>
        <Text style={theme.subtitle}>Auto-refreshes every 5 seconds</Text>
        <View style={theme.buttonRow}>
          <Button title="Refresh now" onPress={() => { load(false); }} disabled={busy} />
        </View>
        {busy ? <ActivityIndicator style={{ marginTop: 12 }} /> : null}
        {!!msg && <Text style={theme.msg}>{msg}</Text>}
      </View>
      {offers.map((o) => {
        const secsLeft = Math.max(0, Math.floor((new Date(o.offer.expires_at).getTime() - now) / 1000));
        const b = o.booking;
        return (
          <View key={o.offer.id} style={theme.card}>
            <Text style={theme.title}>{b ? `${b.category_slug} × ${b.qty}` : 'Job'}</Text>
            {!!b && <Text style={theme.subtitle}>{b.pickup_address} · {b.lga_name}</Text>}
            <Text style={theme.label}>Payout: ₦{(o.payout_ngn ?? 0).toLocaleString()}</Text>
            <Text style={[theme.label, { color: secsLeft <= 10 ? colors.danger : colors.text }]}>
              Expires in {secsLeft}s
            </Text>
            <View style={theme.buttonRow}>
              <Button title="Accept" color={colors.primary} disabled={acting !== null} onPress={() => { accept(o.offer.id, o.offer.booking_id); }} />
              <Button title="Decline" color={colors.danger} disabled={acting !== null} onPress={() => { decline(o.offer.id); }} />
            </View>
            {acting === o.offer.id ? <ActivityIndicator style={{ marginTop: 12 }} /> : null}
          </View>
        );
      })}
    </View>
  );
}
