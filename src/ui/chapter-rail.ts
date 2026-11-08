import type { Chapter } from '../types'

export type RailMode = 'auto' | 'open' | 'closed'

/**
 * The contents rail down the left edge: one tick per chapter.
 * Collapsed it shows ticks only; open it shows titles beside them.
 * In 'auto' it rests collapsed, unfolds on hover or keyboard focus, and
 * unfolds briefly on its own when the reader crosses into a new chapter.
 */
export class ChapterRail {
  readonly el: HTMLElement
  private readonly list: HTMLOListElement
  private readonly toggle: HTMLButtonElement
  private items: HTMLLIElement[] = []
  private current = -1
  private hovering = false
  private peeking = false
  private peekTimer = 0
  /** How long the rail stays unfolded after a chapter change, in ms. */
  peekDuration = 2400

  constructor(
    parent: HTMLElement,
    chapters: Chapter[],
    private onSelect: (index: number) => void,
    private mode: RailMode = 'auto',
  ) {
    this.el = document.createElement('nav')
    this.el.className = 'ts-rail'
    this.el.setAttribute('aria-label', 'Chapters')

    this.toggle = document.createElement('button')
    this.toggle.className = 'ts-rail-toggle'
    this.toggle.type = 'button'
    this.toggle.innerHTML = '<span></span><span></span><span></span>'
    this.toggle.addEventListener('click', () => this.setMode(this.isOpen() ? 'closed' : 'open'))

    this.list = document.createElement('ol')
    this.list.className = 'ts-rail-list'
    chapters.forEach((ch, i) => {
      const li = document.createElement('li')
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'ts-rail-item'
      btn.innerHTML = '<span class="ts-tick" aria-hidden="true"></span><span class="ts-rail-label"></span>'
      btn.querySelector('.ts-rail-label')!.textContent = ch.title
      btn.addEventListener('click', () => this.onSelect(i))
      li.append(btn)
      this.list.append(li)
      this.items.push(li)
    })

    this.el.append(this.toggle, this.list)
    this.el.addEventListener('pointerenter', () => { this.hovering = true; this.sync() })
    this.el.addEventListener('pointerleave', () => { this.hovering = false; this.sync() })
    this.el.addEventListener('focusin', () => { this.hovering = true; this.sync() })
    this.el.addEventListener('focusout', e => {
      if (!this.el.contains(e.relatedTarget as Node)) { this.hovering = false; this.sync() }
    })
    parent.append(this.el)
    this.fit()
    window.addEventListener('resize', this.fit)
    this.sync()
  }

  private centreCurrent(): void {
    const li = this.items[this.current]
    if (!li) return
    const target = li.offsetTop - this.list.offsetTop - (this.list.clientHeight - li.offsetHeight) / 2
    this.list.scrollTo({ top: Math.max(0, target), behavior: 'smooth' })
  }

  destroy(): void {
    clearTimeout(this.peekTimer)
    window.removeEventListener('resize', this.fit)
    this.el.remove()
  }

  /** Long books: squeeze collapsed ticks so every chapter fits down the edge. */
  private fit = () => {
    const n = Math.max(1, this.items.length)
    const step = Math.max(5, Math.min(30, (window.innerHeight * 0.7) / n))
    this.el.style.setProperty('--ts-rail-step', `${step.toFixed(2)}px`)
    this.el.classList.toggle('is-dense', step < 18)
  }

  setMode(mode: RailMode): void {
    this.mode = mode
    this.hovering = false
    this.sync()
  }

  setCurrent(index: number, progress: number): void {
    if (index !== this.current) {
      const wasOpen = this.el.classList.contains('is-open')
      if (this.current !== -1) this.peek()
      this.items.forEach((li, i) => {
        li.classList.toggle('is-current', i === index)
        li.classList.toggle('is-read', i < index)
        li.querySelector('button')!.toggleAttribute('aria-current', i === index)
      })
      this.current = index
      if (wasOpen) this.centreCurrent()
    }
    this.el.style.setProperty('--ts-chapter-progress', progress.toFixed(3))
  }

  private isOpen(): boolean {
    if (this.mode === 'open') return true
    if (this.mode === 'closed') return this.hovering
    return this.hovering || this.peeking
  }

  /** Unfold momentarily, e.g. on entering a new chapter. Skipped on small screens, where the open rail covers the text. */
  private peek(): void {
    if (this.mode !== 'auto' || matchMedia('(max-width: 719px)').matches) return
    this.peeking = true
    this.el.classList.add('is-peeking')
    this.sync()
    clearTimeout(this.peekTimer)
    this.peekTimer = window.setTimeout(() => {
      this.peeking = false
      this.el.classList.remove('is-peeking')
      this.sync()
    }, this.peekDuration)
  }

  private sync(): void {
    const open = this.isOpen()
    if (open && !this.el.classList.contains('is-open')) {
      // Bring the current chapter into view in a long, scrolling list.
      // Wait for collapsed ticks to grow to full rows, then centre the current
      // chapter by scrolling the list itself (never the page).
      setTimeout(() => this.centreCurrent(), 280)
    }
    this.el.classList.toggle('is-open', open)
    this.toggle.setAttribute('aria-expanded', String(open))
    this.toggle.setAttribute('aria-label', open ? 'Collapse chapters' : 'Show chapters')
  }
}
