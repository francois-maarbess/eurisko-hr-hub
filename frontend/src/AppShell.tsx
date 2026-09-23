import React from 'react';
import { Button } from './components/ui';

export type AppView = 'overview' | 'my' | 'queue' | 'new' | 'admin' | 'security';

interface NavItem {
  id: AppView;
  label: string;
  staffOnly?: boolean;
  adminOnly?: boolean;
}

const NAV: NavItem[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'my', label: 'My Requests' },
  { id: 'queue', label: 'Department Queue', staffOnly: true },
  { id: 'admin', label: 'Administration', adminOnly: true },
  { id: 'security', label: 'Security' },
];

const VIEW_TITLES: Record<AppView, { title: string; sub: string }> = {
  overview: { title: 'Overview', sub: 'What needs attention, and how the operation is doing.' },
  my: { title: 'My Requests', sub: 'Everything you submitted, and where each request stands.' },
  queue: { title: 'Department Queue', sub: 'Open work in your departments, oldest and most urgent first.' },
  new: { title: 'New Request', sub: 'Describe the issue once — it routes to the right department.' },
  admin: { title: 'Administration', sub: 'People, catalog, and platform reporting.' },
  security: { title: 'Security', sub: 'Sign-in protection for your account.' },
};

interface AppShellProps {
  userName: string;
  platformRole: string;
  isStaff: boolean;
  isAdmin: boolean;
  activeView: AppView;
  onNavigate: (v: AppView) => void;
  onNewRequest: () => void;
  onShortcuts: () => void;
  onSignOut: () => void;
  topRight?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Application shell: sidebar navigation, compact header with page
 * context, and a bounded content column. Role-filtered destinations —
 * employees never see staff or admin views.
 */
export default function AppShell({
  userName,
  platformRole,
  isStaff,
  isAdmin,
  activeView,
  onNavigate,
  onNewRequest,
  onShortcuts,
  onSignOut,
  topRight,
  children,
}: AppShellProps) {
  const items = NAV.filter(
    (n) => (!n.staffOnly || isStaff) && (!n.adminOnly || isAdmin),
  );
  const ctx = VIEW_TITLES[activeView];

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="brand-mark">H</span>
          <span>Service Hub</span>
        </div>
        <nav className="sidebar-nav" aria-label="Primary">
          {items.map((n) => (
            <button
              key={n.id}
              onClick={() => onNavigate(n.id)}
              aria-current={activeView === n.id ? 'page' : undefined}
              className={activeView === n.id ? 'sidebar-link sidebar-link-active' : 'sidebar-link'}
            >
              {n.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-user">
          <div className="sidebar-user-name">{userName}</div>
          <div className="sidebar-user-role">{platformRole}</div>
          <button onClick={onSignOut} className="sidebar-signout">
            Sign Out
          </button>
          <button onClick={onShortcuts} className="sidebar-signout" title="Keyboard shortcuts (?)">
            Shortcuts <kbd>?</kbd>
          </button>
        </div>      </aside>

      <div className="shell-main">
        <header className="shell-header">
          <div className="shell-header-inner">
            <div>
              <div className="shell-crumb">{ctx.title}</div>
              <div className="shell-sub">{ctx.sub}</div>
            </div>
            <div className="row">
              {topRight}
              <Button variant="primary" small onClick={onNewRequest}>
                + New Request
              </Button>
            </div>
          </div>
          <nav className="mobile-nav" aria-label="Primary">
            {items.map((n) => (
              <button
                key={n.id}
                onClick={() => onNavigate(n.id)}
                aria-current={activeView === n.id ? 'page' : undefined}
                className={activeView === n.id ? 'mobile-link mobile-link-active' : 'mobile-link'}
              >
                {n.label}
              </button>
            ))}
          </nav>
        </header>

        <main className="shell-content">{children}</main>
      </div>
    </div>
  );
}
