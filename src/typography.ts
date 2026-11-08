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
  subhead: TextStyle
  label: TextStyle
  /** Widest text column in px. The column narrows below this on small screens. */
  maxMeasure: number
  /** Minimum side margin in px around the column on narrow screens. */
  minMargin: number
  /** 'spaced' = space between paragraphs (web); 'indented' = first-line indent (book). */
  paragraphStyle: 'spaced' | 'indented'
  /** Indent size for quotes and indented paragraphs, in px. */
  indent: number
  /** CSS font-family for interface chrome (rail labels, settings). Not measured by Pretext. */
  uiFamily: string
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

/** Every font string a typography can paint, for preloading. */
export function fontStrings(typo: Typography): string[] {
  const fonts = new Set<string>()
  for (const s of [typo.body, typo.heading, typo.subhead, typo.label]) {
    fonts.add(fontString(s))
    fonts.add(fontString(s, { em: true }))
    fonts.add(fontString(s, { strong: true }))
    fonts.add(fontString(s, { em: true, strong: true }))
  }
  return [...fonts]
}

/**
 * Waits for every face the reader will paint. The caller must then clear
 * Pretext's cache. `document.fonts.ready` alone isn't enough: unused faces
 * never start loading. Never hangs: after the timeout we set type with what's there.
 */
export async function loadFonts(typo: Typography, sample: string, timeoutMs = 4000): Promise<void> {
  const loads = Promise.all(fontStrings(typo).map(f => document.fonts.load(f, sample).catch(() => [])))
  await Promise.race([loads, new Promise(r => setTimeout(r, timeoutMs))])
}
