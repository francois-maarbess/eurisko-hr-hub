import React, { useState } from 'react';
import LoginPage from './LoginPage';
import CreateRequestForm from './CreateRequestForm';
import TicketStatusManager from './TicketStatusManager';
import AdminPanel from './AdminPanel';
import { Button } from './components/ui';

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
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <span className="brand-mark">H</span>
            <span>Service Request Hub</span>
          </div>
          <div className="row">
            <span className="muted">
              {user.name} · {user.platformRole}
            </span>
            <Button variant="danger" small onClick={handleLogout}>
              Sign Out
            </Button>
          </div>
        </div>
      </header>

      <main className="container">
        <CreateRequestForm token={token} onCreated={() => setRefreshKey((k) => k + 1)} />

        {user.platformRole === 'SYSTEM_ADMIN' && <AdminPanel token={token} />}

        <h3 style={{ margin: '1.5rem 0 0.75rem', color: 'var(--navy)' }}>Request Queue</h3>
        <TicketStatusManager key={refreshKey} token={token} userId={user.id} platformRole={user.platformRole} />
      </main>
    </>
  );
}
