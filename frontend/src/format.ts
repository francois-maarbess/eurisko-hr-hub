/** Shared pure formatters (no components — keeps react-refresh happy). */

/** IN_PROGRESS -> In Progress, EMP_LETTER -> Emp Letter. Never show raw enum/code text to users. */
export function formatEnum(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/** Short human reference for a ticket id, e.g. REQ-9F3K2A. Derived, never stored. */
export function toRef(id: string): string {
  const tail = (id || '').replace(/[^a-zA-Z0-9]/g, '').slice(-6).toUpperCase();
  return `REQ-${(tail || '000000').padStart(6, '0')}`;
}

/**
 * Locale-aware date/time (week-5: pass the active locale from the strings
 * loader instead of `undefined`). One helper so every screen formats
 * timestamps the same way.
 */
export function formatDateTime(iso: string, locale?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d);
}
