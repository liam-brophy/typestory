import { defineConfig } from 'vite'

// Dev server + deployable demo site. The library build lives in vite.lib.config.ts.
export default defineConfig({
  root: 'demo',
  base: './',
  // Fonts are inlined so the demo is self-contained wherever it's hosted
  // (claude.ai artifacts only allow fonts from data: URIs or Google Fonts).
  build: { outDir: '../dist-demo', emptyOutDir: true, assetsInlineLimit: 200_000 },
  server: { host: true },
})
