import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// MenuLink build config. SPA on Firebase Hosting.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        // Vendor splitting is deliberate. The previous config declared a
        // `charts: ['recharts']` chunk, which made rollup pull react/react-dom
        // (a dependency shared by recharts and the app) INTO that chunk — so
        // every visitor, diners included, had to download all of recharts +
        // lodash + d3 before React could boot. recharts is only reachable from
        // lazy admin routes, so it is left to rollup's automatic async
        // splitting and React gets a chunk of its own.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react'
          if (/[\\/]node_modules[\\/](react-router|react-router-dom|@remix-run)[\\/]/.test(id)) return 'router'
          // messaging/installations (web push, ~85 kB) is staff- and
          // opt-in-diner-only and is reached through dynamic imports. Keeping it
          // out of the eagerly preloaded `firebase` chunk is the whole point.
          // The `firebase/messaging` facade goes with it, otherwise the facade
          // sits in `firebase` while its implementation sits here and rollup
          // reports a circular chunk.
          if (/[\\/]node_modules[\\/]@firebase[\\/](messaging|installations)[\\/]/.test(id)) return 'fb-messaging'
          if (/[\\/]node_modules[\\/]firebase[\\/]messaging[\\/]/.test(id)) return 'fb-messaging'
          if (/[\\/]node_modules[\\/](firebase|@firebase)[\\/]/.test(id)) return 'firebase'
          return undefined
        },
      },
    },
  },
})
