/**
 * Single source of truth for the backend address. Every screen imports
 * this instead of hardcoding the URL — moving environments (or going to
 * production) is a one-line change, not a 30-file hunt.
 */
export const API_BASE = (import.meta as any).env?.VITE_API_BASE || 'http://localhost:3000';

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}
