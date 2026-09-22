import React, { useState } from 'react';
import { Button, ErrorBox } from './components/ui';
import { apiUrl } from './api';

interface LoginPageProps {
  onLogin: (token: string, user: { id: string; email: string; name: string; platformRole: string }) => void;
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch(apiUrl('/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();

      if (!res.ok || data.error) {
        setError(data.error || data.message || data.hint || 'Login failed');
        return;
      }

      // Get user profile
      const meRes = await fetch(apiUrl('/auth/me'), {
        headers: { Authorization: `Bearer ${data.accessToken}` },
      });
      const user = await meRes.json();

      onLogin(data.accessToken, user);
    } catch {
      setError('Cannot reach the server');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="card login-card">
        <div className="brand" style={{ marginBottom: '0.5rem' }}>
          <span className="brand-mark">H</span>
          Internal Operations Hub
        </div>
        <p className="card-sub">Sign in with your company email</p>

        <form onSubmit={handleLogin}>
          <div className="field">
            <label>Email</label>
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="alice@acme.com"
              required
            />
          </div>
          <div className="field">
            <label>Password</label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your password"
              required
            />
          </div>
          <Button type="submit" block disabled={loading}>
            {loading ? 'Signing in...' : 'Sign In'}
          </Button>
        </form>

        {error && (
          <div style={{ marginTop: '1rem' }}>
            <ErrorBox message={error} />
          </div>
        )}

        <div className="note-info" style={{ marginTop: '1.25rem' }}>
          <strong>Demo accounts</strong> (password for both: <code>Password123!</code>)
          <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.2rem' }}>
            <li><code>admin@acme.com</code> — System Admin</li>
            <li><code>alice@acme.com</code> — Employee</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
