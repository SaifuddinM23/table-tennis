import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/table-tennis/',
  server: {
    host: '127.0.0.1',
    port: 5175,
    strictPort: true
  }
})
