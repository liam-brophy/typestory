/**
 * The thin rule across the top of the frame. A heavier segment grows from the
 * left as the current chapter is read, and resets at each new chapter.
 */
export class ProgressRule {
  readonly el: HTMLElement
  private readonly bar: HTMLElement
  private last = -1

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div')
    this.el.className = 'ts-rule'
    this.el.setAttribute('role', 'progressbar')
    this.el.setAttribute('aria-label', 'Chapter progress')
    this.el.setAttribute('aria-valuemin', '0')
    this.el.setAttribute('aria-valuemax', '100')
    this.bar = document.createElement('div')
    this.bar.className = 'ts-rule-bar'
    this.el.append(this.bar)
    parent.append(this.el)
  }

  set(progress: number): void {
    const p = Math.max(0, Math.min(1, progress))
    if (Math.abs(p - this.last) < 0.0005) return
    this.last = p
    this.bar.style.transform = `scaleX(${p})`
    this.el.setAttribute('aria-valuenow', String(Math.round(p * 100)))
  }
}
