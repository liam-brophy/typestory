import { CircleObstacle } from '../layout/field'

export type FigureScrollInfo = {
  /** 0 when the figure's anchor enters the bottom of the viewport, 1 when it leaves the top. */
  progress: number
  /** Seconds since mount, for idle motion. */
  time: number
}

export type FigureOptions = {
  /** Chapter index or id the figure belongs to. */
  chapter: number | string
  /** Source block index within the chapter to sit beside. Defaults to the first block. */
  block?: number
  side?: 'right' | 'left'
  /** Diameter in px. The figure is treated as a circle when it displaces text. */
  size: number
  /** Markup (e.g. inline SVG) or an element to show. */
  content: string | HTMLElement
  /** Let the reader pick the figure up and drag it through the text. */
  draggable?: boolean
  /** Clear space kept between the figure and the words it pushes, in px. */
  padding?: number
  /** Scroll-linked animation hook. Runs every frame while the figure is near the viewport. */
  onFrame?: (art: HTMLElement, info: FigureScrollInfo) => void
  label?: string
}

type Mode = 'home' | 'drag' | 'return'

// Spring constants borrowed from react-motion's "gentle" preset.
const STIFFNESS = 120
const DAMPING = 14

export class MarginFigure {
  readonly el: HTMLElement
  readonly art: HTMLElement
  readonly obstacle: CircleObstacle
  chapter = 0
  homeX = 0
  homeY = 0
  private x = 0
  private y = 0
  private vx = 0
  private vy = 0
  private mode: Mode = 'home'
  private grab = { dx: 0, dy: 0 }
  private placed = false
  private started = performance.now()

  constructor(
    public opts: FigureOptions,
    layer: HTMLElement,
    /** Converts a client-space point to column coordinates. */
    private toColumn: (clientX: number, clientY: number) => { x: number; y: number },
    private wake: () => void,
  ) {
    this.obstacle = new CircleObstacle(0, 0, opts.size / 2, opts.padding ?? 14)
    this.el = document.createElement('div')
    this.el.className = 'ts-figure'
    this.el.style.width = this.el.style.height = `${opts.size}px`
    if (opts.label) this.el.setAttribute('aria-label', opts.label)
    this.el.setAttribute('role', 'img')
    this.art = document.createElement('div')
    this.art.className = 'ts-figure-art'
    if (typeof opts.content === 'string') this.art.innerHTML = opts.content
    else this.art.append(opts.content)
    this.el.append(this.art)
    layer.append(this.el)

    if (opts.draggable) {
      this.el.classList.add('is-draggable')
      this.el.addEventListener('pointerdown', this.onDown)
    }
  }

  get animating(): boolean {
    return this.mode !== 'home'
  }

  /** Where the figure rests, in column coordinates (centre point). */
  setHome(x: number, y: number): void {
    this.homeX = x
    this.homeY = y
    if (!this.placed || this.mode === 'home') {
      this.x = x
      this.y = y
      this.placed = true
    }
  }

  /** Advance the spring. Returns true while still moving. */
  step(dt: number): boolean {
    if (this.mode === 'return') {
      const ax = -STIFFNESS * (this.x - this.homeX) - DAMPING * this.vx
      const ay = -STIFFNESS * (this.y - this.homeY) - DAMPING * this.vy
      this.vx += ax * dt
      this.vy += ay * dt
      this.x += this.vx * dt
      this.y += this.vy * dt
      const rest = Math.hypot(this.x - this.homeX, this.y - this.homeY) < 0.3 && Math.hypot(this.vx, this.vy) < 0.3
      if (rest) {
        this.x = this.homeX
        this.y = this.homeY
        this.vx = this.vy = 0
        this.mode = 'home'
        this.el.classList.remove('is-loose')
      }
    }
    this.obstacle.cx = this.x
    this.obstacle.cy = this.y
    return this.mode !== 'home'
  }

  /** Returns true if a frame hook ran (the figure wants another frame). */
  paint(viewTop: number, viewBottom: number): boolean {
    const r = this.opts.size / 2
    this.el.style.transform = `translate3d(${this.x - r}px, ${this.y - r}px, 0)`
    if (this.opts.onFrame && this.y + r > viewTop - 200 && this.y - r < viewBottom + 200) {
      const span = viewBottom - viewTop + this.opts.size
      const progress = Math.max(0, Math.min(1, (viewBottom + r - this.y) / span))
      this.opts.onFrame(this.art, { progress, time: (performance.now() - this.started) / 1000 })
      return true
    }
    return false
  }

  destroy(): void {
    this.el.remove()
  }

  private onDown = (e: PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    this.el.setPointerCapture(e.pointerId)
    const p = this.toColumn(e.clientX, e.clientY)
    this.grab = { dx: this.x - p.x, dy: this.y - p.y }
    this.mode = 'drag'
    this.vx = this.vy = 0
    this.el.classList.add('is-loose', 'is-dragging')
    this.el.addEventListener('pointermove', this.onMove)
    this.el.addEventListener('pointerup', this.onUp)
    this.el.addEventListener('pointercancel', this.onUp)
    this.wake()
  }

  private onMove = (e: PointerEvent) => {
    const p = this.toColumn(e.clientX, e.clientY)
    const nx = p.x + this.grab.dx
    const ny = p.y + this.grab.dy
    this.vx = (nx - this.x) * 60
    this.vy = (ny - this.y) * 60
    this.x = nx
    this.y = ny
    this.wake()
  }

  private onUp = (e: PointerEvent) => {
    this.el.releasePointerCapture(e.pointerId)
    this.el.removeEventListener('pointermove', this.onMove)
    this.el.removeEventListener('pointerup', this.onUp)
    this.el.removeEventListener('pointercancel', this.onUp)
    this.el.classList.remove('is-dragging')
    this.mode = 'return'
    this.wake()
  }
}
