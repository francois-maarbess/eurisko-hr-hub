import React, { Suspense, useEffect, useState } from 'react';
import LoginPage from './LoginPage';
import CreateRequestForm from './CreateRequestForm';
import TicketStatusManager from './TicketStatusManager';
import ErrorBoundary from './ErrorBoundary';
import AppShell, { type AppView } from './AppShell';
import { Button } from './components/ui';
import QuickSwitcher, { type QuickSwitcherItem } from './components/QuickSwitcher';
import { apiUrl } from './api';

// Lazy-load heavy/below-fold views so first paint stays fast on instructor
// laptops. recharts (Dashboard) and the admin console split out of the
// initial bundle; Suspense falls back to a skeleton.
const Dashboard = React.lazy(() => import('./Dashboard'));
const AdminPanel = React.lazy(() => import('./AdminPanel'));
const MfaSettings = React.lazy(() => import('./MfaSettings'));

function ViewFallback() {
  return (
    <div className="card" aria-label="Loading view" role="status">
      <div className="skeleton-line" style={{ width: '30%' }} />
      <div className="skeleton-line" style={{ width: '60%', marginTop: '0.5rem' }} />
      <div className="skeleton-line" style={{ width: '45%', marginTop: '0.5rem' }} />
    </div>
  );
}

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
  requestId?: string | null;
}

interface QuickTicket {
  id: string;
  title: string;
  status: string;
  view: AppView;
  claimant?: { displayName: string } | null;
}

export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem('hub-refresh-token');
    } catch {
      return null;
    }
  });
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
  const [quickSwitcherOpen, setQuickSwitcherOpen] = useState(false);
  const [quickTickets, setQuickTickets] = useState<QuickTicket[]>([]);

  const handleLogin = (accessToken: string, userData: User, refresh?: string) => {
    setToken(accessToken);
    setUser(userData);
    if (refresh) {
      setRefreshToken(refresh);
      try {
        sessionStorage.setItem('hub-refresh-token', refresh);
      } catch {
        // Private mode: session simply won't survive reloads.
      }
    }
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
    if (token) {
      fetch(apiUrl('/auth/logout'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
    setToken(null);
    setRefreshToken(null);
    try {
      sessionStorage.removeItem('hub-refresh-token');
    } catch {
      // Nothing stored — nothing to clear.
    }
    setUser(null);
    setInbox([]);
    setUnread(0);
    setInboxOpen(false);
    setQuickSwitcherOpen(false);
    setFocusTicketId(null);
    setMemberships([]);
    setActiveView('overview');
  };

  // Silent session renewal: access tokens live 15 minutes; rotate via
  // the stored refresh token every 10. Any failure signs the user out.
  useEffect(() => {
    if (!token || !refreshToken || !user) return;
    const timer = window.setInterval(async () => {
      try {
        const res = await fetch(apiUrl('/auth/refresh'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.accessToken) throw new Error('refresh failed');
        setToken(data.accessToken);
        if (data.refreshToken) {
          setRefreshToken(data.refreshToken);
          try {
            sessionStorage.setItem('hub-refresh-token', data.refreshToken);
          } catch {
            // Private mode: keep going with the in-memory token.
          }
        }
      } catch {
        handleLogout();
      }
    }, 10 * 60_000);
    return () => window.clearInterval(timer);
  }, [token, refreshToken, user]);

  const refreshInbox = async (t: string = token!) => {    try {
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

  const openFromInbox = async (n: InboxItem) => {
    if (!token) return;
    if (!n.readAt) {
      await fetch(apiUrl(`/notifications/${n.id}/read`), {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
      refreshInbox(token);
    }
    if (n.requestId) {
      setInboxOpen(false);
      openTicket(n.requestId);
    }
  };

  const groupedInbox = (() => {
    const groups = new Map<string, InboxItem[]>();
    for (const n of inbox) {
      const key = n.requestId || n.id;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(n);
    }
    return [...groups.entries()];
  })();

  const openTicket = (id: string) => {
    setReturnView(activeView === 'new' || activeView === 'admin' || activeView === 'security' ? 'my' : activeView);
    setFocusTicketId(id);
  };

  useEffect(() => {
    if (focusTicketId) window.scrollTo({ top: 0 });
  }, [focusTicketId]);

  useEffect(() => {
    if (!token) {
      setQuickTickets([]);
      return;
    }
    const queueAvailable = user?.platformRole === 'SYSTEM_ADMIN' || memberships.length > 0;
    const sources: { view: AppView; url: string }[] = [{ view: 'my', url: '/requests?view=mine' }];
    if (queueAvailable) sources.push({ view: 'queue', url: '/requests?view=queue' });
    Promise.all(
      sources.map(async (source) => {
        const response = await fetch(apiUrl(source.url), { headers: { Authorization: `Bearer ${token}` } });
        if (!response.ok) return [] as QuickTicket[];
        const data = await response.json();
        return Array.isArray(data) ? data.slice(0, 12).map((ticket) => ({ ...ticket, view: source.view })) : [];
      }),
    )
      .then((groups) => {
        const unique = new Map<string, QuickTicket>();
        groups.flat().forEach((ticket) => unique.set(ticket.id, ticket));
        setQuickTickets(Array.from(unique.values()));
      })
      .catch(() => setQuickTickets([]));
  }, [token, memberships.length, user?.platformRole, refreshKey]);

  // Power-user keys: c = new request, ? = shortcut help, Escape = back/close.
  // Typing inside inputs is never hijacked.
  useEffect(() => {
    if (!token) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setQuickSwitcherOpen(true);
        return;
      }
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
        setQuickSwitcherOpen(false);
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

  const switcherItems: QuickSwitcherItem[] = [
    { id: 'overview', label: 'Overview', description: 'See workload, SLA health, and attention items.', group: 'Pages', onSelect: () => setActiveView('overview') },
    { id: 'my', label: 'My Requests', description: 'Review requests you submitted.', group: 'Pages', onSelect: () => setActiveView('my') },
    ...(isStaff ? [{ id: 'queue', label: 'Department Queue', description: 'Work your department queue in list or Kanban view.', group: 'Pages', onSelect: () => setActiveView('queue') }] : []),
    { id: 'new', label: 'New Request', description: 'Create and route a service request.', group: 'Actions', onSelect: () => setActiveView('new') },
    ...(isAdmin ? [{ id: 'admin', label: 'Administration', description: 'Manage users, departments, and request types.', group: 'Pages', onSelect: () => setActiveView('admin') }] : []),
    { id: 'security', label: 'Security', description: 'Manage two-factor authentication.', group: 'Pages', onSelect: () => setActiveView('security') },
    ...quickTickets.map((ticket) => ({
      id: `ticket-${ticket.id}`,
      label: ticket.title,
      description: `${ticket.status.replace('_', ' ')}${ticket.claimant ? ` · Claimed by ${ticket.claimant.displayName}` : ''}`,
      group: 'Requests',
      keywords: ticket.view,
      onSelect: () => openTicket(ticket.id),
    })),
  ];

  const notifButton = (
    <button
      className="bell-button"
      onClick={openInbox}
      title={unread > 0 ? `${unread} unread notifications` : 'Notifications'}
      aria-label={unread > 0 ? `${unread} unread notifications` : 'Notifications'}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
      </svg>
      {unread > 0 && (
        <span className="notification-count">
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </button>
  );

  return (
    <>
      {quickSwitcherOpen && <QuickSwitcher items={switcherItems} onClose={() => setQuickSwitcherOpen(false)} />}
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
              {groupedInbox.map(([key, items]) => (
                <div
                  key={key}
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: '10px',
                    overflow: 'hidden',
                  }}
                >
                  {items.map((n, i) => (
                    <button
                      key={n.id}
                      onClick={() => openFromInbox(n)}
                      title={n.requestId ? 'Open the related request' : undefined}
                      style={{
                        display: 'block',
                        width: '100%',
                        textAlign: 'left',
                        border: 'none',
                        borderTop: i === 0 ? 'none' : '1px solid var(--border)',
                        background: n.readAt ? '#fff' : 'var(--blue-pale)',
                        padding: '0.6rem 0.8rem',
                        cursor: n.requestId ? 'pointer' : 'default',
                        font: 'inherit',
                        color: 'inherit',
                      }}
                    >
                      <div style={{ fontWeight: 700, fontSize: '0.85rem' }}>{n.title}</div>
                      <div className="muted" style={{ fontSize: '0.8rem' }}>{n.body}</div>
                    </button>
                  ))}
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
        onQuickSwitcher={() => setQuickSwitcherOpen(true)}
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
            <Suspense fallback={<ViewFallback />}>
              <Dashboard token={token} userName={user.name} isStaff={isStaff} />
            </Suspense>
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
        ) : activeView === 'new' ? (
          <CreateRequestForm
            token={token}
            catalogVersion={catalogVersion}
            onCreated={(id) => {
              setRefreshKey((k) => k + 1);
              if (token) refreshInbox(token);
              // Open the new ticket so the employee sees its reference
              // number, tracker, and what-happens-next immediately.
              if (id) openTicket(id);
              else setActiveView('my');
            }}
          />
        ) : activeView === 'admin' && isAdmin ? (
          <ErrorBoundary section="administration panel">
            <Suspense fallback={<ViewFallback />}>
              <AdminPanel
                token={token}
                onCatalogChange={() => setCatalogVersion((v) => v + 1)}
              />
            </Suspense>
          </ErrorBoundary>
        ) : (
          <ErrorBoundary section="security settings">
            <Suspense fallback={<ViewFallback />}>
              <MfaSettings token={token} />
            </Suspense>
          </ErrorBoundary>
        )}
      </AppShell>
    </>
  );
}
