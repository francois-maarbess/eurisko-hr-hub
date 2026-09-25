import React from 'react';
import { Button } from './components/ui';
import { en } from './strings/en';

export type AppView = 'overview' | 'my' | 'queue' | 'new' | 'admin' | 'security';

interface NavItem {
  id: AppView;
  label: string;
  staffOnly?: boolean;
  adminOnly?: boolean;
}

const NAV: NavItem[] = [
  { id: 'overview', label: en.nav.overview },
  { id: 'my', label: en.nav.myRequests },
  { id: 'queue', label: en.nav.queue, staffOnly: true },
  { id: 'admin', label: en.nav.administration, adminOnly: true },
  { id: 'security', label: en.nav.security },
];

const VIEW_TITLES: Record<AppView, { title: string; sub: string }> = {
  overview: { title: en.views.overviewTitle, sub: en.views.overviewSub },
  my: { title: en.views.myTitle, sub: en.views.mySub },
  queue: { title: en.views.queueTitle, sub: en.views.queueSub },
  new: { title: en.views.newTitle, sub: en.views.newSub },
  admin: { title: en.views.adminTitle, sub: en.views.adminSub },
  security: { title: en.views.securityTitle, sub: en.views.securitySub },
};

interface AppShellProps {
  userName: string;
  platformRole: string;
  isStaff: boolean;
  isAdmin: boolean;
  activeView: AppView;
  onNavigate: (v: AppView) => void;
  onNewRequest: () => void;
  onQuickSwitcher: () => void;
  onShortcuts: () => void;
  onSignOut: () => void;
  topRight?: React.ReactNode;
  children: React.ReactNode;
  themeMode?: string;
  isDark?: boolean;
  onToggleTheme?: () => void;
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
  onQuickSwitcher,
  onShortcuts,
  onSignOut,
  topRight,
  children,
  themeMode,
  isDark,
  onToggleTheme,
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
              <span className="sidebar-link-marker" aria-hidden="true" />
              <span>{n.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-user">
          <div className="sidebar-user-name">{userName}</div>
          <div className="sidebar-user-role">{platformRole}</div>
          <button onClick={onSignOut} className="sidebar-signout">
            {en.common.signOut}
          </button>
          <button onClick={onShortcuts} className="sidebar-signout" title="Keyboard shortcuts (?)">
            {en.common.shortcuts} <kbd>?</kbd>
          </button>
        </div>      </aside>

      <div className="shell-main">
        <header className="shell-header">
          <div className="shell-header-inner">
            <div>
              <div className="shell-crumb">{ctx.title}</div>
              <div className="shell-sub">{ctx.sub}</div>
            </div>
            <div className="shell-header-actions">
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
              <button className="shell-search-button" onClick={onQuickSwitcher} aria-label="Open quick switcher">
                <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 5 5" /></svg>
                <span>{en.common.search}</span>
                <kbd>⌘K</kbd>
              </button>
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

        <main key={activeView} className="shell-content page-transition">{children}</main>
      </div>
    </div>
  );
}
