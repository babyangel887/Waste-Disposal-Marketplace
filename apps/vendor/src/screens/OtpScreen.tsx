import React, { useState } from 'react';
import { View, Text, TextInput, Button, ActivityIndicator } from 'react-native';
import { API_BASE } from '../api';
import { theme } from '../theme';

// Same API calls as before: request-otp -> verify-otp (role=vendor).
// The mock OTP code comes back in the response and is shown below the form.
export function OtpScreen({ onToken, notice }: { onToken: (access: string, refresh: string) => void; notice?: string }) {
  const [phone, setPhone] = useState('+234');
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function request() {
    setBusy(true);
    setMsg('');
    try {
      const r = await fetch(`${API_BASE}/api/v1/auth/request-otp`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      }).then((x) => x.json());
      setMsg(JSON.stringify(r));
    } catch (e: any) {
      setMsg('request failed: ' + String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    setMsg('');
    try {
      const r: any = await fetch(`${API_BASE}/api/v1/auth/verify-otp`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code, role: 'vendor' }),
      }).then((x) => x.json());
      if (r.access_token && r.refresh_token) {
        onToken(r.access_token, r.refresh_token);
        return;
      }
      setMsg(JSON.stringify(r));
    } catch (e: any) {
      setMsg('verify failed: ' + String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={theme.card}>
      <Text style={theme.title}>Vendor login</Text>
      <Text style={theme.subtitle}>OTP login as vendor</Text>
      {!!notice && <Text style={theme.msg}>{notice}</Text>}
      <Text style={theme.label}>Phone</Text>
      <TextInput value={phone} onChangeText={setPhone} placeholder="+234..." style={theme.input} keyboardType="phone-pad" />
      <View style={theme.navButton} />
      <Button title="Send code" onPress={request} disabled={busy} />
      <Text style={theme.label}>Code</Text>
      <TextInput value={code} onChangeText={setCode} placeholder="123456" style={theme.input} keyboardType="number-pad" />
      <View style={theme.navButton} />
      <Button title="Verify" onPress={verify} disabled={busy} />
      {busy ? <ActivityIndicator style={{ marginTop: 12 }} /> : null}
      {!!msg && <Text style={theme.msg}>{msg}</Text>}
    </View>
  );
}
