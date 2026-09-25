import { useCallback, useEffect, useState } from 'react';

export type ThemeMode = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'hub-theme-v1';

function systemIsDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

function loadMode(): ThemeMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  } catch {
    // Private mode: fall back to light.
  }
  // Light is always the default: everyone starts bright, dark is opt-in.
  return 'light';
}

function applyIsDark(isDark: boolean) {
  const root = document.documentElement;
  if (isDark) root.setAttribute('data-theme', 'dark');
  else root.removeAttribute('data-theme');
  try {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', isDark ? '#0b1220' : '#0f172a');
  } catch {
    // Head mutation is decorative.
  }
}

/**
 * System + toggle theme. Persists `hub-theme-v1`, follows OS in
 * `system` mode, exposes a 3-state cycle for the header button.
 */
export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(() => loadMode());
  // Tracks OS separately so isDark derives without setState-in-effect.
  const [systemDark, setSystemDark] = useState<boolean>(() => systemIsDark());

  const isDark = mode === 'dark' || (mode === 'system' && systemDark);

  useEffect(() => {
    applyIsDark(isDark);
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // Private mode: theme simply doesn't persist.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, systemDark]);

  useEffect(() => {
    let mq: MediaQueryList | null = null;
    try {
      mq = window.matchMedia('(prefers-color-scheme: dark)');
    } catch {
      return;
    }
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    try {
      mq.addEventListener('change', onChange);
    } catch {
      // Older browsers: system theme applies on reload.
      return;
    }
    return () => {
      try {
        mq!.removeEventListener('change', onChange);
      } catch {
        // Teardown best-effort.
      }
    };
  }, []);

  const cycle = useCallback(() => {
    setMode((m) => (m === 'light' ? 'dark' : m === 'dark' ? 'system' : 'light'));
  }, []);

  return { mode, isDark, setMode, cycle };
}
