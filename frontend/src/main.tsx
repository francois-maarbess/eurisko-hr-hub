import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Apply persisted theme before first paint to avoid a light flash.
try {
  const stored = localStorage.getItem('hub-theme-v1');
  let isDark = false;
  if (stored === 'dark') isDark = true;
  else if (stored === 'light') isDark = false;
  else isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  if (isDark) document.documentElement.setAttribute('data-theme', 'dark');
} catch {
  // Private mode / no matchMedia: boot in light theme.
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
