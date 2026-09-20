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

interface InboxItem {
  id: string;
  type: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [unread, setUnread] = useState(0);

  const handleLogin = (accessToken: string, userData: User) => {
    setToken(accessToken);
    setUser(userData);
    refreshInbox(accessToken);
  };

  const handleLogout = () => {
    setToken(null);
    setUser(null);
    setInbox([]);
    setUnread(0);
    setInboxOpen(false);
  };

  const refreshInbox = async (t: string = token!) => {
    try {
      const [listRes, countRes] = await Promise.all([
        fetch('http://localhost:3000/notifications', { headers: { Authorization: `Bearer ${t}` } }),
        fetch('http://localhost:3000/notifications/unread-count', { headers: { Authorization: `Bearer ${t}` } }),
      ]);
      if (listRes.ok) setInbox(await listRes.json());
      if (countRes.ok) setUnread((await countRes.json()).count || 0);
    } catch {
      // Inbox is best-effort; the queue below is the source of truth.
    }
  };

  const openInbox = () => {
    setInboxOpen((o) => !o);
    if (token) refreshInbox(token);
  };

  const markAllRead = async () => {
    if (!token) return;
    await fetch('http://localhost:3000/notifications/read-all', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {});
    refreshInbox(token);
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
            <button
              onClick={openInbox}
              title="Notifications"
              style={{
                position: 'relative', border: '1px solid var(--border)', background: '#fff',
                borderRadius: '10px', padding: '0.45rem 0.7rem', cursor: 'pointer', fontSize: '1.05rem',
              }}
            >
              🔔
              {unread > 0 && (
                <span
                  style={{
                    position: 'absolute', top: '-8px', right: '-8px', background: 'var(--danger)',
                    color: '#fff', borderRadius: '999px', minWidth: '20px', height: '20px',
                    fontSize: '0.7rem', fontWeight: 800, display: 'flex',
                    alignItems: 'center', justifyContent: 'center', padding: '0 4px',
                  }}
                >
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </button>
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
        {inboxOpen && (
          <div className="card" style={{ marginBottom: '1.25rem' }}>
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <h3 className="card-title">Notifications</h3>
              <Button variant="ghost" small onClick={markAllRead}>
                Mark all read
              </Button>
            </div>
            {inbox.length === 0 && <p className="muted">Nothing yet — activity on your requests lands here.</p>}
            <div style={{ display: 'grid', gap: '0.5rem' }}>
              {inbox.map((n) => (
                <div
                  key={n.id}
                  style={{
                    background: n.readAt ? '#fff' : 'var(--blue-pale)',
                    border: '1px solid var(--border)',
                    borderRadius: '10px',
                    padding: '0.6rem 0.8rem',
                  }}
                >
                  <div style={{ fontWeight: 700 }}>{n.title}</div>
                  <div className="muted">{n.body}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <CreateRequestForm token={token} onCreated={() => { setRefreshKey((k) => k + 1); if (token) refreshInbox(token); }} />

        {user.platformRole === 'SYSTEM_ADMIN' && <AdminPanel token={token} />}

        <h3 style={{ margin: '1.5rem 0 0.75rem', color: 'var(--navy)' }}>Request Queue</h3>
        <TicketStatusManager key={refreshKey} token={token} userId={user.id} platformRole={user.platformRole} />
      </main>
    </>
  );
}
