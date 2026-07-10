import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // relative asset paths, so the build works from any subfolder
  // (published at facundo.design/xstitch-font-builder)
  base: './',
  plugins: [react()],
  server: {
    // honor an assigned port (e.g. from preview tooling); default 5173
    port: Number(process.env.PORT) || 5173,
  },
})
