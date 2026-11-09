// Headless check for EPUB import and reader settings.
// Run `python3 scripts/make-epubs.py` first to create the fixtures.
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { mkdirSync, existsSync } from 'node:fs'

// Use $CHROME or a system Chrome on Linux; otherwise Playwright's own Chromium
// (install once with: npx playwright install chromium).
function chromeOptions() {
  const path = process.env.CHROME ?? (existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined)
  return path ? { executablePath: path } : {}
}

const out = new URL('./out/', import.meta.url).pathname
mkdirSync(out, { recursive: true })
const server = await createServer({ configFile: 'vite.config.ts', server: { port: 5196 }, logLevel: 'error' })
await server.listen()
const browser = await chromium.launch(chromeOptions())
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
const errors = []
page.on('pageerror', e => errors.push(e.message))
page.on('console', m => m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text()) && errors.push(m.text()))
await page.goto('http://localhost:5196/?sample')
await page.waitForSelector('.ts-root.is-ready')
const results = {}

// Same check as browser-check: does every painted, unshaped block wrap as the browser would?
const compareWrapping = () => page.evaluate(() => {
  let checked = 0
  const mismatched = []
  for (const el of document.querySelectorAll('.ts-paragraph, .ts-quote, .ts-heading, .ts-subhead')) {
    const b = window.reader.doc.blocks[+el.dataset.block]
    if (!b || b.shaped) continue
    const lines = [...el.querySelectorAll('.ts-line')]
    if (!lines.length) continue
    const cs = getComputedStyle(el)
    const probe = document.createElement('div')
    Object.assign(probe.style, {
      position: 'absolute', visibility: 'hidden', left: '0', top: '0', width: `${b.right - b.left}px`,
      font: cs.font, lineHeight: cs.lineHeight, overflowWrap: 'break-word', whiteSpace: 'normal',
      textIndent: `${b.firstIndent}px`,
    })
    probe.innerHTML = lines.map(l => l.innerHTML).join(' ')
    document.body.append(probe)
    const n = Math.round(probe.getBoundingClientRect().height / parseFloat(cs.lineHeight))
    probe.remove()
    checked++
    if (n !== lines.length) mismatched.push({ text: lines[0].textContent.slice(0, 30), pretext: lines.length, browser: n })
  }
  return { checked, mismatched }
})

// ── settings: every pairing, at every size extreme, indented paragraphs
results.pairings = {}
const pairings = await page.evaluate(() => [...document.querySelectorAll('.ts-set-pairing')].map(b => b.dataset.value))
await page.click('.ts-settings-button')
for (const id of pairings) {
  await page.click(`.ts-set-pairing[data-value="${id}"]`)
  await page.waitForTimeout(350)
  const wrap = await compareWrapping()
  const font = await page.evaluate(() => getComputedStyle(document.querySelector('.ts-paragraph')).fontFamily)
  results.pairings[id] = { font: font.split(',')[0], ...wrap }
}
await page.screenshot({ path: out + 'settings-open.png' })

await page.click('.ts-set-pairing[data-value="classic"]')
await page.click('.ts-set-segment[data-value="indented"]')
await page.click('.ts-set-segment[data-value="loose"]')
await page.click('.ts-set-step.is-large')
await page.click('.ts-set-swatch[data-value="dark"]')
await page.waitForTimeout(400)
results.combo = await compareWrapping()
await page.keyboard.press('Escape')
await page.waitForTimeout(200)
await page.screenshot({ path: out + 'settings-classic-indented-dark.png' })

// Keeps your place: scroll into chapter 3, change size, chapter should be unchanged.
await page.evaluate(() => window.reader.goToChapter(2, 'instant'))
await page.mouse.wheel(0, 500)
await page.waitForTimeout(300)
const before = await page.evaluate(() => window.reader.position)
await page.click('.ts-settings-button')
await page.click('.ts-set-step.is-small')
await page.click('.ts-set-segment[data-value="narrow"]')
await page.waitForTimeout(400)
const after = await page.evaluate(() => window.reader.position)
results.keepsPlace = { before, after }
results.persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('typestory:settings')))

// ── EPUB import
const input = page.locator('.ts-settings input[type=file]')
async function open(file) {
  await page.evaluate(() => { document.querySelector('.ts-set-status').textContent = '' })
  await input.setInputFiles(`scripts/fixtures/${file}`)
  await page.waitForFunction(() => /chapters|Couldn|not a readable|No readable|DRM/.test(document.querySelector('.ts-set-status')?.textContent ?? ''), null, { timeout: 30000 })
  return page.evaluate(() => {
    const b = window.reader.book
    const blocks = b.chapters.flatMap(c => c.blocks)
    return {
      status: document.querySelector('.ts-set-status').textContent,
      title: b.title, author: b.author,
      chapters: b.chapters.map(c => c.title).slice(0, 8),
      chapterCount: b.chapters.length,
      kinds: blocks.reduce((m, x) => ((m[x.kind] = (m[x.kind] ?? 0) + 1), m), {}),
      italicRuns: blocks.filter(x => x.runs?.some(r => r.em)).length,
      firstPara: blocks.find(x => x.kind === 'paragraph')?.runs.map(r => r.text).join('').slice(0, 60),
      railTicks: document.querySelectorAll('.ts-rail-item').length,
    }
  })
}
await page.click('.ts-set-swatch[data-value="light"]')
await page.click('.ts-set-pairing[data-value="editorial"]')
await page.click('.ts-set-step.is-large')
await page.click('.ts-set-segment[data-value="normal"]')
results.epub3 = await open('margin-keeper-epub3.epub')
results.epub3Wrap = await compareWrapping()
results.epub2 = await open('margin-keeper-epub2.epub')
results.longBook = await open('long-book.epub')
await page.keyboard.press('Escape')
await page.evaluate(() => window.reader.goToChapter(30, 'instant'))
await page.waitForTimeout(400)
await page.screenshot({ path: out + 'epub-long-book.png' })
results.longPrepareMs = await page.evaluate(async () => {
  const r = window.reader
  const t0 = performance.now()
  r.doc.blocks.forEach(b => (b.prepared = null))
  r.doc.prepare()
  return Math.round(performance.now() - t0)
})
await page.click('.ts-settings-button')
results.badFile = await open('not-an-epub.epub')
results.bookAfterBadFile = await page.evaluate(() => window.reader.book.title)
results.errors = errors

console.log(JSON.stringify(results, null, 2))
await browser.close()
await server.close()
