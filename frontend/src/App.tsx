import React, { useEffect, useState } from 'react';
import LoginPage from './LoginPage';
import CreateRequestForm from './CreateRequestForm';
import TicketStatusManager from './TicketStatusManager';
import AdminPanel from './AdminPanel';
import MfaSettings from './MfaSettings';
import ErrorBoundary from './ErrorBoundary';
import Dashboard from './Dashboard';
import AppShell, { type AppView } from './AppShell';
import { Button } from './components/ui';
import { apiUrl } from './api';

interface User {
  id: string;
  email: string;
  name: string;
  platformRole: string;
}

interface Membership {
  departmentId: string;
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
  const [activeView, setActiveView] = useState<AppView>('overview');
  const [focusTicketId, setFocusTicketId] = useState<string | null>(null);
  const [returnView, setReturnView] = useState<AppView>('my');
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [catalogVersion, setCatalogVersion] = useState(0);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const handleLogin = (accessToken: string, userData: User) => {
    setToken(accessToken);
    setUser(userData);
    setActiveView('overview');
    setFocusTicketId(null);
    refreshInbox(accessToken);
    fetch(apiUrl('/auth/memberships'), { headers: { Authorization: `Bearer ${accessToken}` } })
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setMemberships(data);
      })
      .catch(() => {});
  };

  const handleLogout = () => {
    setToken(null);
    setUser(null);
    setInbox([]);
    setUnread(0);
    setInboxOpen(false);
    setFocusTicketId(null);
    setMemberships([]);
    setActiveView('overview');
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
      // Inbox is best-effort; the views below are the source of truth.
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

  const openTicket = (id: string) => {
    setReturnView(activeView === 'new' || activeView === 'admin' || activeView === 'security' ? 'my' : activeView);
    setFocusTicketId(id);
  };

  useEffect(() => {
    if (focusTicketId) window.scrollTo({ top: 0 });
  }, [focusTicketId]);

  // Power-user keys: c = new request, ? = shortcut help, Escape = back/close.
  // Typing inside inputs is never hijacked.
  useEffect(() => {
    if (!token) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;
      if (e.key === '?') {
        e.preventDefault();
        setShortcutsOpen((o) => !o);
      } else if (e.key === 'c' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setFocusTicketId(null);
        setActiveView('new');
      } else if (e.key === 'Escape') {
        setShortcutsOpen(false);
        setInboxOpen(false);
        if (focusTicketId) {
          setFocusTicketId(null);
          setActiveView(returnView);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [token, focusTicketId, returnView]);

  if (!token || !user) {
    return <LoginPage onLogin={handleLogin} />;
  }

  const isAdmin = user.platformRole === 'SYSTEM_ADMIN';
  const isStaff = isAdmin || memberships.length > 0;
  const managerKey = `${activeView}-${refreshKey}`;

  const notifButton = (
    <button
      onClick={openInbox}
      title="Notifications"
      style={{
        position: 'relative', border: '1px solid var(--border)', background: '#fff',
        borderRadius: '10px', padding: '0.45rem 0.7rem', cursor: 'pointer', fontSize: '0.85rem',
        fontWeight: 700, color: 'var(--navy)',
      }}
    >
      Notifications
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
  );

  return (
    <>
      {shortcutsOpen && (
        <>
          <div className="modal-backdrop" onClick={() => setShortcutsOpen(false)} />
          <div className="card glass-panel modal-panel" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
            <h3 className="card-title">Keyboard shortcuts</h3>
            <div style={{ display: 'grid', gap: '0.45rem', fontSize: '0.88rem', marginTop: '0.5rem' }}>
              <div className="row" style={{ justifyContent: 'space-between' }}><span>Create a new request</span><kbd>C</kbd></div>
              <div className="row" style={{ justifyContent: 'space-between' }}><span>Draft with AI / submit form</span><kbd>Ctrl + Enter</kbd></div>
              <div className="row" style={{ justifyContent: 'space-between' }}><span>Back to list / close dialogs</span><kbd>Esc</kbd></div>
              <div className="row" style={{ justifyContent: 'space-between' }}><span>This help</span><kbd>?</kbd></div>
            </div>
          </div>
        </>
      )}
      {inboxOpen && (
        <>
          <div
            onClick={() => setInboxOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 40 }}
          />
          <div
            className="card glass-panel"
            style={{
              position: 'fixed',
              top: '72px',
              right: 'max(1.25rem, calc((100vw - 1200px) / 2))',
              width: 'min(380px, calc(100vw - 2.5rem))',
              maxHeight: '60vh',
              overflowY: 'auto',
              zIndex: 41,
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

      <AppShell
        userName={user.name}
        platformRole={user.platformRole}
        isStaff={isStaff}
        isAdmin={isAdmin}
        activeView={focusTicketId ? returnView : activeView}
        onNavigate={(v) => {
          setFocusTicketId(null);
          setActiveView(v);
        }}
        onNewRequest={() => {
          setFocusTicketId(null);
          setActiveView('new');
        }}
        onShortcuts={() => setShortcutsOpen(true)}
        onSignOut={handleLogout}
        topRight={notifButton}
      >
        {focusTicketId ? (
          <ErrorBoundary section="ticket detail">
            <TicketStatusManager
              key={managerKey}
              token={token}
              userId={user.id}
              platformRole={user.platformRole}
              focusTicketId={focusTicketId}
              onBack={() => {
                setFocusTicketId(null);
                setActiveView(returnView);
              }}
            />
          </ErrorBoundary>
        ) : activeView === 'overview' ? (
          <ErrorBoundary section="dashboard">
            <Dashboard token={token} userName={user.name} />
          </ErrorBoundary>
        ) : activeView === 'my' ? (
          <ErrorBoundary section="request queue">
            <TicketStatusManager
              key={managerKey}
              token={token}
              userId={user.id}
              platformRole={user.platformRole}
              initialView="mine"
              onOpenTicket={openTicket}
            />
          </ErrorBoundary>
        ) : activeView === 'queue' ? (
          <ErrorBoundary section="request queue">
            <TicketStatusManager
              key={managerKey}
              token={token}
              userId={user.id}
              platformRole={user.platformRole}
              initialView="queue"
              onOpenTicket={openTicket}
            />
          </ErrorBoundary>
        ) : activeView === 'kanban' ? (
          <ErrorBoundary section="request queue">
            <TicketStatusManager
              key={managerKey}
              token={token}
              userId={user.id}
              platformRole={user.platformRole}
              initialView="queue"
              initialBoard
              onOpenTicket={openTicket}
            />
          </ErrorBoundary>
        ) : activeView === 'new' ? (
          <CreateRequestForm
            token={token}
            catalogVersion={catalogVersion}
            onCreated={() => {
              setRefreshKey((k) => k + 1);
              if (token) refreshInbox(token);
              setActiveView('my');
            }}
          />
        ) : activeView === 'admin' && isAdmin ? (
          <ErrorBoundary section="administration panel">
            <AdminPanel
              token={token}
              onCatalogChange={() => setCatalogVersion((v) => v + 1)}
            />
          </ErrorBoundary>
        ) : (
          <ErrorBoundary section="security settings">
            <MfaSettings token={token} />
          </ErrorBoundary>
        )}
      </AppShell>
    </>
  );
}
