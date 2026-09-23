import React, { useState } from 'react';
import LoginPage from './LoginPage';
import CreateRequestForm from './CreateRequestForm';
import TicketStatusManager from './TicketStatusManager';
import AdminPanel from './AdminPanel';
import { Button } from './components/ui';
import { apiUrl } from './api';

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
  const [catalogVersion, setCatalogVersion] = useState(0);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [focusTicketId, setFocusTicketId] = useState<string | null>(null);

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
    setFocusTicketId(null);
  };

  const refreshInbox = async (t: string = token!) => {
    try {
      const [listRes, countRes] = await Promise.all([
        fetch(apiUrl('/notifications'), { headers: { Authorization: `Bearer ${t}` } }),
        fetch(apiUrl('/notifications/unread-count'), { headers: { Authorization: `Bearer ${t}` } }),
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
    await fetch(apiUrl('/notifications/read-all'), {
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
          <>
            <div
              onClick={() => setInboxOpen(false)}
              style={{ position: 'fixed', inset: 0, zIndex: 40 }}
            />
            <div
              className="card"
              style={{
                position: 'fixed',
                top: '72px',
                right: 'max(1.25rem, calc((100vw - 960px) / 2))',
                width: 'min(380px, calc(100vw - 2.5rem))',
                maxHeight: '60vh',
                overflowY: 'auto',
                zIndex: 41,
                boxShadow: 'var(--shadow-md)',
              }}
            >
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
          </>
        )}

        {focusTicketId ? (
          <TicketStatusManager
            key={refreshKey}
            token={token}
            userId={user.id}
            platformRole={user.platformRole}
            focusTicketId={focusTicketId}
            onBack={() => setFocusTicketId(null)}
          />
        ) : (
          <>
            <CreateRequestForm
              token={token}
              catalogVersion={catalogVersion}
              onCreated={() => { setRefreshKey((k) => k + 1); if (token) refreshInbox(token); }}
            />

            {user.platformRole === 'SYSTEM_ADMIN' && (
              <AdminPanel
                token={token}
                onCatalogChange={() => setCatalogVersion((v) => v + 1)}
              />
            )}

            <h3 style={{ margin: '1.5rem 0 0.75rem', color: 'var(--navy)' }}>Request Queue</h3>
            <TicketStatusManager
              key={refreshKey}
              token={token}
              userId={user.id}
              platformRole={user.platformRole}
              onOpenTicket={(id) => setFocusTicketId(id)}
            />
          </>
        )}
      </main>
    </>
  );
}
