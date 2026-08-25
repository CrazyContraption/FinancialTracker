import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/vault-api': {
        target: 'https://user-vault-api.crazycontraptionmc.workers.dev',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/vault-api/, ''),
      },
    },
  },
})
