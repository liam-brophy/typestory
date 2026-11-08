import type { DocumentLayout, LayoutBlock } from '../layout/document'
import { applyStyle, fontString } from '../typography'

type Mounted = { el: HTMLElement; version: number; top: number }

const TAG: Record<LayoutBlock['kind'], string> = {
  label: 'div',
  heading: 'h2',
  paragraph: 'p',
  quote: 'blockquote',
  break: 'div',
}

/**
 * Paints the Pretext layout into the DOM. Each line is its own absolutely
 * positioned element, so the browser never wraps anything: Pretext decided
 * every break. Only blocks near the viewport exist in the DOM at all.
 */
export class ColumnRenderer {
  readonly el: HTMLElement
  readonly figureLayer: HTMLElement
  private readonly textLayer: HTMLElement
  private mounted = new Map<number, Mounted>()

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div')
    this.el.className = 'ts-column'
    this.textLayer = document.createElement('div')
    this.textLayer.className = 'ts-text'
    this.figureLayer = document.createElement('div')
    this.figureLayer.className = 'ts-figures'
    this.el.append(this.textLayer, this.figureLayer)
    parent.append(this.el)
  }

  /** Paint blocks intersecting [viewTop, viewBottom] (column coordinates). */
  render(doc: DocumentLayout, viewTop: number, viewBottom: number): void {
    this.el.style.width = `${doc.width}px`
    this.el.style.height = `${doc.totalHeight}px`
    if (!doc.blocks.length) return

    const first = doc.blockAt(viewTop)
    let last = first
    while (last + 1 < doc.blocks.length && doc.blocks[last + 1].top < viewBottom) last++

    for (const [i, m] of this.mounted) {
      if (i < first || i > last) {
        m.el.remove()
        this.mounted.delete(i)
      }
    }
    for (let i = first; i <= last; i++) {
      const b = doc.blocks[i]
      let m = this.mounted.get(i)
      if (!m) {
        m = { el: this.createBlock(b), version: -1, top: NaN }
        this.mounted.set(i, m)
        this.insertInOrder(i, m.el)
      }
      if (m.version !== b.version) {
        this.paintLines(doc, b, m.el)
        m.version = b.version
      }
      if (m.top !== b.top) {
        m.el.style.transform = `translate3d(0, ${b.top}px, 0)`
        m.top = b.top
      }
    }
  }

  /** Drop all painted blocks, e.g. after typography changes. */
  clear(): void {
    for (const m of this.mounted.values()) m.el.remove()
    this.mounted.clear()
  }

  private createBlock(b: LayoutBlock): HTMLElement {
    const el = document.createElement(TAG[b.kind])
    el.className = `ts-block ts-${b.kind}`
    el.dataset.block = String(b.index)
    if (b.kind === 'break') el.setAttribute('role', 'separator')
    else applyStyle(el, b.style)
    return el
  }

  private paintLines(doc: DocumentLayout, b: LayoutBlock, el: HTMLElement): void {
    el.style.height = `${b.height}px`
    if (b.kind === 'break') {
      if (!el.firstChild) el.append(document.createElement('span'))
      return
    }
    const base = fontString(b.style)
    const lines = doc.linesFor(b)
    const frag = document.createDocumentFragment()
    for (let i = 0; i < lines.length; i++) {
      const placed = b.lines[i]
      const line = document.createElement('span')
      line.className = 'ts-line'
      line.style.transform = `translate(${placed.x}px, ${placed.y}px)`
      for (const f of lines[i].fragments) {
        const run = b.runs[f.itemIndex]
        const text = (f.gapBefore > 0 ? ' ' : '') + f.text
        const font = fontString(b.style, run)
        if (font === base) line.append(text)
        else {
          const span = document.createElement(run.em ? 'em' : 'strong')
          span.style.font = font
          span.textContent = text
          line.append(span)
        }
      }
      frag.append(line)
      // A real space between lines keeps copy/paste and screen readers from
      // gluing the last word of one line to the first word of the next.
      frag.append(' ')
    }
    el.replaceChildren(frag)
  }

  private insertInOrder(index: number, el: HTMLElement): void {
    // Keep DOM order equal to reading order for selection and assistive tech.
    let next: HTMLElement | null = null
    let best = Infinity
    for (const [i, m] of this.mounted) if (i > index && i < best) { best = i; next = m.el }
    this.textLayer.insertBefore(el, next)
  }
}
