import React, { useState } from 'react';
import { Button, ErrorBox } from './components/ui';
import { apiUrl } from './api';

interface LoginPageProps {
  onLogin: (
    token: string,
    user: { id: string; email: string; name: string; platformRole: string },
    refreshToken?: string,
  ) => void;
  themeMode?: string;
  isDark?: boolean;
  onToggleTheme?: () => void;
}

export default function LoginPage({ onLogin, themeMode, isDark, onToggleTheme }: LoginPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');

  const finishLogin = async (accessToken: string, refreshToken?: string) => {
    // Get user profile
    const meRes = await fetch(apiUrl('/auth/me'), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const user = await meRes.json();
    onLogin(accessToken, user, refreshToken);
  };

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

      // Second factor required: hold the password session, ask for the code.
      if (data.mfaRequired) {
        setMfaToken(data.mfaToken);
        setMfaCode('');
        return;
      }

      await finishLogin(data.accessToken, data.refreshToken);
    } catch {
      setError('Cannot reach the server');
    } finally {
      setLoading(false);
    }
  };

  const handleMfaChallenge = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch(apiUrl('/auth/mfa/challenge'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mfaToken, code: mfaCode }),
      });
      const data = await res.json();

      if (!res.ok || data.error) {
        setError(data.error || data.message || 'Invalid authenticator code');
        return;
      }

      await finishLogin(data.accessToken, data.refreshToken);
    } catch {
      setError('Cannot reach the server');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="card login-card login-glow">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="brand auth-brand">
            <span className="brand-mark">H</span>
            Internal Operations Hub
          </div>
          {onToggleTheme && (
            <button
              className="theme-toggle"
              onClick={onToggleTheme}
              title={`Theme: ${themeMode || 'system'} — click to switch`}
              aria-label={`Switch theme (current: ${themeMode || 'system'})`}
            >
              {isDark ? '☾' : '☀'}
            </button>
          )}
        </div>
        <p className="card-sub">Operations cockpit — submit, track, and resolve requests in one calm place.</p>

        {mfaToken ? (
          <form onSubmit={handleMfaChallenge}>
            <div className="field">
              <label>Authenticator code</label>
              <input
                className="input"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
                placeholder="6-digit code"
                required
              />
            </div>
            <Button type="submit" block disabled={loading}>
              {loading ? 'Verifying…' : 'Verify'}
            </Button>
            <p className="muted auth-help">
              Open your authenticator app — or use a saved backup code.
            </p>
          </form>
        ) : (
        <form onSubmit={handleLogin}>
          <div className="field">
            <label>Email</label>
            <input
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
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
        )}

        {error && (
          <div className="auth-error">
            <ErrorBox message={error} />
          </div>
        )}

        <div className="note-info demo-note">
          <strong>Demo accounts</strong> (password for both: <code>Password123!</code>)
          <ul className="demo-list">
            <li><code>admin@acme.com</code> — System Admin</li>
            <li><code>alice@acme.com</code> — Employee</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
