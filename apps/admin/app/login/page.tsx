'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SESSION_EXPIRED_MSG, storeAdminSession, takeExpiredFlag } from '../admin-auth';
// Admin password login. Both tokens go to sessionStorage and the user is
// sent to /vendors; the password lives only in this form's state and is
// never logged or stored.
export default function Login() {
  const router = useRouter();
  const [phone, setPhone] = useState('+234');
  const [password, setPassword] = useState('');
  const [out, setOut] = useState('');
  useEffect(() => {
    if (takeExpiredFlag()) setOut(SESSION_EXPIRED_MSG);
  }, []);
  async function login() {
    setOut('');
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/api/v1/auth/admin-login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, password }),
      });
      if (res.status === 429) {
        setOut('Too many attempts, try again later');
        return;
      }
      const r = await res.json();
      if (!r.access_token || !r.refresh_token) {
        setOut('Login failed');
        return;
      }
      storeAdminSession(r.access_token, r.refresh_token);
      router.push('/vendors');
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
