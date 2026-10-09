'use client';
import { useState } from 'react';
import { login } from '../lib/api';
import { Button } from './ui/button';
export default function LocalLogin({ onLogin }: { onLogin: () => Promise<void> }) {
  const [username, setUsername] = useState(''),
    [password, setPassword] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <div className="login-screen">
      <section className="panel login-card">
        <div className="eyebrow">UTL-NEXUS / YIELD INTELLIGENCE</div>
        <h1>Welcome back</h1>
        <p>Sign in to your manufacturing workspace.</p>
        <form
          className="query-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            try {
              await login(username, password);
              await onLogin();
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Username
            <input
              autoFocus
              required
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          <Button type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </section>
    </div>
  );
}
