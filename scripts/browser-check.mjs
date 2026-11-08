// Headless check: builds nothing, expects `npm run build:demo` output and serves it.
// - Compares each Pretext-laid paragraph against the browser's own wrapping of the same text.
// - Measures per-frame cost of reflowing around a dragged figure.
// - Saves screenshots to scripts/out/.
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { mkdirSync } from 'node:fs'

const out = new URL('./out/', import.meta.url).pathname
mkdirSync(out, { recursive: true })

const server = await createServer({ configFile: 'vite.config.ts', server: { port: 5199 }, logLevel: 'error' })
await server.listen()
const base = 'http://localhost:5199/'

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome' })

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
  await page.click('.ts-theme')
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

console.log(JSON.stringify(results, null, 2))
await browser.close()
await server.close()
