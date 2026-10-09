'use client';
import { useState } from 'react';
// Admin password login. Tokens are display-only (copy into Admin tools);
// the password lives only in this form's state and is never logged or stored.
export default function Login() {
  const [phone, setPhone] = useState('+234');
  const [password, setPassword] = useState('');
  const [out, setOut] = useState('');
  async function login() {
    setOut('');
    try {
      const r = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/api/v1/auth/admin-login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, password }),
      }).then((x) => x.json());
      if (!r.access_token) {
        setOut('Login failed');
        return;
      }
      setOut(r.access_token);
    } catch {
      setOut('Login failed');
    } finally {
      setPassword('');
    }
  }
  return (
    <main style={{ padding: 24 }}>
      <h1>Admin login</h1>
      <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+234..." />
      <br />
      <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="password" type="password" />
      <button onClick={login}>Login</button>
      <pre>{out}</pre>
    </main>
  );
}
