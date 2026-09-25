import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Apply persisted theme before first paint. Light is the default: only
// an explicit stored 'dark' (or a stored 'system' on a dark OS) boots dark.
try {
  const stored = localStorage.getItem('hub-theme-v1');
  const isDark =
    stored === 'dark' ||
    (stored === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  if (isDark) document.documentElement.setAttribute('data-theme', 'dark');
} catch {
  // Private mode / no matchMedia: boot in light theme.
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
