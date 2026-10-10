import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The dev server also proxies the two local services, so the whole demo is reachable under one
// origin (http://localhost:5173 or a Cloudflare tunnel) and passkeys stay bound to that one domain.
const services = {
  '/share': { target: 'http://localhost:8790', changeOrigin: true, rewrite: (path: string) => path.replace(/^\/share/, '') },
  '/hub': { target: 'http://localhost:8787', changeOrigin: true, rewrite: (path: string) => path.replace(/^\/hub/, '') },
}

export default defineConfig({
  plugins: [react()],
  server: { allowedHosts: ['.trycloudflare.com'], proxy: services },
  preview: { allowedHosts: ['.trycloudflare.com'], proxy: services },
  build: {
    rollupOptions: {
      // Two pages: the wallet app and the live presentation (/present).
      input: { main: 'index.html', present: 'present.html' },
    },
  },
})
