/**
 * A Field describes where text may NOT go. Everything is in column coordinates:
 * x = 0 is the left edge of the text column, y = 0 is the top of the document.
 *
 * Obstacles are deliberately shape-agnostic: anything that can answer "which
 * horizontal span do you block between these two y values?" can push text around.
 * Today that's circles and rectangles. A drawn figure can later supply a polygon
 * hull traced from its alpha channel, as Pretext's dynamic-layout demo does.
 */
export type Interval = { left: number; right: number }

export interface Obstacle {
  /** Vertical extent of the obstacle, padding included. */
  top(): number
  bottom(): number
  /** Horizontal span blocked within the band [top, bottom], or null. */
  blocked(bandTop: number, bandBottom: number): Interval | null
}

export class CircleObstacle implements Obstacle {
  constructor(
    public cx: number,
    public cy: number,
    public r: number,
    /** Breathing room between the shape and the text. */
    public padding = 12,
  ) {}

  top() { return this.cy - this.r - this.padding }
  bottom() { return this.cy + this.r + this.padding }

  blocked(bandTop: number, bandBottom: number): Interval | null {
    const r = this.r + this.padding
    // Closest y inside the band to the circle's centre gives the widest chord.
    const nearest = Math.max(bandTop, Math.min(this.cy, bandBottom))
    const d = Math.abs(nearest - this.cy)
    if (d >= r) return null
    const half = Math.sqrt(r * r - d * d)
    return { left: this.cx - half, right: this.cx + half }
  }
}

export class RectObstacle implements Obstacle {
  constructor(public x: number, public y: number, public w: number, public h: number, public padding = 12) {}
  top() { return this.y - this.padding }
  bottom() { return this.y + this.h + this.padding }
  blocked(bandTop: number, bandBottom: number): Interval | null {
    if (bandBottom <= this.top() || bandTop >= this.bottom()) return null
    return { left: this.x - this.padding, right: this.x + this.w + this.padding }
  }
}

export class Field {
  obstacles = new Set<Obstacle>()

  get empty() { return this.obstacles.size === 0 }

  /** True when any obstacle overlaps the vertical range [top, bottom]. */
  touches(top: number, bottom: number): boolean {
    for (const o of this.obstacles) if (o.top() < bottom && o.bottom() > top) return true
    return false
  }

  /**
   * Free horizontal slots for one line band, within [left, right].
   * Slots narrower than `minWidth` are dropped so we never set two-letter shards.
   */
  slots(bandTop: number, bandBottom: number, left: number, right: number, minWidth: number): Interval[] {
    let free: Interval[] = [{ left, right }]
    for (const o of this.obstacles) {
      const b = o.blocked(bandTop, bandBottom)
      if (!b || b.right <= left || b.left >= right) continue
      const next: Interval[] = []
      for (const f of free) {
        if (b.right <= f.left || b.left >= f.right) { next.push(f); continue }
        if (b.left > f.left) next.push({ left: f.left, right: b.left })
        if (b.right < f.right) next.push({ left: b.right, right: f.right })
      }
      free = next
    }
    return free.filter(f => f.right - f.left >= minWidth)
  }
}
