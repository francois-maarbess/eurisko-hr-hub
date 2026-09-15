import React, { useState } from 'react';

interface LoginPageProps {
  onLogin: (token: string, user: { id: string; email: string; name: string; platformRole: string }) => void;
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('http://localhost:3000/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();

      if (!res.ok || data.error) {
        setError(data.error || data.hint || 'Login failed');
        return;
      }

      // Get user profile
      const meRes = await fetch('http://localhost:3000/auth/me', {
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
    <div style={{ fontFamily: 'sans-serif', padding: '2rem', maxWidth: '400px', margin: '0 auto' }}>
      <h2>Internal Operations Service Hub</h2>
      <p style={{ color: '#666' }}>Sign in with your company email</p>

      <form onSubmit={handleLogin} style={{ marginTop: '1.5rem' }}>
        <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600 }}>Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="alice@acme.com"
          required
          style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid #ccc', boxSizing: 'border-box', fontSize: '1rem' }}
        />
        <button
          type="submit"
          disabled={loading}
          style={{ marginTop: '1rem', width: '100%', padding: '0.75rem', borderRadius: '8px', border: 'none', background: '#007bff', color: '#fff', fontSize: '1rem', cursor: 'pointer' }}
        >
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
      </form>

      {error && (
        <div style={{ marginTop: '1rem', background: '#f8d7da', color: '#721c24', padding: '0.75rem', borderRadius: '8px' }}>
          {error}
        </div>
      )}

      <div style={{ marginTop: '2rem', padding: '1rem', background: '#f8f9fa', borderRadius: '8px', fontSize: '0.85rem', color: '#555' }}>
        <strong>Demo accounts:</strong>
        <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.2rem' }}>
          <li><code>alice@acme.com</code> — Employee (can create requests)</li>
          <li><code>bob@acme.com</code> — IT Agent (can claim & resolve)</li>
          <li><code>admin@acme.com</code> — System Admin</li>
        </ul>
      </div>
    </div>
  );
}
