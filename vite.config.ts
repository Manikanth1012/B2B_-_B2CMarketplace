import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
  },
  build: {
    rollupOptions: {
      output: {
        /* Libraries every surface needs, in chunks of their own: they change
           far less often than the app, so they stay cached across deploys,
           and they keep the entry chunk to the app's own shell. lucide-react
           is grouped too, because left alone it becomes one tiny chunk per
           icon shared between two screens. */
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'vendor-react'
          if (/[\\/]node_modules[\\/](@supabase|iceberg-js)[\\/]/.test(id)) return 'vendor-supabase'
          if (/[\\/]node_modules[\\/]lucide-react[\\/]/.test(id)) return 'vendor-icons'
          return undefined
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
})
