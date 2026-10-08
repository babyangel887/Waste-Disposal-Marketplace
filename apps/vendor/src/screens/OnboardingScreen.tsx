import React, { useState } from 'react';
import { View, Text, TextInput, Button } from 'react-native';

const API = 'http://10.0.2.2:4000';

// Phase 1: vendor onboarding form. Requires all 3 doc keys (from presigned uploads).
export function OnboardingScreen({ token, onDone }: { token: string; onDone: () => void }) {
  const [business, setBusiness] = useState('My Trucks Ltd');
  const [plate, setPlate] = useState('LAG-123XY');
  const [msg, setMsg] = useState('');
  async function submit() {
    const r: any = await fetch(`${API}/api/v1/vendor/onboarding`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        business_name: business,
        vehicle: { plate_no: plate, type: 'tipper', capacity_kg: 5000 },
        documents: { vehicle_reg: 'key1', drivers_license: 'key2', business_doc: 'key3' },
      }),
    }).then((x) => x.json());
    setMsg(JSON.stringify(r));
    if (r.status === 'pending') onDone();
  }
  return (
    <View>
      <Text>Vendor onboarding — Phase 1</Text>
      <TextInput value={business} onChangeText={setBusiness} />
      <TextInput value={plate} onChangeText={setPlate} />
      <Button title="Submit for review" onPress={submit} />
      <Text>{msg}</Text>
    </View>
  );
}
