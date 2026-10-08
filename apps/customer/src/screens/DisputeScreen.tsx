import React, { useState } from 'react';
import { View, Text, TextInput, Button, ActivityIndicator } from 'react-native';
import { API_BASE, authHeaders } from '../api';
import { theme } from '../theme';

// Same API call: POST /disputes { booking_id, category, notes }.
export function DisputeScreen({ token, bookingId: initialId }: { token: string; bookingId?: string }) {
  const [bookingId, setBookingId] = useState(initialId ?? '');
  const [category, setCategory] = useState('payment');
  const [notes, setNotes] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function raise() {
    if (!bookingId.trim()) {
      setMsg('booking id required');
      return;
    }
    setBusy(true);
    try {
      const r: any = await fetch(`${API_BASE}/api/v1/disputes`, {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({ booking_id: bookingId.trim(), category, notes: notes || 'app dispute' }),
      }).then((x) => x.json());
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
    </View>
  );
}
