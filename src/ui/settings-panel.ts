import { LEADING, MEASURE, SIZE_STEPS, type FontPairing, type ReaderSettings, type ThemeDef } from '../settings'

export type SettingsPanelOptions = {
  pairings: FontPairing[]
  themes: ThemeDef[]
  settings: ReaderSettings
  onChange: (patch: Partial<ReaderSettings>) => void
  /** When set, the panel offers "Open EPUB…" and calls this with the chosen file. */
  onOpenFile?: (file: File) => void
}

const LEADING_LABELS: Record<keyof typeof LEADING, string> = { tight: 'Tight', normal: 'Normal', loose: 'Loose' }
const MEASURE_LABELS: Record<keyof typeof MEASURE, string> = { narrow: 'Narrow', normal: 'Normal', wide: 'Wide' }

/**
 * The "Aa" button and its drawer: theme, typeface pairing, size, spacing,
 * column width, paragraph style, and opening a book.
 */
export class SettingsPanel {
  readonly button: HTMLButtonElement
  readonly panel: HTMLElement
  private settings: ReaderSettings
  private bookTitle!: HTMLElement
  private bookAuthor!: HTMLElement
  private status!: HTMLElement
  private sizeDots: HTMLElement[] = []

  constructor(parent: HTMLElement, private opts: SettingsPanelOptions) {
    this.settings = { ...opts.settings }

    this.button = document.createElement('button')
    this.button.type = 'button'
    this.button.className = 'ts-settings-button'
    this.button.innerHTML = '<span aria-hidden="true">Aa</span>'
    this.button.setAttribute('aria-label', 'Reading settings')
    this.button.setAttribute('aria-expanded', 'false')
    this.button.setAttribute('aria-controls', 'ts-settings')
    this.button.addEventListener('click', () => this.toggle())

    this.panel = document.createElement('section')
    this.panel.className = 'ts-settings'
    this.panel.id = 'ts-settings'
    this.panel.setAttribute('aria-label', 'Reading settings')
    this.panel.hidden = true
    this.build()

    parent.append(this.button, this.panel)
    document.addEventListener('keydown', this.onKey)
    document.addEventListener('pointerdown', this.onOutside, true)
  }

  setBook(title: string, author?: string): void {
    this.bookTitle.textContent = title
    this.bookAuthor.textContent = author ?? ''
    this.bookAuthor.hidden = !author
  }

  setStatus(message: string, isError = false): void {
    this.status.textContent = message
    this.status.classList.toggle('is-error', isError)
    this.status.hidden = !message
  }

  open(): void {
    this.panel.hidden = false
    this.button.setAttribute('aria-expanded', 'true')
    this.button.classList.add('is-active')
  }

  close(): void {
    this.panel.hidden = true
    this.button.setAttribute('aria-expanded', 'false')
    this.button.classList.remove('is-active')
  }

  toggle(): void {
    if (this.panel.hidden) this.open()
    else this.close()
  }

  destroy(): void {
    document.removeEventListener('keydown', this.onKey)
    document.removeEventListener('pointerdown', this.onOutside, true)
    this.button.remove()
    this.panel.remove()
  }

  // ── building ─────────────────────────────────────────────

  private build(): void {
    const p = this.panel
    p.innerHTML = ''

    // Book
    const book = this.section('Book')
    this.bookTitle = el('div', 'ts-set-book-title')
    this.bookAuthor = el('div', 'ts-set-book-author')
    book.append(this.bookTitle, this.bookAuthor)
    if (this.opts.onOpenFile) {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.epub,application/epub+zip'
      input.hidden = true
      input.addEventListener('change', () => {
        const f = input.files?.[0]
        if (f) this.opts.onOpenFile!(f)
        input.value = ''
      })
      const btn = el('button', 'ts-set-wide-button') as HTMLButtonElement
      btn.type = 'button'
      btn.textContent = 'Open an EPUB…'
      btn.addEventListener('click', () => input.click())
      const hint = el('p', 'ts-set-hint')
      hint.textContent = 'Or drop an .epub file anywhere on the page. Books stay on this device.'
      book.append(btn, input, hint)
    }
    this.status = el('p', 'ts-set-status')
    this.status.setAttribute('role', 'status')
    this.status.hidden = true
    book.append(this.status)

    // Theme
    const theme = this.section('Theme')
    const swatches = el('div', 'ts-set-swatches')
    swatches.setAttribute('role', 'radiogroup')
    swatches.setAttribute('aria-label', 'Theme')
    for (const t of this.opts.themes) {
      const b = el('button', 'ts-set-swatch') as HTMLButtonElement
      b.type = 'button'
      b.setAttribute('role', 'radio')
      b.dataset.value = t.id
      b.innerHTML = `<span class="ts-set-swatch-chip" aria-hidden="true"><span></span></span><span class="ts-set-swatch-name"></span>`
      const chip = b.querySelector<HTMLElement>('.ts-set-swatch-chip')!
      chip.style.background = t.colors.paper
      chip.style.borderColor = t.colors.stroke
      chip.querySelector<HTMLElement>('span')!.style.background = t.colors.ink
      b.querySelector('.ts-set-swatch-name')!.textContent = t.name
      b.addEventListener('click', () => this.change({ theme: t.id }))
      swatches.append(b)
    }
    theme.append(swatches)

    // Typeface
    const type = this.section('Typeface')
    const list = el('div', 'ts-set-pairings')
    list.setAttribute('role', 'radiogroup')
    list.setAttribute('aria-label', 'Typeface')
    for (const pr of this.opts.pairings) {
      const b = el('button', 'ts-set-pairing') as HTMLButtonElement
      b.type = 'button'
      b.setAttribute('role', 'radio')
      b.dataset.value = pr.id
      b.innerHTML = '<span class="ts-set-specimen" aria-hidden="true">Aa</span><span class="ts-set-pairing-text"><span class="ts-set-pairing-name"></span><span class="ts-set-pairing-note"></span></span>'
      const spec = b.querySelector<HTMLElement>('.ts-set-specimen')!
      spec.style.fontFamily = pr.body
      const name = b.querySelector<HTMLElement>('.ts-set-pairing-name')!
      name.textContent = pr.name
      name.style.fontFamily = pr.heading
      name.style.fontWeight = String(pr.headingWeight)
      b.querySelector('.ts-set-pairing-note')!.textContent = pr.note ?? ''
      b.addEventListener('click', () => this.change({ pairing: pr.id }))
      list.append(b)
    }
    type.append(list)

    // Size
    const size = this.section('Size')
    const sizeRow = el('div', 'ts-set-stepper')
    const smaller = stepButton('Smaller text', 'A', 'is-small', () => this.change({ size: Math.max(0, this.settings.size - 1) }))
    const larger = stepButton('Larger text', 'A', 'is-large', () => this.change({ size: Math.min(SIZE_STEPS.length - 1, this.settings.size + 1) }))
    const dots = el('div', 'ts-set-dots')
    dots.setAttribute('aria-hidden', 'true')
    this.sizeDots = SIZE_STEPS.map(() => dots.appendChild(el('span', 'ts-set-dot')))
    sizeRow.append(smaller, dots, larger)
    size.append(sizeRow)

    this.segmented('Line spacing', 'leading', LEADING_LABELS)
    this.segmented('Column width', 'measure', MEASURE_LABELS)
    this.segmented('Paragraphs', 'paragraphs', { spaced: 'Spaced', indented: 'Indented' })

    this.sync()
  }

  private section(label: string): HTMLElement {
    const s = el('div', 'ts-set-section')
    const h = el('h3', 'ts-set-label')
    h.textContent = label
    s.append(h)
    this.panel.append(s)
    return s
  }

  private segmented<K extends 'leading' | 'measure' | 'paragraphs'>(label: string, key: K, options: Record<string, string>): void {
    const s = this.section(label)
    const group = el('div', 'ts-set-segmented')
    group.setAttribute('role', 'radiogroup')
    group.setAttribute('aria-label', label)
    group.dataset.key = key
    for (const [value, text] of Object.entries(options)) {
      const b = el('button', 'ts-set-segment') as HTMLButtonElement
      b.type = 'button'
      b.setAttribute('role', 'radio')
      b.dataset.value = value
      b.textContent = text
      b.addEventListener('click', () => this.change({ [key]: value } as Partial<ReaderSettings>))
      group.append(b)
    }
    s.append(group)
  }

  private change(patch: Partial<ReaderSettings>): void {
    this.settings = { ...this.settings, ...patch }
    this.sync()
    this.opts.onChange(patch)
  }

  private sync(): void {
    const s = this.settings
    const mark = (selector: string, value: string) => {
      for (const b of this.panel.querySelectorAll<HTMLElement>(selector)) {
        const on = b.dataset.value === value
        b.setAttribute('aria-checked', String(on))
        b.classList.toggle('is-selected', on)
      }
    }
    mark('.ts-set-swatch', s.theme)
    mark('.ts-set-pairing', s.pairing)
    for (const g of this.panel.querySelectorAll<HTMLElement>('.ts-set-segmented')) {
      const value = String(s[g.dataset.key as keyof ReaderSettings])
      for (const b of g.querySelectorAll<HTMLElement>('.ts-set-segment')) {
        const on = b.dataset.value === value
        b.setAttribute('aria-checked', String(on))
        b.classList.toggle('is-selected', on)
      }
    }
    this.sizeDots.forEach((d, i) => d.classList.toggle('is-on', i <= s.size))
    const [smaller, larger] = this.panel.querySelectorAll<HTMLButtonElement>('.ts-set-step')
    if (smaller) smaller.disabled = s.size <= 0
    if (larger) larger.disabled = s.size >= SIZE_STEPS.length - 1
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !this.panel.hidden) {
      this.close()
      this.button.focus()
    }
  }

  private onOutside = (e: PointerEvent) => {
    if (this.panel.hidden) return
    const t = e.target as Node
    if (!this.panel.contains(t) && !this.button.contains(t)) this.close()
  }
}

function el(tag: string, className: string): HTMLElement {
  const e = document.createElement(tag)
  e.className = className
  return e
}

function stepButton(label: string, text: string, extra: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', `ts-set-step ${extra}`) as HTMLButtonElement
  b.type = 'button'
  b.textContent = text
  b.setAttribute('aria-label', label)
  b.addEventListener('click', onClick)
  return b
}
