import {
  layoutNextRichInlineLineRange,
  materializeRichInlineLineRange,
  prepareRichInline,
  type PreparedRichInline,
  type RichInlineCursor,
  type RichInlineLine,
  type RichInlineLineRange,
} from '@chenglou/pretext/rich-inline'
import type { Book, Run } from '../types'
import { fontString, type TextStyle, type Typography } from '../typography'
import type { Field } from './field'

export type BlockKind = 'label' | 'heading' | 'subhead' | 'paragraph' | 'quote' | 'break'

export type PlacedLine = {
  /** Left edge in column coordinates. */
  x: number
  /** Top edge relative to the block. */
  y: number
  range: RichInlineLineRange
}

export type LayoutBlock = {
  index: number
  chapter: number
  /** Index of this block within its chapter's source blocks, or -1 for label/heading. */
  sourceIndex: number
  kind: BlockKind
  runs: Run[]
  style: TextStyle
  prepared: PreparedRichInline | null
  /** Horizontal bounds inside the column. */
  left: number
  right: number
  firstIndent: number
  gapBefore: number
  top: number
  height: number
  lines: PlacedLine[]
  /** True when the last layout bent around an obstacle. */
  shaped: boolean
  /** Column width the lines were computed for. */
  layoutWidth: number
  /** Bumped whenever `lines` change, so renderers know to repaint. */
  version: number
  materialized?: { version: number; lines: RichInlineLine[] }
}

const MAX_BANDS = 5000

/**
 * The whole book as a flat list of blocks positioned by Pretext. Nothing here
 * touches the DOM: heights come from arithmetic, which is what makes the rest
 * possible (exact scroll height, virtualization, live reflow around obstacles).
 */
export class DocumentLayout {
  blocks: LayoutBlock[] = []
  chapterTops: number[] = []
  totalHeight = 0
  width = 0
  padTop = 112
  padBottom = 400

  constructor(public book: Book, public typo: Typography) {}

  /**
   * Pretext preparation. Call after fonts have loaded. When the book is
   * unchanged and a block's font string is the same as last time, its prepared
   * handle is reused: changing spacing or measure never re-measures text.
   * Returns how many blocks had to be prepared from scratch.
   */
  prepare(): number {
    const t = this.typo
    const previous = this.blocks
    const blocks: LayoutBlock[] = []
    let fresh = 0
    const styleFor = (kind: BlockKind) =>
      kind === 'label' ? t.label : kind === 'heading' ? t.heading : kind === 'subhead' ? t.subhead : t.body
    const push = (chapter: number, sourceIndex: number, kind: BlockKind, runs: Run[]) => {
      const style = styleFor(kind)
      const old = previous[blocks.length]
      let prepared: PreparedRichInline | null = null
      if (kind !== 'break') {
        const reuse = old && old.kind === kind && old.runs === runs && old.prepared && fontString(old.style) === fontString(style)
          && old.style.letterSpacing === style.letterSpacing
        prepared = reuse ? old.prepared : prep(runs, style)
        if (!reuse) fresh++
      }
      blocks.push({
        index: blocks.length, chapter, sourceIndex, kind, runs, style, prepared,
        top: 0, height: 0, lines: [], shaped: false, layoutWidth: -1, version: (old?.version ?? 0) + 1,
        gapBefore: 0, left: 0, right: 0, firstIndent: 0,
      })
    }

    this.book.chapters.forEach((ch, ci) => {
      if (ch.label) push(ci, -1, 'label', this.titleRuns(ch, 'label'))
      push(ci, -1, 'heading', this.titleRuns(ch, 'title'))
      ch.blocks.forEach((b, bi) => push(ci, bi, b.kind, b.kind === 'break' ? [] : b.runs))
    })
    this.blocks = blocks
    this.assignSpacing()
    return fresh
  }

  // Stable run arrays for titles so prepared handles can be reused by identity.
  private titleCache = new Map<string, Run[]>()
  private titleRuns(ch: { id: string; title: string; label?: string }, which: 'title' | 'label'): Run[] {
    const key = `${which}:${ch.id}:${which === 'title' ? ch.title : ch.label}`
    let runs = this.titleCache.get(key)
    if (!runs) this.titleCache.set(key, (runs = [{ text: (which === 'title' ? ch.title : ch.label) ?? '' }]))
    return runs
  }

  private assignSpacing(): void {
    const t = this.typo
    const lh = t.body.lineHeight
    let prev: LayoutBlock | null = null
    for (const b of this.blocks) {
      const chapterStart = !prev || prev.chapter !== b.chapter
      b.firstIndent = 0
      if (chapterStart) b.gapBefore = b.chapter === 0 ? 0 : lh * 5
      else if (b.kind === 'heading') b.gapBefore = Math.round(lh * 0.25)
      else if (prev!.kind === 'heading') b.gapBefore = Math.round(lh * 1.5)
      else if (b.kind === 'subhead') b.gapBefore = Math.round(lh * 1.4)
      else if (prev!.kind === 'subhead') b.gapBefore = Math.round(lh * 0.5)
      else if (b.kind === 'break' || prev!.kind === 'break') b.gapBefore = Math.round(lh * 0.5)
      else if (b.kind === 'quote' || prev!.kind === 'quote') b.gapBefore = Math.round(lh * 0.75)
      else if (t.paragraphStyle === 'spaced') b.gapBefore = Math.round(lh * 0.6)
      else {
        b.gapBefore = 0
        if (b.kind === 'paragraph' && prev!.kind === 'paragraph') b.firstIndent = t.indent
      }
      prev = b
    }
  }

  /**
   * Positions every block for a column width. Blocks are only re-broken when the
   * width changed, when an obstacle overlaps them, or when they were bent around
   * an obstacle last time and need to settle. Everything else just moves.
   * Returns true if any block's lines changed.
   */
  reflow(width: number, field: Field | null): boolean {
    this.width = width
    const indent = this.typo.indent
    let y = this.padTop
    let changed = false
    const tops: number[] = []
    for (const b of this.blocks) {
      y += b.gapBefore
      b.top = y
      if (b.kind === 'label' || b.kind === 'heading') if (tops[b.chapter] === undefined) tops[b.chapter] = y
      b.left = b.kind === 'quote' ? indent : 0
      b.right = b.kind === 'quote' ? width - indent : width

      const near = field && !field.empty && field.touches(b.top - b.style.lineHeight, b.top + Math.max(b.height, b.style.lineHeight) + b.style.lineHeight)
      if (b.layoutWidth !== width || b.shaped || near) {
        this.layoutBlock(b, near ? field : null)
        changed = true
      }
      y += b.height
    }
    this.chapterTops = tops
    this.totalHeight = y + this.padBottom
    return changed
  }

  private layoutBlock(b: LayoutBlock, field: Field | null): void {
    b.layoutWidth = this.width
    b.version++
    b.lines = []
    b.shaped = false
    if (b.kind === 'break') {
      b.height = b.style.lineHeight * 2
      return
    }
    const lh = b.style.lineHeight
    const minSlot = b.style.size * 4
    let cursor: RichInlineCursor | undefined
    let bandY = 0
    let first = true
    let done = false
    for (let band = 0; band < MAX_BANDS && !done; band++) {
      let slots = field
        ? field.slots(b.top + bandY, b.top + bandY + lh, b.left, b.right, minSlot)
        : [{ left: b.left, right: b.right }]
      if (field && (slots.length !== 1 || slots[0].left !== b.left || slots[0].right !== b.right)) b.shaped = true
      for (const s of slots) {
        const left = first ? s.left + b.firstIndent : s.left
        const range = layoutNextRichInlineLineRange(b.prepared!, Math.max(1, s.right - left), cursor)
        if (!range) { done = true; break }
        b.lines.push({ x: left, y: bandY, range })
        cursor = range.end
        first = false
      }
      if (!done) bandY += lh
    }
    b.height = b.lines.length ? b.lines[b.lines.length - 1].y + lh : 0
  }

  /** Materialized line text for painting, cached per layout version. */
  linesFor(b: LayoutBlock): RichInlineLine[] {
    if (!b.prepared) return []
    if (b.materialized?.version !== b.version) {
      b.materialized = { version: b.version, lines: b.lines.map(l => materializeRichInlineLineRange(b.prepared!, l.range)) }
    }
    return b.materialized.lines
  }

  /** Index of the first block whose bottom is below y (binary search). */
  blockAt(y: number): number {
    let lo = 0, hi = this.blocks.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      const b = this.blocks[mid]
      if (b.top + b.height < y) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  chapterAt(y: number): number {
    let c = 0
    for (let i = 0; i < this.chapterTops.length; i++) if (this.chapterTops[i] <= y) c = i
    return c
  }

  chapterEnd(c: number): number {
    return c + 1 < this.chapterTops.length ? this.chapterTops[c + 1] - this.blocks[this.blockIndexOfChapter(c + 1)].gapBefore : this.totalHeight - this.padBottom
  }

  blockIndexOfChapter(c: number): number {
    return this.blocks.findIndex(b => b.chapter === c)
  }
}

function prep(runs: Run[], style: TextStyle): PreparedRichInline {
  return prepareRichInline(
    runs.map(r => ({ text: r.text, font: fontString(style, r), letterSpacing: style.letterSpacing })),
  )
}
