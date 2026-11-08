import { clearCache } from '@chenglou/pretext'
import { MarginFigure, type FigureOptions } from './figures/figure'
import { EpubError, parseEpub } from './format/epub'
import { DocumentLayout } from './layout/document'
import { Field } from './layout/field'
import { ColumnRenderer } from './render/column'
import {
  applyTheme, clampStep, DEFAULT_PAIRINGS, DEFAULT_SETTINGS, DEFAULT_THEMES, loadSettings, saveSettings, typographyFor,
  type FontPairing, type ReaderSettings, type ThemeDef,
} from './settings'
import type { Book } from './types'
import { fontStrings, loadFonts, type Typography } from './typography'
import { ChapterRail, type RailMode } from './ui/chapter-rail'
import { ProgressRule } from './ui/progress-rule'
import { SettingsPanel } from './ui/settings-panel'

export type ReaderOptions = {
  book: Book
  /** Font pairings offered in settings. Defaults to DEFAULT_PAIRINGS; the host loads the faces. */
  pairings?: FontPairing[]
  /** Colour themes offered in settings. Defaults to Light and Dark. */
  themes?: ThemeDef[]
  /** Initial settings. Saved settings from a previous visit win unless `persist` is false. */
  settings?: Partial<ReaderSettings>
  /** Remember settings in localStorage. Default true. */
  persist?: boolean
  /** Show the "Aa" settings button and drawer. Default true. */
  controls?: boolean
  /** Let readers open their own EPUB files (button in settings + drag and drop). Default false. */
  allowUpload?: boolean
  /** Called after a reader-opened EPUB has been parsed and set, with the original file. */
  onBookOpened?: (book: Book, file: File) => void
  /** Full typography override, bypassing settings. Called again whenever the width changes. */
  typography?: (viewportWidth: number, settings: ReaderSettings) => Typography
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
  doc: DocumentLayout
  settings: ReaderSettings
  private readonly scroller: HTMLElement
  private readonly chrome: HTMLElement
  private readonly column: ColumnRenderer
  private readonly rule: ProgressRule
  private rail: ChapterRail
  private readonly panel: SettingsPanel | null
  private readonly field = new Field()
  private figures: MarginFigure[] = []
  private readonly listeners = new Set<Listener>()
  private readonly windowMode: boolean
  private readonly pairings: FontPairing[]
  private readonly themes: ThemeDef[]
  private raf = 0
  private lastFrame = 0
  private resizeObs: ResizeObserver
  private needsReflow = true
  private wasMoving = false
  private typesetToken = 0

  private constructor(private host: HTMLElement, private opts: ReaderOptions) {
    this.windowMode = (opts.scroll ?? 'window') === 'window'
    this.pairings = opts.pairings?.length ? opts.pairings : DEFAULT_PAIRINGS
    this.themes = opts.themes?.length ? opts.themes : DEFAULT_THEMES
    this.settings = this.sanitize({
      ...DEFAULT_SETTINGS,
      ...(matchMedia('(prefers-color-scheme: dark)').matches ? { theme: 'dark' } : {}),
      ...opts.settings,
      ...(opts.persist === false ? {} : loadSettings()),
    })

    this.root = document.createElement('div')
    this.root.className = `ts-root ${this.windowMode ? 'ts-window' : 'ts-element'}`
    this.scroller = document.createElement('div')
    this.scroller.className = 'ts-scroller'
    this.chrome = document.createElement('div')
    this.chrome.className = 'ts-chrome'
    this.root.append(this.scroller, this.chrome)
    host.append(this.root)
    applyTheme(this.root, this.theme())

    this.doc = new DocumentLayout(opts.book, this.typoFor(this.viewportWidth()))
    this.column = new ColumnRenderer(this.scroller)
    this.rule = new ProgressRule(this.chrome)
    this.rail = this.makeRail(opts.book)
    this.panel = opts.controls === false ? null : new SettingsPanel(this.chrome, {
      pairings: this.pairings,
      themes: this.themes,
      settings: this.settings,
      onChange: patch => this.setSettings(patch),
      onOpenFile: opts.allowUpload ? f => this.openFile(f) : undefined,
    })
    this.panel?.setBook(opts.book.title, opts.book.author)
    if (opts.allowUpload) this.enableDrop()

    const target: EventTarget = this.windowMode ? window : this.scroller
    target.addEventListener('scroll', this.onScroll, { passive: true })
    this.resizeObs = new ResizeObserver(() => this.onResize())
    this.resizeObs.observe(this.windowMode ? document.documentElement : host)
  }

  /** Create a reader inside `host`. Resolves once fonts are loaded and text is set. */
  static async mount(host: HTMLElement, opts: ReaderOptions): Promise<Reader> {
    const reader = new Reader(host, opts)
    await reader.typeset({ anchor: false })
    reader.root.classList.add('is-ready')
    reader.frame(performance.now())
    return reader
  }

  // ── public API ──────────────────────────────────────────────

  get book(): Book {
    return this.doc.book
  }

  get position(): ReaderPosition {
    return this.computePosition()
  }

  goToChapter(index: number, behavior: ScrollBehavior = 'smooth'): void {
    const top = this.doc.chapterTops[index]
    if (top === undefined) return
    this.scrollTo(top - this.doc.padTop * 0.6, behavior)
  }

  /** Change settings. Theme changes are instant; type changes re-set the text and keep your place. */
  async setSettings(patch: Partial<ReaderSettings>): Promise<void> {
    const prev = this.settings
    this.settings = this.sanitize({ ...prev, ...patch })
    if (this.opts.persist !== false) saveSettings(this.settings)
    if (this.settings.theme !== prev.theme) applyTheme(this.root, this.theme())
    const typeChanged = (['pairing', 'size', 'leading', 'measure', 'paragraphs'] as const).some(k => this.settings[k] !== prev[k])
    if (typeChanged) await this.typeset({ anchor: true })
  }

  /** Replace the book being read. Figures belong to a book, so they are removed. */
  async setBook(book: Book): Promise<void> {
    this.figures.forEach(f => f.destroy())
    this.figures = []
    this.field.obstacles.clear()
    this.column.clear()
    this.rail.destroy()
    this.rail = this.makeRail(book)
    this.doc = new DocumentLayout(book, this.doc.typo)
    this.panel?.setBook(book.title, book.author)
    await this.typeset({ anchor: false })
    this.scrollTo(0, 'instant')
    this.request()
  }

  /** Parse an EPUB file and start reading it. */
  async openFile(file: File): Promise<Book | null> {
    this.panel?.setStatus(`Opening “${file.name}”…`)
    try {
      const book = await parseEpub(await file.arrayBuffer())
      this.panel?.setStatus('Setting type…')
      await new Promise(r => requestAnimationFrame(() => r(null)))
      const t0 = performance.now()
      await this.setBook(book)
      const words = book.chapters.reduce((n, c) => n + c.blocks.reduce((m, b) => m + ('runs' in b ? b.runs.reduce((k, r) => k + r.text.split(/\s+/).length, 0) : 0), 0), 0)
      this.panel?.setStatus(`${book.chapters.length} chapters · ${words.toLocaleString()} words · set in ${Math.round(performance.now() - t0)} ms`)
      this.opts.onBookOpened?.(book, file)
      return book
    } catch (err) {
      const msg = err instanceof EpubError ? err.message : `Couldn’t open this file: ${(err as Error)?.message ?? err}`
      this.panel?.setStatus(msg, true)
      this.panel?.open()
      if (!(err instanceof EpubError)) console.error(err)
      return null
    }
  }

  addFigure(opts: FigureOptions): MarginFigure {
    const fig = new MarginFigure(opts, this.column.figureLayer, (x, y) => this.clientToColumn(x, y), () => this.request())
    fig.chapter = typeof opts.chapter === 'number' ? opts.chapter : this.book.chapters.findIndex(c => c.id === opts.chapter)
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

  openSettings(): void { this.panel?.open() }

  destroy(): void {
    cancelAnimationFrame(this.raf)
    this.resizeObs.disconnect()
    const target: EventTarget = this.windowMode ? window : this.scroller
    target.removeEventListener('scroll', this.onScroll)
    this.figures.forEach(f => f.destroy())
    this.panel?.destroy()
    this.root.remove()
  }

  // ── typesetting ─────────────────────────────────────────────

  private sanitize(s: ReaderSettings): ReaderSettings {
    const out = { ...DEFAULT_SETTINGS, ...s }
    if (!this.pairings.some(p => p.id === out.pairing)) out.pairing = this.pairings[0].id
    if (!this.themes.some(t => t.id === out.theme)) out.theme = this.themes[0].id
    out.size = clampStep(out.size)
    if (!['tight', 'normal', 'loose'].includes(out.leading)) out.leading = 'normal'
    if (!['narrow', 'normal', 'wide'].includes(out.measure)) out.measure = 'normal'
    if (!['spaced', 'indented'].includes(out.paragraphs)) out.paragraphs = 'spaced'
    return out
  }

  private theme(): ThemeDef {
    return this.themes.find(t => t.id === this.settings.theme) ?? this.themes[0]
  }

  private pairing(): FontPairing {
    return this.pairings.find(p => p.id === this.settings.pairing) ?? this.pairings[0]
  }

  private typoFor(vw: number): Typography {
    return this.opts.typography ? this.opts.typography(vw, this.settings) : typographyFor(this.settings, this.pairing(), vw)
  }

  /**
   * (Re)set the whole text for the current settings and width. Pretext only
   * re-measures blocks whose font changed; everything else is re-broken from
   * cached widths. Concurrent calls collapse to the latest.
   */
  private async typeset({ anchor }: { anchor: boolean }): Promise<void> {
    const token = ++this.typesetToken
    const saved = anchor ? this.captureAnchor() : null
    const typo = this.typoFor(this.viewportWidth())
    const fontsChanged = fontStrings(typo).join('|') !== fontStrings(this.doc.typo).join('|') || !this.doc.blocks.length
    if (fontsChanged) {
      await loadFonts(typo, this.sampleText())
      if (token !== this.typesetToken) return
      clearCache() // widths measured before a web font arrived belong to the fallback
    }
    this.doc.typo = typo
    this.root.style.setProperty('--ts-ui-font', typo.uiFamily)
    this.doc.prepare()
    if (fontsChanged) this.column.clear()
    this.reflow(true)
    if (saved) this.restoreAnchor(saved)
    this.request()
  }

  private sampleText(): string {
    const chs = this.book.chapters
    const sample = chs.slice(0, 3).flatMap(c => c.blocks.slice(0, 4)).map(b => ('runs' in b ? b.runs.map(r => r.text).join('') : '')).join(' ')
    return chs.map(c => c.title + (c.label ?? '')).join(' ').slice(0, 2000) + sample.slice(0, 4000) + ' abcdefghijklmnopqrstuvwxyz ABCDEFGHIJKLMNOPQRSTUVWXYZ 0123456789 “”‘’—–…'
  }

  private makeRail(book: Book): ChapterRail {
    return new ChapterRail(this.chrome, book.chapters, i => this.goToChapter(i), this.opts.rail)
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

  private reflow(force = false): void {
    this.doc.padBottom = Math.round(this.viewportHeight() * 0.6)
    if (force) for (const b of this.doc.blocks) b.layoutWidth = -1
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
    const next = this.typoFor(this.viewportWidth())
    if (fontStrings(next).join('|') !== fontStrings(this.doc.typo).join('|')) {
      void this.typeset({ anchor: true })
      return
    }
    const anchor = this.captureAnchor()
    this.doc.typo = next
    if (this.columnWidth() !== this.doc.width || this.doc.padBottom !== Math.round(this.viewportHeight() * 0.6)) {
      this.reflow()
      this.restoreAnchor(anchor)
    }
    this.request()
  }

  /** Remember which block is at the reading line, so re-setting text doesn't lose your place. */
  private captureAnchor(): { block: number; frac: number } | null {
    if (!this.doc.blocks.length || !this.doc.width) return null
    const y = this.viewTop() + this.viewportHeight() * this.readingLine()
    const i = this.doc.blockAt(y)
    const b = this.doc.blocks[i]
    return { block: i, frac: b.height ? Math.max(0, Math.min(1, (y - b.top) / b.height)) : 0 }
  }

  private restoreAnchor(a: { block: number; frac: number } | null): void {
    if (!a) return
    const b = this.doc.blocks[a.block]
    if (!b) return
    this.scrollTo(b.top + a.frac * b.height - this.viewportHeight() * this.readingLine(), 'instant')
  }

  // ── upload ──────────────────────────────────────────────────

  private enableDrop(): void {
    let depth = 0
    const isFileDrag = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files')
    const zone = this.windowMode ? window : this.root
    zone.addEventListener('dragenter', ((e: DragEvent) => {
      if (!isFileDrag(e)) return
      e.preventDefault()
      if (depth++ === 0) this.root.classList.add('is-dropping')
    }) as EventListener)
    zone.addEventListener('dragover', ((e: DragEvent) => { if (isFileDrag(e)) e.preventDefault() }) as EventListener)
    zone.addEventListener('dragleave', ((e: DragEvent) => {
      if (!isFileDrag(e)) return
      if (--depth <= 0) { depth = 0; this.root.classList.remove('is-dropping') }
    }) as EventListener)
    zone.addEventListener('drop', ((e: DragEvent) => {
      if (!isFileDrag(e)) return
      e.preventDefault()
      depth = 0
      this.root.classList.remove('is-dropping')
      const file = [...(e.dataTransfer?.files ?? [])].find(f => /\.epub$/i.test(f.name) || f.type === 'application/epub+zip')
      if (file) void this.openFile(file)
      else { this.panel?.setStatus('That isn’t an .epub file.', true); this.panel?.open() }
    }) as EventListener)
    const veil = document.createElement('div')
    veil.className = 'ts-drop-veil'
    veil.innerHTML = '<span>Drop to read</span>'
    this.chrome.append(veil)
  }

  // ── frame loop ──────────────────────────────────────────────

  private onScroll = () => this.request()

  private request = () => {
    if (!this.raf) this.raf = requestAnimationFrame(t => this.frame(t))
  }

  private frame(now: number): void {
    this.raf = 0
    const dt = Math.min(1 / 30, this.lastFrame ? (now - this.lastFrame) / 1000 : 1 / 60)

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

  /** The top of the viewport in column coordinates. */
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
