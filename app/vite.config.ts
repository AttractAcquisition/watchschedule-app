import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Served from app.watchschedule.com root (custom domain) -> base '/'.
// GitHub Pages SPA deep-link fix lives in index.html + public/404.html (frontend.md §1/§9).
export default defineConfig({
  plugins: [react()],
})
