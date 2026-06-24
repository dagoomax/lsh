import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/react/',
  server: {
    port: 3002,
    host: true,
    proxy: {
      '/api':      { target: 'http://localhost:3001', changeOrigin: true },
      '/socket.io':{ target: 'http://localhost:3001', ws: true, changeOrigin: true }
    }
  }
})
