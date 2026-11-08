import type { Typography } from './typography'

// ── font pairings ──────────────────────────────────────────

/**
 * A pairing names font families only. The host page is responsible for
 * loading the faces (e.g. `@fontsource/...` imports or a Google Fonts link).
 * Use static fonts: Pretext can't see variable-font axes such as `opsz`.
 */
export type FontPairing = {
  id: string
  name: string
  /** One line shown under the name in the settings panel. */
  note?: string
  body: string
  heading: string
  headingWeight: number
  /** Chrome font (rail labels, settings). */
  ui: string
  /**
   * Body size in px at the default size step on a desktop screen. Tuned per
   * face so that x-heights read alike across pairings.
   */
  baseSize: number
  /** Multiplier on line spacing for faces with tall or short proportions. */
  leading?: number
}

const SANS_FALLBACK = '"Helvetica Neue", Arial, sans-serif'
const SERIF_FALLBACK = 'Georgia, serif'
const q = (family: string, fallback: string) => `"${family}", ${fallback}`

export const DEFAULT_PAIRINGS: FontPairing[] = [
  {
    id: 'editorial', name: 'Editorial', note: 'Newsreader with Inter',
    body: q('Newsreader', SERIF_FALLBACK), heading: q('Newsreader', SERIF_FALLBACK), headingWeight: 500,
    ui: q('Inter', SANS_FALLBACK), baseSize: 22,
  },
  {
    id: 'classic', name: 'Classic', note: 'EB Garamond throughout',
    body: q('EB Garamond', SERIF_FALLBACK), heading: q('EB Garamond', SERIF_FALLBACK), headingWeight: 500,
    ui: q('Inter', SANS_FALLBACK), baseSize: 23, leading: 1.02,
  },
  {
    id: 'literary', name: 'Literary', note: 'Literata, made for long reading',
    body: q('Literata', SERIF_FALLBACK), heading: q('Literata', SERIF_FALLBACK), headingWeight: 500,
    ui: q('Inter', SANS_FALLBACK), baseSize: 20, leading: 1.02,
  },
  {
    id: 'contemporary', name: 'Contemporary', note: 'Source Serif with Source Sans',
    body: q('Source Serif 4', SERIF_FALLBACK), heading: q('Source Sans 3', SANS_FALLBACK), headingWeight: 600,
    ui: q('Source Sans 3', SANS_FALLBACK), baseSize: 21,
  },
  {
    id: 'technical', name: 'Technical', note: 'IBM Plex Serif with Plex Sans',
    body: q('IBM Plex Serif', SERIF_FALLBACK), heading: q('IBM Plex Sans', SANS_FALLBACK), headingWeight: 500,
    ui: q('IBM Plex Sans', SANS_FALLBACK), baseSize: 20, leading: 1.02,
  },
  {
    id: 'hyperlegible', name: 'Hyperlegible', note: 'Atkinson Hyperlegible, for low vision',
    body: q('Atkinson Hyperlegible Next', SANS_FALLBACK), heading: q('Atkinson Hyperlegible Next', SANS_FALLBACK), headingWeight: 600,
    ui: q('Atkinson Hyperlegible Next', SANS_FALLBACK), baseSize: 21, leading: 1.04,
  },
]

// ── themes ─────────────────────────────────────────────────

export type ThemeDef = {
  id: string
  name: string
  scheme: 'light' | 'dark'
  colors: {
    paper: string
    ink: string
    muted: string
    /** Rules, ticks, borders, figure line work. */
    stroke: string
    strokeSoft: string
  }
}

export const DEFAULT_THEMES: ThemeDef[] = [
  {
    id: 'light', name: 'Light', scheme: 'light',
    colors: { paper: '#fbf9f5', ink: '#1b1a17', muted: '#8d887f', stroke: '#1b1a17', strokeSoft: 'rgba(27, 26, 23, 0.22)' },
  },
  {
    id: 'dark', name: 'Dark', scheme: 'dark',
    colors: { paper: '#0c1018', ink: '#e7e4dd', muted: '#6c7789', stroke: '#9fb8e8', strokeSoft: 'rgba(159, 184, 232, 0.28)' },
  },
]

// ── reader settings ────────────────────────────────────────

export const SIZE_STEPS = [0.82, 0.9, 1, 1.1, 1.22, 1.36] as const
export const LEADING = { tight: 1.42, normal: 1.58, loose: 1.78 } as const
/** Column width in ems of the body size. 30em ≈ 66 characters in most book faces. */
export const MEASURE = { narrow: 26, normal: 30, wide: 35 } as const

export type ReaderSettings = {
  theme: string
  pairing: string
  /** Index into SIZE_STEPS. */
  size: number
  leading: keyof typeof LEADING
  measure: keyof typeof MEASURE
  paragraphs: 'spaced' | 'indented'
}

export const DEFAULT_SETTINGS: ReaderSettings = {
  theme: 'light',
  pairing: 'editorial',
  size: 2,
  leading: 'normal',
  measure: 'normal',
  paragraphs: 'spaced',
}

/** Derive concrete, whole-pixel typography for a viewport width. */
export function typographyFor(s: ReaderSettings, pairing: FontPairing, viewportWidth: number): Typography {
  const compact = viewportWidth < 720
  const base = compact ? pairing.baseSize * 0.86 : pairing.baseSize
  const size = Math.round(base * SIZE_STEPS[clampStep(s.size)])
  const lh = Math.round(size * LEADING[s.leading] * (pairing.leading ?? 1))
  const hSize = Math.round(size * (compact ? 1.55 : 1.8))
  const subSize = Math.round(size * 1.2)
  const labelSize = Math.max(12, Math.round(size * 0.68))
  return {
    body: { family: pairing.body, size, lineHeight: lh, weight: 400 },
    heading: { family: pairing.heading, size: hSize, lineHeight: Math.round(hSize * 1.18), weight: pairing.headingWeight },
    subhead: { family: pairing.heading, size: subSize, lineHeight: Math.round(subSize * 1.35), weight: pairing.headingWeight },
    label: { family: pairing.body, size: labelSize, lineHeight: Math.round(labelSize * 1.6), weight: 400, italic: true },
    maxMeasure: Math.round(size * MEASURE[s.measure]),
    minMargin: compact ? 22 : 40,
    paragraphStyle: s.paragraphs,
    indent: Math.round(size * 1.3),
    uiFamily: pairing.ui,
  }
}

export function clampStep(n: number): number {
  return Math.max(0, Math.min(SIZE_STEPS.length - 1, Math.round(n)))
}

const KEY = 'typestory:settings'

export function loadSettings(): Partial<ReaderSettings> {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

export function saveSettings(s: ReaderSettings): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* storage unavailable */ }
}

export function applyTheme(root: HTMLElement, theme: ThemeDef): void {
  root.dataset.theme = theme.id
  root.style.colorScheme = theme.scheme
  const c = theme.colors
  root.style.setProperty('--ts-paper', c.paper)
  root.style.setProperty('--ts-ink', c.ink)
  root.style.setProperty('--ts-muted', c.muted)
  root.style.setProperty('--ts-stroke', c.stroke)
  root.style.setProperty('--ts-stroke-soft', c.strokeSoft)
}
