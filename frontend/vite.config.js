import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // strictPort: false (default) — if 5173 is busy on an instructor's
  // machine, Vite picks the next free port and prints it instead of dying.
  server: {
    port: Number(process.env.VITE_PORT || 5173),
    strictPort: false,
  },
})
