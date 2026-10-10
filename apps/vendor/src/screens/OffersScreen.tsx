import React, { useState } from 'react';
import { View, Text, Button, ActivityIndicator } from 'react-native';
import { API_BASE, AuthState, apiFetch } from '../api';
import { theme } from '../theme';

// Same API call as before: GET /vendor/jobs/offers (60s rolling queue).
export function OffersScreen({ auth }: { auth: AuthState }) {
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    setMsg('');
    try {
      const r: any = await apiFetch(`${API_BASE}/api/v1/vendor/jobs/offers`, undefined, auth).then((x) => x.json());
      const offers = r.offers ?? r;
      setMsg(JSON.stringify(offers).slice(0, 1000));
    } catch (e: any) {
      setMsg('load failed: ' + String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={theme.card}>
      <Text style={theme.title}>Job offers</Text>
      <Text style={theme.subtitle}>60s rolling queue — approved vendors only</Text>
      <View style={theme.buttonRow}>
        <Button title="Load offers" onPress={load} disabled={busy} />
      </View>
      {busy ? <ActivityIndicator style={{ marginTop: 12 }} /> : null}
      {!!msg && <Text style={theme.msg}>{msg}</Text>}
    </View>
  );
}
