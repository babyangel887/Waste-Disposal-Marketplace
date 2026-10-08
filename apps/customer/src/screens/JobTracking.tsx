import React, { useState } from 'react';
import { View, Text, TextInput, Button, ActivityIndicator } from 'react-native';
import { API_BASE } from '../api';
import { theme } from '../theme';

// Same API call: GET /bookings/:id/location (en_route only, privacy boundary).
export function JobTracking({ token, bookingId: initialId }: { token: string; bookingId?: string }) {
  const [bookingId, setBookingId] = useState(initialId ?? '');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    if (!bookingId.trim()) {
      setMsg('booking id required');
      return;
    }
    setBusy(true);
    try {
      const r: any = await fetch(`${API_BASE}/api/v1/bookings/${bookingId.trim()}/location`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then((x) => x.json());
      setMsg(JSON.stringify(r));
    } catch (e: any) {
      setMsg('load failed: ' + String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

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
    </View>
  );
}
