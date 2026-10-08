'use client';
import { useState } from 'react';
// Phase 0: phone OTP login skeleton. Full session handling in Phase 1.
export default function Login() {
  const [phone, setPhone] = useState('+234');
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState('');
  async function request() {
    const r = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/api/v1/auth/request-otp`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone }),
    }).then((x) => x.json());
    setMsg(JSON.stringify(r));
  }
  async function verify() {
    const r = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/api/v1/auth/verify-otp`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, code, role: 'admin' }),
    }).then((x) => x.json());
    setMsg(JSON.stringify(r));
  }
  return (
    <main style={{ padding: 24 }}>
      <h1>Admin login (OTP)</h1>
      <input value={phone} onChange={(e) => setPhone(e.target.value)} />
      <button onClick={request}>Send code</button>
      <br />
      <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" />
      <button onClick={verify}>Verify</button>
      <pre>{msg}</pre>
    </main>
  );
}
