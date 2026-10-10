import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      // Two pages: the wallet app and the live presentation (/present).
      input: { main: 'index.html', present: 'present.html' },
    },
  },
})
