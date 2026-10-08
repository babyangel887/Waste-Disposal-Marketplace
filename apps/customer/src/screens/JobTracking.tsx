import React, { useState } from 'react';
import { View, Text, Button } from 'react-native';

// Phase 3: customer sees vendor location only while en_route (privacy boundary).
export function JobTracking({ apiBase, token, bookingId }: { apiBase: string; token: string; bookingId: string }) {
  const [msg, setMsg] = useState('');
  async function load() {
    const r: any = await fetch(`${apiBase}/api/v1/bookings/${bookingId}/location`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((x) => x.json());
    setMsg(JSON.stringify(r));
  }
  return (
    <View>
      <Text>Driver location (en_route only)</Text>
      <Button title="Refresh" onPress={load} />
      <Text>{msg}</Text>
    </View>
  );
}
