import React, { useState } from 'react';
import { View, Text, TextInput, Button, ActivityIndicator } from 'react-native';
import { API_BASE, AuthState, apiFetch } from '../api';
import { theme } from '../theme';

// Same API call as before: POST /vendor/onboarding (all 3 doc keys).
export function OnboardingScreen({ auth, onDone }: { auth: AuthState; onDone: () => void }) {
  const [business, setBusiness] = useState('My Trucks Ltd');
  const [plate, setPlate] = useState('LAG-123XY');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setMsg('');
    try {
      const r: any = await apiFetch(`${API_BASE}/api/v1/vendor/onboarding`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_name: business,
          vehicle: { plate_no: plate, type: 'tipper', capacity_kg: 5000 },
          documents: { vehicle_reg: 'key1', drivers_license: 'key2', business_doc: 'key3' },
        }),
      }, auth).then((x) => x.json());
      setMsg(JSON.stringify(r));
      if (r.status === 'pending' || r.ok) onDone();
    } catch (e: any) {
      setMsg('submit failed: ' + String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={theme.card}>
      <Text style={theme.title}>Vendor onboarding</Text>
      <Text style={theme.subtitle}>Submit for admin review</Text>
      <Text style={theme.label}>Business name</Text>
      <TextInput value={business} onChangeText={setBusiness} style={theme.input} />
      <Text style={theme.label}>Plate number</Text>
      <TextInput value={plate} onChangeText={setPlate} style={theme.input} />
      <View style={theme.buttonRow}>
        <Button title="Submit for review" onPress={submit} disabled={busy} />
      </View>
      {busy ? <ActivityIndicator style={{ marginTop: 12 }} /> : null}
      {!!msg && <Text style={theme.msg}>{msg}</Text>}
    </View>
  );
}
