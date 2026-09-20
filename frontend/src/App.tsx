import React, { useState } from 'react';
import LoginPage from './LoginPage';
import CreateRequestForm from './CreateRequestForm';
import TicketStatusManager from './TicketStatusManager';
import AdminPanel from './AdminPanel';

interface User {
  id: string;
  email: string;
  name: string;
  platformRole: string;
}

export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleLogin = (accessToken: string, userData: User) => {
    setToken(accessToken);
    setUser(userData);
  };

  const handleLogout = () => {
    setToken(null);
    setUser(null);
  };

  if (!token || !user) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return (
    <div style={{ fontFamily: 'sans-serif', padding: '1rem', maxWidth: '900px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h2 style={{ margin: 0 }}>Service Request Hub</h2>
          <div style={{ fontSize: '0.85rem', color: '#666' }}>
            Signed in as <strong>{user.name}</strong> ({user.email}) · {user.platformRole}
          </div>
        </div>
        <button onClick={handleLogout} style={{ padding: '0.5rem 1rem', borderRadius: '8px', border: 'none', background: '#dc3545', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>Sign Out</button>
      </div>

      <CreateRequestForm token={token} onCreated={() => setRefreshKey((k) => k + 1)} />

      {user.platformRole === 'SYSTEM_ADMIN' && <AdminPanel token={token} />}

      <h3 style={{ marginBottom: '0.75rem' }}>Request Queue</h3>
      <TicketStatusManager key={refreshKey} token={token} />
    </div>
  );
}
