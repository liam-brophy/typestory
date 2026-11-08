import type { Chapter } from '../types'

export type RailMode = 'auto' | 'open' | 'closed'

/**
 * The contents rail down the left edge: one tick per chapter.
 * Collapsed (while reading) it shows ticks only; open it shows titles beside them.
 * In 'auto' it collapses as soon as you scroll and opens on hover or keyboard focus.
 */
export class ChapterRail {
  readonly el: HTMLElement
  private readonly list: HTMLOListElement
  private readonly toggle: HTMLButtonElement
  private items: HTMLLIElement[] = []
  private current = -1
  private hovering = false
  // On small screens the open rail covers the text, so start collapsed there.
  private reading = matchMedia('(max-width: 719px)').matches

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
    this.sync()
  }

  setMode(mode: RailMode): void {
    this.mode = mode
    this.hovering = false
    this.sync()
  }

  /** Call on scroll: in auto mode, reading collapses the rail. */
  noteReading(): void {
    if (this.reading) return
    this.reading = true
    this.sync()
  }

  setCurrent(index: number, progress: number): void {
    if (index !== this.current) {
      this.items.forEach((li, i) => {
        li.classList.toggle('is-current', i === index)
        li.classList.toggle('is-read', i < index)
        li.querySelector('button')!.toggleAttribute('aria-current', i === index)
      })
      this.current = index
    }
    this.el.style.setProperty('--ts-chapter-progress', progress.toFixed(3))
  }

  private isOpen(): boolean {
    if (this.mode === 'open') return true
    if (this.mode === 'closed') return this.hovering
    return this.hovering || !this.reading
  }

  private sync(): void {
    const open = this.isOpen()
    this.el.classList.toggle('is-open', open)
    this.toggle.setAttribute('aria-expanded', String(open))
    this.toggle.setAttribute('aria-label', open ? 'Collapse chapters' : 'Show chapters')
  }
}
