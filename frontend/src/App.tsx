import React, { useState } from 'react';
import LoginPage from './LoginPage';
import CreateRequestForm from './CreateRequestForm';
import TicketStatusManager from './TicketStatusManager';
import AdminPanel from './AdminPanel';
import MfaSettings from './MfaSettings';
import ErrorBoundary from './ErrorBoundary';
import Dashboard from './Dashboard';
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
          <div className="topbar-actions">
            <button
              className="notification-button"
              onClick={openInbox}
              title="Notifications"
            >
              Notifications
              {unread > 0 && (
                <span
                  className="notification-count"
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
              className="notification-backdrop"
            />
            <div
              className="card notification-panel"
            >
              <div className="row panel-heading">
                <h3 className="card-title">Notifications</h3>
                <Button variant="ghost" small onClick={markAllRead}>
                  Mark all read
                </Button>
              </div>
              {inbox.length === 0 && <p className="muted">Nothing yet — activity on your requests lands here.</p>}
              <div className="notification-list">
                {inbox.map((n) => (
                  <div
                    key={n.id}
                    className={`notification-item${n.readAt ? '' : ' unread'}`}
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
          <ErrorBoundary section="ticket detail">
            <TicketStatusManager
              key={refreshKey}
              token={token}
              userId={user.id}
              platformRole={user.platformRole}
              focusTicketId={focusTicketId}
              onBack={() => setFocusTicketId(null)}
            />
          </ErrorBoundary>
        ) : (
          <>
            <ErrorBoundary section="dashboard">
              <Dashboard token={token} userName={user.name} />
            </ErrorBoundary>
            <CreateRequestForm
              token={token}
              catalogVersion={catalogVersion}
              onCreated={() => { setRefreshKey((k) => k + 1); if (token) refreshInbox(token); }}
            />

            {user.platformRole === 'SYSTEM_ADMIN' && (
              <ErrorBoundary section="administration panel">
                <AdminPanel
                  token={token}
                  onCatalogChange={() => setCatalogVersion((v) => v + 1)}
                />
              </ErrorBoundary>
            )}

            <h3 className="page-title">Request Queue</h3>
            <ErrorBoundary section="request queue">
              <TicketStatusManager
                key={refreshKey}
                token={token}
                userId={user.id}
                platformRole={user.platformRole}
                onOpenTicket={(id) => setFocusTicketId(id)}
              />
            </ErrorBoundary>
            <MfaSettings token={token} />
          </>
        )}
      </main>
    </>
  );
}
