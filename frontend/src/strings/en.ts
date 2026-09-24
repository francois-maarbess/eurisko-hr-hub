/**
 * English strings (week-5: add `ar.ts` + a loader for Arabic).
 * Screens import from here instead of hardcoding copy, one file at a time —
 * AppShell is fully migrated; other screens follow the same pattern.
 */
export const en = {
  nav: {
    overview: 'Overview',
    myRequests: 'My Requests',
    queue: 'Department Queue',
    administration: 'Administration',
    security: 'Security',
  },
  views: {
    overviewTitle: 'Overview',
    overviewSub: 'What needs attention, and how the operation is doing.',
    myTitle: 'My Requests',
    mySub: 'Everything you submitted, and where each request stands.',
    queueTitle: 'Department Queue',
    queueSub: 'Open work in your departments, oldest and most urgent first.',
    newTitle: 'New Request',
    newSub: 'Describe the issue once — it routes to the right department.',
    adminTitle: 'Administration',
    adminSub: 'People, catalog, and platform reporting.',
    securityTitle: 'Security',
    securitySub: 'Sign-in protection for your account.',
  },
  common: {
    search: 'Search',
    cancel: 'Cancel',
    close: 'Close',
    save: 'Save',
    retry: 'Retry',
    loading: 'Loading…',
    signOut: 'Sign Out',
    shortcuts: 'Shortcuts',
  },
} as const;

export type Strings = typeof en;
