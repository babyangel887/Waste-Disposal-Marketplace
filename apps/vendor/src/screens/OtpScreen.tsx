import React, { useState } from 'react';
import { View, Text, TextInput, Button } from 'react-native';

const API = 'http://10.0.2.2:4000';

export function OtpScreen({ onToken }: { onToken: (t: string) => void }) {
  const [phone, setPhone] = useState('+234');
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState('');
  async function request() {
    const r = await fetch(`${API}/api/v1/auth/request-otp`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone }),
    }).then((x) => x.json());
    setMsg(JSON.stringify(r));
  }
  async function verify() {
    const r: any = await fetch(`${API}/api/v1/auth/verify-otp`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, code, role: 'vendor' }),
    }).then((x) => x.json());
    setMsg(JSON.stringify(r));
    if (r.access_token) onToken(r.access_token);
  }
  return (
    <View>
      <Text>Vendor login — Phase 0</Text>
      <TextInput value={phone} onChangeText={setPhone} />
      <Button title="Send code" onPress={request} />
      <TextInput value={code} onChangeText={setCode} placeholder="123456" />
      <Button title="Verify" onPress={verify} />
      <Text>{msg}</Text>
    </View>
  );
}
