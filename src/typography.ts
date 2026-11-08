import type { Run } from './types'

/**
 * Typography settings. Everything Pretext measures is expressed in whole px,
 * because Pretext needs the exact canvas font string and line height the CSS uses.
 */
export type TextStyle = {
  /** CSS font-family list. The first family must be a named, loaded web font. */
  family: string
  size: number
  lineHeight: number
  weight: number
  italic?: boolean
  letterSpacing?: number
}

export type Typography = {
  body: TextStyle
  heading: TextStyle
  label: TextStyle
  /** Widest text column in px. The column narrows below this on small screens. */
  maxMeasure: number
  /** Minimum side margin in px around the column on narrow screens. */
  minMargin: number
  /** 'spaced' = space between paragraphs (web); 'indented' = first-line indent (book). */
  paragraphStyle: 'spaced' | 'indented'
  /** Indent size for quotes and indented paragraphs, in px. */
  indent: number
}

const SERIF = '"Newsreader", Georgia, serif'

export function defaultTypography(viewportWidth: number): Typography {
  const compact = viewportWidth < 720
  const body: TextStyle = compact
    ? { family: SERIF, size: 19, lineHeight: 30, weight: 400 }
    : { family: SERIF, size: 22, lineHeight: 35, weight: 400 }
  return {
    body,
    heading: compact
      ? { family: SERIF, size: 30, lineHeight: 36, weight: 500 }
      : { family: SERIF, size: 40, lineHeight: 48, weight: 500 },
    label: { family: SERIF, size: compact ? 14 : 15, lineHeight: 24, weight: 400, italic: true },
    maxMeasure: compact ? 600 : 660,
    minMargin: compact ? 22 : 40,
    paragraphStyle: 'spaced',
    indent: compact ? 22 : 28,
  }
}

/** Canvas/CSS font shorthand for a style, optionally modified by inline emphasis. */
export function fontString(style: TextStyle, run?: Pick<Run, 'em' | 'strong'>): string {
  const italic = !!style.italic !== !!run?.em // em inside italic text flips back to roman
  const weight = run?.strong ? Math.max(style.weight + 200, 600) : style.weight
  return `${italic ? 'italic ' : ''}${weight} ${style.size}px ${style.family}`
}

/** Applies a style to an element so painted text matches what Pretext measured. */
export function applyStyle(el: HTMLElement, style: TextStyle): void {
  el.style.font = fontString(style)
  el.style.lineHeight = `${style.lineHeight}px`
  el.style.letterSpacing = style.letterSpacing ? `${style.letterSpacing}px` : ''
}

/**
 * Waits for every face the reader will paint, then the caller must clear Pretext's cache.
 * `document.fonts.ready` alone isn't enough: unused faces never start loading.
 */
export async function loadFonts(typo: Typography, sample: string): Promise<void> {
  const styles = [typo.body, typo.heading, typo.label]
  const fonts = new Set<string>()
  for (const s of styles) {
    fonts.add(fontString(s))
    fonts.add(fontString(s, { em: true }))
    fonts.add(fontString(s, { strong: true }))
    fonts.add(fontString(s, { em: true, strong: true }))
  }
  await Promise.all([...fonts].map(f => document.fonts.load(f, sample).catch(() => [])))
}
