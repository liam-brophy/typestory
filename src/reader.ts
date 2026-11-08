import { clearCache } from '@chenglou/pretext'
import { MarginFigure, type FigureOptions } from './figures/figure'
import { DocumentLayout } from './layout/document'
import { Field } from './layout/field'
import { ColumnRenderer } from './render/column'
import type { Book } from './types'
import { defaultTypography, fontString, loadFonts, type Typography } from './typography'
import { ChapterRail, type RailMode } from './ui/chapter-rail'
import { ProgressRule } from './ui/progress-rule'
import { initialTheme, ThemeToggle, type Theme } from './ui/theme'

export type ReaderOptions = {
  book: Book
  /** Override typography. Called again whenever the reader's width changes. */
  typography?: (viewportWidth: number) => Typography
  theme?: Theme
  rail?: RailMode
  /**
   * 'window': the page scrolls and the chrome is fixed to the viewport (full-page reading).
   * 'element': the host element is the frame and scrolls internally (embedded reading).
   */
  scroll?: 'window' | 'element'
  /** Where the reader's eye is assumed to be, as a fraction of viewport height. */
  readingLine?: number
}

export type ReaderPosition = { chapter: number; progress: number }
type Listener = (pos: ReaderPosition) => void

export class Reader {
  readonly root: HTMLElement
  readonly doc: DocumentLayout
  private readonly scroller: HTMLElement
  private readonly column: ColumnRenderer
  private readonly rule: ProgressRule
  private readonly rail: ChapterRail
  private readonly field = new Field()
  private readonly figures: MarginFigure[] = []
  private readonly listeners = new Set<Listener>()
  private readonly windowMode: boolean
  private typoFor: (w: number) => Typography
  private raf = 0
  private lastFrame = 0
  private lastChapter = -1
  private scrollStart: number | null = null
  private resizeObs: ResizeObserver
  private needsReflow = true
  private wasMoving = false

  private constructor(private host: HTMLElement, private opts: ReaderOptions) {
    this.windowMode = (opts.scroll ?? 'window') === 'window'
    this.typoFor = opts.typography ?? defaultTypography

    this.root = document.createElement('div')
    this.root.className = `ts-root ${this.windowMode ? 'ts-window' : 'ts-element'}`
    this.scroller = document.createElement('div')
    this.scroller.className = 'ts-scroller'
    const chrome = document.createElement('div')
    chrome.className = 'ts-chrome'
    this.root.append(this.scroller, chrome)
    host.append(this.root)

    this.doc = new DocumentLayout(opts.book, this.typoFor(this.viewportWidth()))
    this.column = new ColumnRenderer(this.scroller)
    this.rule = new ProgressRule(chrome)
    this.rail = new ChapterRail(chrome, opts.book.chapters, i => this.goToChapter(i), opts.rail)
    new ThemeToggle(chrome, this.root, initialTheme(opts.theme))

    const target: EventTarget = this.windowMode ? window : this.scroller
    target.addEventListener('scroll', this.onScroll, { passive: true })
    this.resizeObs = new ResizeObserver(() => this.onResize())
    this.resizeObs.observe(this.windowMode ? document.documentElement : host)
  }

  /** Create a reader inside `host`. Resolves once fonts are loaded and text is set. */
  static async mount(host: HTMLElement, opts: ReaderOptions): Promise<Reader> {
    const reader = new Reader(host, opts)
    await reader.prepare()
    return reader
  }

  // ── public API ──────────────────────────────────────────────

  goToChapter(index: number, behavior: ScrollBehavior = 'smooth'): void {
    const top = this.doc.chapterTops[index]
    if (top === undefined) return
    this.scrollTo(top - this.doc.padTop * 0.6, behavior)
  }

  addFigure(opts: FigureOptions): MarginFigure {
    const fig = new MarginFigure(opts, this.column.figureLayer, (x, y) => this.clientToColumn(x, y), () => this.request())
    fig.chapter = typeof opts.chapter === 'number' ? opts.chapter : this.opts.book.chapters.findIndex(c => c.id === opts.chapter)
    this.figures.push(fig)
    this.field.obstacles.add(fig.obstacle)
    this.placeFigures()
    this.needsReflow = true
    this.request()
    return fig
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  get position(): ReaderPosition {
    return this.computePosition()
  }

  destroy(): void {
    cancelAnimationFrame(this.raf)
    this.resizeObs.disconnect()
    const target: EventTarget = this.windowMode ? window : this.scroller
    target.removeEventListener('scroll', this.onScroll)
    this.figures.forEach(f => f.destroy())
    this.root.remove()
  }

  // ── setup & layout ──────────────────────────────────────────

  private async prepare(): Promise<void> {
    const sample = this.opts.book.chapters.map(c => c.title + (c.label ?? '')).join(' ') + ' abcdefghijklmnopqrstuvwxyz ABCDEFGHIJKLMNOPQRSTUVWXYZ 0123456789 “”‘’—–…'
    await loadFonts(this.doc.typo, sample)
    clearCache() // widths measured before the web font arrived belong to the fallback
    this.doc.prepare()
    this.reflow()
    this.root.classList.add('is-ready')
    this.frame(performance.now())
  }

  private viewportWidth(): number {
    return this.windowMode ? document.documentElement.clientWidth : this.host.clientWidth
  }

  private viewportHeight(): number {
    return this.windowMode ? window.innerHeight : this.scroller.clientHeight
  }

  private columnWidth(): number {
    const t = this.doc.typo
    return Math.round(Math.min(t.maxMeasure, this.viewportWidth() - t.minMargin * 2))
  }

  private reflow(): void {
    this.doc.padBottom = Math.round(this.viewportHeight() * 0.6)
    this.placeFigures()
    this.doc.reflow(this.columnWidth(), this.field)
    this.placeFigures() // anchors may have moved
    this.needsReflow = false
  }

  private placeFigures(): void {
    const width = this.doc.width || this.columnWidth()
    const vw = this.viewportWidth()
    const margin = (vw - width) / 2
    for (const f of this.figures) {
      const blocks = this.doc.blocks
      const anchor = blocks.find(b => b.chapter === f.chapter && b.sourceIndex === (f.opts.block ?? 0))
        ?? blocks.find(b => b.chapter === f.chapter)
      if (!anchor) continue
      const r = f.opts.size / 2
      // Sit in the middle of the margin; when the margin is too narrow, overlap
      // the column edge and let the text wrap around it like a float.
      const right = f.opts.side !== 'left'
      const gutter = Math.max(margin / 2, r + 8)
      let x = right ? width + gutter : -gutter
      x = right ? Math.min(x, width + margin - r - 8) : Math.max(x, -margin + r + 8)
      f.setHome(x, anchor.top + r)
    }
  }

  private onResize = () => {
    const vw = this.viewportWidth()
    const next = this.typoFor(vw)
    const anchor = this.captureAnchor()
    const fontsChanged = fontString(next.body) !== fontString(this.doc.typo.body) || fontString(next.heading) !== fontString(this.doc.typo.heading)
    this.doc.typo = next
    if (fontsChanged) {
      this.column.clear()
      loadFonts(next, 'abc').then(() => {
        clearCache()
        this.doc.prepare()
        this.reflow()
        this.restoreAnchor(anchor)
        this.request()
      })
      return
    }
    const width = this.columnWidth()
    if (width !== this.doc.width || this.doc.padBottom !== Math.round(this.viewportHeight() * 0.6)) {
      this.reflow()
      this.restoreAnchor(anchor)
    }
    this.request()
  }

  /** Remember which block is at the reading line, so resizes don't lose your place. */
  private captureAnchor(): { block: number; frac: number } | null {
    if (!this.doc.blocks.length) return null
    const y = this.viewTop() + this.viewportHeight() * this.readingLine()
    const i = this.doc.blockAt(y)
    const b = this.doc.blocks[i]
    return { block: i, frac: b.height ? (y - b.top) / b.height : 0 }
  }

  private restoreAnchor(a: { block: number; frac: number } | null): void {
    if (!a) return
    const b = this.doc.blocks[a.block]
    if (!b) return
    this.scrollTo(b.top + a.frac * b.height - this.viewportHeight() * this.readingLine(), 'instant')
  }

  // ── frame loop ──────────────────────────────────────────────

  private onScroll = () => {
    const top = this.viewTop()
    if (this.scrollStart === null) this.scrollStart = top
    else if (Math.abs(top - this.scrollStart) > 48) this.rail.noteReading()
    this.request()
  }

  private request = () => {
    if (!this.raf) this.raf = requestAnimationFrame(t => this.frame(t))
  }

  private frame(now: number): void {
    this.raf = 0
    const dt = Math.min(1 / 30, this.lastFrame ? (now - this.lastFrame) / 1000 : 1 / 60)
    this.lastFrame = now

    // Read geometry once, before any DOM writes, to avoid forced synchronous layout.
    const top = this.viewTop()
    const vh = this.viewportHeight()

    let moving = false
    for (const f of this.figures) moving = f.step(dt) || moving
    if (moving || this.needsReflow) {
      // Pretext makes this cheap enough to do every frame: only blocks touching
      // (or recovering from) an obstacle are re-broken; the rest just shift.
      this.doc.reflow(this.doc.width || this.columnWidth(), this.field)
      this.placeFigures()
      this.needsReflow = false
    }
    // One extra settle pass the frame after a figure comes to rest.
    if (this.wasMoving && !moving) this.needsReflow = true
    this.wasMoving = moving

    this.column.render(this.doc, top - vh * 0.5, top + vh * 1.5)
    let hooksVisible = false
    for (const f of this.figures) hooksVisible = f.paint(top, top + vh) || hooksVisible

    const pos = this.computePosition(top, vh)
    this.rule.set(pos.progress)
    this.rail.setCurrent(pos.chapter, pos.progress)
    if (pos.chapter !== this.lastChapter) this.lastChapter = pos.chapter
    this.listeners.forEach(l => l(pos))

    this.lastFrame = moving ? now : 0
    if (moving || hooksVisible || this.needsReflow) this.request()
  }

  private computePosition(top = this.viewTop(), vh = this.viewportHeight()): ReaderPosition {
    if (!this.doc.chapterTops.length) return { chapter: 0, progress: 0 }
    const y = top + vh * this.readingLine()
    const c = this.doc.chapterAt(y)
    const start = this.doc.chapterTops[c]
    const end = this.doc.chapterEnd(c)
    return { chapter: c, progress: Math.max(0, Math.min(1, (y - start) / Math.max(1, end - start))) }
  }

  // ── coordinates & scrolling ────────────────────────────────

  private readingLine(): number {
    return this.opts.readingLine ?? 0.33
  }

  /** Scroll offset of the column's top edge, i.e. the top of the viewport in column coordinates. */
  private viewTop(): number {
    if (!this.windowMode) return this.scroller.scrollTop
    return window.scrollY - this.columnPageTop()
  }

  private columnPageTop(): number {
    return this.column.el.getBoundingClientRect().top + window.scrollY
  }

  private scrollTo(columnY: number, behavior: ScrollBehavior): void {
    const y = Math.max(0, columnY)
    if (this.windowMode) window.scrollTo({ top: y + this.columnPageTop(), behavior })
    else this.scroller.scrollTo({ top: y, behavior })
  }

  private clientToColumn(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.column.el.getBoundingClientRect()
    return { x: clientX - r.left, y: clientY - r.top }
  }
}
