// Post-build: fold the demo's JS and CSS into dist-demo/index.html so the demo
// is a single self-contained file. Needed for hosts that serve pages from a
// sandboxed, origin-less frame (e.g. claude.ai artifacts), where Vite's
// `crossorigin` <script>/<link> tags are blocked by CORS.
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const dir = 'dist-demo'
let html = readFileSync(join(dir, 'index.html'), 'utf8')

html = html.replace(/<script type="module" crossorigin src="\.\/(assets\/[^"]+\.js)"><\/script>/, (_, file) => {
  const js = readFileSync(join(dir, file), 'utf8').replace(/<\/script/gi, '<\\/script')
  return `<script type="module">${js}</script>`
})
html = html.replace(/<link rel="stylesheet" crossorigin href="\.\/(assets\/[^"]+\.css)">/, (_, file) => {
  // Keep woff2 only; every browser that runs the reader supports it.
  const css = readFileSync(join(dir, file), 'utf8').replace(/,\s*url\(data:font\/woff;base64,[^)]+\) format\(["']woff["']\)/g, '')
  return `<style>${css}</style>`
})

if (/crossorigin|\.\/assets\//.test(html)) throw new Error('inline-demo: an asset reference was not inlined')
// Guard against the reader's stylesheet being tree-shaken out of the build again.
for (const sel of ['.ts-column', '.ts-rule', '.ts-rail', '.ts-line']) {
  if (!html.includes(sel)) throw new Error(`inline-demo: built CSS is missing ${sel}`)
}
writeFileSync(join(dir, 'index.html'), html)
rmSync(join(dir, 'assets'), { recursive: true, force: true })
console.log(`inline-demo: dist-demo/index.html ${(html.length / 1024).toFixed(0)} kB, single file`)
