import React, { useState } from 'react';
import { View, Text, TextInput, Button } from 'react-native';

// Phase 4: raise a dispute on a completed/cancelled booking.
export function DisputeScreen({ apiBase, token, bookingId }: { apiBase: string; token: string; bookingId: string }) {
  const [category, setCategory] = useState('payment');
  const [msg, setMsg] = useState('');
  async function raise() {
    const r: any = await fetch(`${apiBase}/api/v1/disputes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ booking_id: bookingId, category, notes: 'app dispute' }),
    }).then((x) => x.json());
    setMsg(JSON.stringify(r).slice(0, 300));
  }
  return (
    <View>
      <Text>Raise dispute — Phase 4</Text>
      <TextInput value={category} onChangeText={setCategory} placeholder="category" />
      <Button title="Submit" onPress={raise} />
      <Text>{msg}</Text>
    </View>
  );
}
