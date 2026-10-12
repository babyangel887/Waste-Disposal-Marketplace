import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Button, ActivityIndicator } from 'react-native';
import { API_BASE, AuthState, apiFetch } from '../api';
import { describeDispute } from '../disputeText';
import { theme } from '../theme';

// Same API call: POST /disputes { booking_id, category, notes }.
export function DisputeScreen({ auth, bookingId: initialId }: { auth: AuthState; bookingId?: string }) {
  const [bookingId, setBookingId] = useState(initialId ?? '');
  const [category, setCategory] = useState('payment');
  const [notes, setNotes] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState<any[]>([]);
  const [listMsg, setListMsg] = useState('');

  useEffect(() => {
    let gone = false;
    (async () => {
      try {
        const r: any = await apiFetch(`${API_BASE}/api/v1/disputes/mine`, undefined, auth).then((x) => x.json());
        if (gone) return;
        if (Array.isArray(r?.disputes)) setMine(r.disputes);
        else setListMsg(r?.error ? String(r.error) : 'could not load disputes');
      } catch (e: any) {
        if (!gone) setListMsg('could not load disputes: ' + String(e?.message ?? e));
      }
    })();
    return () => { gone = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function raise() {
    if (!bookingId.trim()) {
      setMsg('booking id required');
      return;
    }
    setBusy(true);
    try {
      const r: any = await apiFetch(`${API_BASE}/api/v1/disputes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ booking_id: bookingId.trim(), category, notes: notes || 'app dispute' }),
      }, auth).then((x) => x.json());
      setMsg(JSON.stringify(r).slice(0, 500));
    } catch (e: any) {
      setMsg('submit failed: ' + String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={theme.card}>
      <Text style={theme.title}>Raise dispute</Text>
      <Text style={theme.subtitle}>Completed / cancelled bookings only</Text>
      <Text style={theme.label}>Booking ID</Text>
      <TextInput value={bookingId} onChangeText={setBookingId} placeholder="booking id" style={theme.input} />
      <Text style={theme.label}>Category</Text>
      <TextInput value={category} onChangeText={setCategory} placeholder="payment" style={theme.input} />
      <Text style={theme.label}>Notes</Text>
      <TextInput value={notes} onChangeText={setNotes} placeholder="what happened?" style={theme.input} multiline />
      <View style={theme.buttonRow}>
        <Button title="Submit" onPress={raise} disabled={busy} />
      </View>
      {busy ? <ActivityIndicator style={{ marginTop: 12 }} /> : null}
      {!!msg && <Text style={theme.msg}>{msg}</Text>}
      <Text style={[theme.title, { marginTop: 16 }]}>My disputes</Text>
      {!!listMsg && <Text style={theme.msg}>{listMsg}</Text>}
      {mine.length === 0 && !listMsg ? <Text style={theme.msg}>No disputes yet.</Text> : null}
      {mine.map((d: any) => (
        <View key={d.id} style={[theme.card, { marginTop: 8 }]}>
          <Text style={theme.label}>{d.category} · {d.status}</Text>
          <Text style={theme.msg}>Booking: {String(d.booking_id).slice(0, 8)}… · {new Date(d.created_at).toLocaleString()}</Text>
          <Text style={theme.msg}>{describeDispute(d)}</Text>
        </View>
      ))}
    </View>
  );
}
