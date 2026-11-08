export type Theme = 'light' | 'dark'

const KEY = 'typestory:theme'

function stored(): Theme | null {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : null
  } catch {
    return null
  }
}

export function initialTheme(fallback?: Theme): Theme {
  return stored() ?? fallback ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
}

const MOON = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M15.5 12.6A6.5 6.5 0 0 1 7.4 4.5a6.5 6.5 0 1 0 8.1 8.1Z"/></svg>'
const SUN = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="3.4"/><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4"/></svg>'

export class ThemeToggle {
  readonly el: HTMLButtonElement

  constructor(parent: HTMLElement, private root: HTMLElement, private theme: Theme) {
    this.el = document.createElement('button')
    this.el.type = 'button'
    this.el.className = 'ts-theme'
    this.el.addEventListener('click', () => this.set(this.theme === 'dark' ? 'light' : 'dark'))
    parent.append(this.el)
    this.set(theme, false)
  }

  set(theme: Theme, persist = true): void {
    this.theme = theme
    this.root.dataset.theme = theme
    this.el.innerHTML = theme === 'dark' ? SUN : MOON
    this.el.setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme')
    if (persist) try { localStorage.setItem(KEY, theme) } catch { /* storage unavailable */ }
  }
}
