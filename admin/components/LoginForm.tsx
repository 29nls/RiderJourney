'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError } from '@/lib/client';

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new ApiError(response.status, body.code ?? 'LOGIN_FAILED', body.title ?? 'Login gagal', body.detail);
      }
      router.replace('/');
      router.refresh();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.detail ?? cause.title : 'Tidak dapat menghubungi server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack loginForm" onSubmit={submit}>
      <label className="field">
        <span>Email</span>
        <input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required />
      </label>
      <label className="field">
        <span>Kata sandi</span>
        <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
      </label>
      {error && <p className="formError" role="alert">{error}</p>}
      <button type="submit" className="button primary" disabled={busy}>
        {busy ? 'Memeriksa...' : 'Masuk'}
      </button>
    </form>
  );
}
