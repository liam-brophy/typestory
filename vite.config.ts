import { defineConfig } from 'vite'

// Dev server + deployable demo site. The library build lives in vite.lib.config.ts.
export default defineConfig({
  root: 'demo',
  base: './',
  build: { outDir: '../dist-demo', emptyOutDir: true },
  server: { host: true },
})
