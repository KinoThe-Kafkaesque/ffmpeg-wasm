import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const isolationHeaders = {
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    headers: isolationHeaders,
  },
  preview: {
    headers: isolationHeaders,
  },
})
