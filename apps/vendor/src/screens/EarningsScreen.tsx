import React, { useState } from 'react';
import { View, Text, Button } from 'react-native';

// Phase 4: completed payouts + mock transfer status.
export function EarningsScreen({ apiBase, token }: { apiBase: string; token: string }) {
  const [msg, setMsg] = useState('');
  async function load() {
    const r: any = await fetch(`${apiBase}/api/v1/vendor/earnings`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((x) => x.json());
    setMsg(JSON.stringify(r).slice(0, 500));
  }
  return (
    <View>
      <Text>Earnings — Phase 4</Text>
      <Button title="Load earnings" onPress={load} />
      <Text>{msg}</Text>
    </View>
  );
}
