// Headless check: builds nothing, expects `npm run build:demo` output and serves it.
// - Compares each Pretext-laid paragraph against the browser's own wrapping of the same text.
// - Measures per-frame cost of reflowing around a dragged figure.
// - Saves screenshots to scripts/out/.
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { mkdirSync, existsSync, readFileSync } from 'node:fs'
import http from 'node:http'

// Use $CHROME or a system Chrome on Linux; otherwise Playwright's own Chromium
// (install once with: npx playwright install chromium).
function chromeOptions() {
  const path = process.env.CHROME ?? (existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined)
  return path ? { executablePath: path } : {}
}

const out = new URL('./out/', import.meta.url).pathname
mkdirSync(out, { recursive: true })

const server = await createServer({ configFile: 'vite.config.ts', server: { port: 5199 }, logLevel: 'error' })
await server.listen()
const base = 'http://localhost:5199/'

const browser = await chromium.launch(chromeOptions())

async function open(viewport, query = '') {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 2 })
  page.on('pageerror', e => console.error('PAGE ERROR', e.message))
  page.on('console', m => m.type() === 'error' && console.error('CONSOLE', m.text()))
  await page.goto(base + query)
  await page.waitForSelector('.ts-root.is-ready')
  await page.waitForTimeout(500)
  return page
}

// Re-wrap each mounted paragraph with the browser and compare line counts and breaks.
async function compareWrapping(page) {
  return page.evaluate(() => {
    const blocks = [...document.querySelectorAll('.ts-paragraph, .ts-quote, .ts-heading')]
    let checked = 0, mismatched = []
    for (const el of blocks) {
      const lines = [...el.querySelectorAll('.ts-line')]
      if (!lines.length) continue
      const xs = lines.map(l => new DOMMatrix(getComputedStyle(l).transform).m41)
      if (window.reader.doc.blocks[+el.dataset.block].shaped) continue // bent around a figure; not comparable
      const probe = document.createElement('div')
      const cs = getComputedStyle(el)
      Object.assign(probe.style, {
        position: 'absolute', visibility: 'hidden', left: '0', top: '0',
        width: el.parentElement.parentElement.style.width, font: cs.font, lineHeight: cs.lineHeight,
        overflowWrap: 'break-word', whiteSpace: 'normal',
      })
      if (el.classList.contains('ts-quote')) {
        const w = parseFloat(el.parentElement.parentElement.style.width) - 2 * xs[0]
        probe.style.width = `${w}px`
      }
      probe.innerHTML = lines.map(l => l.innerHTML).join(' ')
      document.body.append(probe)
      const browserLines = Math.round(probe.getBoundingClientRect().height / parseFloat(cs.lineHeight))
      probe.remove()
      checked++
      if (browserLines !== lines.length) mismatched.push({ text: lines[0].textContent.slice(0, 40), pretext: lines.length, browser: browserLines })
    }
    return { checked, mismatched }
  })
}

const results = {}

// ── desktop light
{
  const page = await open({ width: 1440, height: 900 })
  await page.screenshot({ path: out + 'desktop-top.png' })
  results.desktopWrap = await compareWrapping(page)

  await page.mouse.wheel(0, 1300)
  await page.waitForTimeout(600)
  await page.screenshot({ path: out + 'desktop-reading.png' })
  results.desktopWrap2 = await compareWrapping(page)
  results.position = await page.evaluate(() => window.reader.position)

  // Rail: collapsed at rest, peeks on entering a new chapter, folds again.
  await page.mouse.move(1000, 500)
  results.railAtRest = await page.evaluate(() => document.querySelector('.ts-rail').classList.contains('is-open'))
  await page.evaluate(() => window.reader.goToChapter(2, 'instant'))
  await page.waitForTimeout(300)
  results.railPeek = await page.evaluate(() => document.querySelector('.ts-rail').classList.contains('is-open'))
  await page.screenshot({ path: out + 'desktop-peek.png' })
  await page.waitForTimeout(2600)
  results.railAfterPeek = await page.evaluate(() => document.querySelector('.ts-rail').classList.contains('is-open'))

  // Drag the seed figure into the text and hold it there.
  await page.evaluate(() => window.reader.goToChapter(1, 'instant'))
  await page.waitForTimeout(400)
  const fig = page.locator('.ts-figure').nth(1)
  const box = await fig.boundingBox()
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  const timings = await page.evaluate(() => {
    window.__frames = []
    let last = performance.now()
    const tick = t => { window.__frames.push(t - last); last = t; if (window.__frames.length < 200) requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
    return true
  })
  void timings
  const steps = 40
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(start.x - (i / steps) * 520, start.y + 60 + Math.sin(i / 6) * 40)
    await page.waitForTimeout(16)
  }
  await page.waitForTimeout(200)
  await page.screenshot({ path: out + 'desktop-drag.png' })
  results.shapedWhileDragging = await page.evaluate(() => window.reader.doc.blocks.filter(b => b.shaped).length)

  // Measure raw reflow cost with the obstacle in the text.
  results.reflowMs = await page.evaluate(() => {
    const r = window.reader
    const field = r.field
    const t0 = performance.now()
    for (let i = 0; i < 100; i++) { r.doc.blocks.forEach(b => { if (b.shaped) b.shaped = true }); r.doc.reflow(r.doc.width, field) }
    return +((performance.now() - t0) / 100).toFixed(3)
  })

  await page.mouse.up()
  await page.waitForTimeout(1600)
  await page.screenshot({ path: out + 'desktop-settled.png' })
  results.shapedAfterSettle = await page.evaluate(() => window.reader.doc.blocks.filter(b => b.shaped).length)
  results.frameP95 = await page.evaluate(() => {
    const f = window.__frames.slice(5).sort((a, b) => a - b)
    return f.length ? +f[Math.floor(f.length * 0.95)].toFixed(1) : null
  })

  // Dark theme + open rail.
  await page.click('.ts-settings-button')
  await page.click('.ts-set-swatch[data-value="dark"]')
  await page.keyboard.press('Escape')
  await page.mouse.move(30, 450)
  await page.waitForTimeout(500)
  await page.screenshot({ path: out + 'desktop-dark-rail.png' })
  await page.close()
}

// ── mobile
{
  const page = await open({ width: 390, height: 844 })
  await page.screenshot({ path: out + 'mobile-top.png' })
  results.mobileWrap = await compareWrapping(page)
  await page.evaluate(() => window.reader.goToChapter(1, 'instant'))
  await page.waitForTimeout(400)
  await page.screenshot({ path: out + 'mobile-ch2.png' })
  await page.close()
}

// ── long document
{
  const page = await open({ width: 1440, height: 900 }, '?stress=40')
  results.stress = await page.evaluate(() => {
    const r = window.reader
    const t0 = performance.now()
    r.doc.reflow(r.doc.width + 1, null)
    const full = performance.now() - t0
    return { blocks: r.doc.blocks.length, chapters: r.doc.chapterTops.length, fullRelayoutMs: +full.toFixed(1), domBlocks: document.querySelectorAll('.ts-block').length, height: Math.round(r.doc.totalHeight) }
  })
  await page.close()
}

// ── built single-file demo inside a sandboxed, origin-less iframe
// (how claude.ai artifacts and similar hosts serve pages). Requires `npm run build:demo`.
if (existsSync('dist-demo/index.html')) {
  const demoHtml = readFileSync('dist-demo/index.html')
  const files = http.createServer((_, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(demoHtml) }).listen(5301)
  const hostPage = http.createServer((_, res) => {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end('<!doctype html><body style="margin:0"><iframe sandbox="allow-scripts" src="http://127.0.0.1:5301/" style="width:100vw;height:100vh;border:0"></iframe></body>')
  }).listen(5300)
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []
  page.on('console', m => m.type() === 'error' && !m.text().includes('favicon') && errors.push(m.text()))
  await page.goto('http://127.0.0.1:5300/')
  const frame = page.frames()[1]
  await frame.waitForSelector('.ts-root.is-ready', { timeout: 10000 }).catch(() => {})
  await page.waitForTimeout(500)
  results.sandboxedBuild = await frame.evaluate(() => {
    const col = document.querySelector('.ts-column')
    const rect = col?.getBoundingClientRect()
    return {
      ready: !!document.querySelector('.ts-root.is-ready'),
      columnCentred: rect ? Math.abs(rect.left + rect.width / 2 - innerWidth / 2) < 2 : false,
      lineIsAbsolute: getComputedStyle(document.querySelector('.ts-line')).position === 'absolute',
      ruleVisible: !!document.querySelector('.ts-rule') && getComputedStyle(document.querySelector('.ts-rule')).position === 'absolute',
      fontsLoaded: [...document.fonts].filter(f => f.status === 'loaded').length,
    }
  }).catch(e => ({ error: e.message }))
  // Drag a figure inside the sandbox too.
  const fig = frame.locator('.ts-figure').first()
  const box = await fig.boundingBox()
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    for (let i = 1; i <= 20; i++) { await page.mouse.move(box.x + box.width / 2 - i * 25, box.y + box.height / 2); await page.waitForTimeout(16) }
    results.sandboxedBuild.shapedWhileDragging = await frame.evaluate(() => window.reader.doc.blocks.filter(b => b.shaped).length)
    await page.screenshot({ path: out + 'sandboxed-build-drag.png' })
    await page.mouse.up()
  }
  results.sandboxedBuild.consoleErrors = errors
  await page.close()
  files.close(); hostPage.close()
} else {
  results.sandboxedBuild = 'skipped: run npm run build:demo first'
}

console.log(JSON.stringify(results, null, 2))
await browser.close()
await server.close()
