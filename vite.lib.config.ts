import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

export default defineConfig({
  plugins: [dts({ include: ['src'], entryRoot: 'src' })],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: () => 'typestory.js',
      cssFileName: 'typestory',
    },
    rollupOptions: { external: ['@chenglou/pretext', /^@chenglou\/pretext\//] },
  },
})
