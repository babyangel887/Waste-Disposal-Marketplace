import React, { useState } from 'react';
import { View, Text, TextInput, Button } from 'react-native';

// Shared OTP logic used by customer + vendor (role prop differs).
export function OtpScreen({ apiBase, role = 'customer', onToken }: { apiBase: string; role?: string; onToken: (t: string) => void }) {
  const [phone, setPhone] = useState('+234');
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState('');

  async function request() {
    const r = await fetch(`${apiBase}/api/v1/auth/request-otp`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone }),
    }).then((x) => x.json());
    setMsg(JSON.stringify(r));
  }
  async function verify() {
    const r: any = await fetch(`${apiBase}/api/v1/auth/verify-otp`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, code, role }),
    }).then((x) => x.json());
    setMsg(JSON.stringify(r));
    if (r.access_token) {
      // NDPA consent immediately after signup (PRD §5.1)
      await fetch(`${apiBase}/api/v1/auth/consent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${r.access_token}` },
        body: JSON.stringify({ consent_type: 'privacy_policy', version: 'v1.0-phase0' }),
      });
      onToken(r.access_token);
    }
  }
  return (
    <View>
      <Text>Login ({role}) — Phase 0</Text>
      <TextInput value={phone} onChangeText={setPhone} placeholder="+234..." />
      <Button title="Send code" onPress={request} />
      <TextInput value={code} onChangeText={setCode} placeholder="123456" />
      <Button title="Verify" onPress={verify} />
      <Text>{msg}</Text>
    </View>
  );
}
