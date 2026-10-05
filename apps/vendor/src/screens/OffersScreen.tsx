import React, { useState } from 'react';
import { View, Text, Button } from 'react-native';

// Phase 3: rolling offer queue UI skeleton. Shows photo/volume/payout + 60s countdown.
export function OffersScreen({ apiBase, token }: { apiBase: string; token: string }) {
  const [msg, setMsg] = useState('');
  async function load() {
    const r: any = await fetch(`${apiBase}/api/v1/vendor/jobs/offers`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((x) => x.json());
    setMsg(JSON.stringify(r).slice(0, 500));
  }
  return (
    <View>
      <Text>Job offers — Phase 3 (60s rolling queue)</Text>
      <Button title="Load offers" onPress={load} />
      <Text>{msg}</Text>
    </View>
  );
}
