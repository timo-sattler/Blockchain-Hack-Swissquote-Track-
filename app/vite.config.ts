import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The dev server also proxies the two local services, so the whole demo is reachable under one
// origin (http://localhost:5173 or a Cloudflare tunnel) and passkeys stay bound to that one domain.
// Ports follow the services' own variables, so a second copy of the demo can run next to the first.
const proxy = (prefix: string, port: string) => ({
  target: `http://localhost:${port}`,
  changeOrigin: true,
  rewrite: (path: string) => path.replace(new RegExp(`^${prefix}`), ''),
})
const services = {
  '/share': proxy('/share', process.env.SHARE_PORT ?? '8790'),
  '/hub': proxy('/hub', process.env.HUB_PORT ?? '8787'),
  '/escrow': proxy('/escrow', process.env.ESCROW_PORT ?? '8791'),
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
