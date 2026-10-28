import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      // @nc/shared is imported through one barrel file; its modules have no side effects, so a page that
      // only needs the document helpers must not pull in the calculator engine (math.js) as well.
      treeshake: { moduleSideEffects: (id) => !id.replaceAll('\\', '/').includes('/packages/shared/src/') },
    },
  },
  server: {
    port: 5173,
    // The browser tests run their own API on another port, so they can run next to `pnpm dev`.
    proxy: { '/api': { target: `http://localhost:${process.env.NC_API_PORT ?? 3001}`, changeOrigin: false } },
  },
})
