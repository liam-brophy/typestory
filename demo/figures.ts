// Placeholder line drawings for margin figures. Stroke colour comes from the theme.

export const CUBE = `<svg viewBox="-50 -50 100 100" fill="none" stroke="currentColor" stroke-width="1" stroke-linejoin="round">
  <path d="M0 -34 L30 -17 L30 17 L0 34 L-30 17 L-30 -17 Z"/>
  <path d="M-30 -17 L0 0 L30 -17 M0 0 L0 34"/>
  <path d="M0 -34 L0 0" stroke-dasharray="2 3" opacity="0.5"/>
</svg>`

function seed(): string {
  let s = 7
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647)
  const rays: string[] = []
  for (let i = 0; i < 34; i++) {
    const a = (i / 34) * Math.PI * 2 + rand() * 0.12
    const r0 = 15 + rand() * 4
    const r1 = 30 + rand() * 30
    const x0 = Math.cos(a) * r0, y0 = Math.sin(a) * r0
    const x1 = Math.cos(a) * r1, y1 = Math.sin(a) * r1
    rays.push(`<path d="M${x0.toFixed(1)} ${y0.toFixed(1)} L${x1.toFixed(1)} ${y1.toFixed(1)}"/>`)
    if (rand() > 0.55) rays.push(`<circle cx="${x1.toFixed(1)}" cy="${y1.toFixed(1)}" r="${(1 + rand() * 2).toFixed(1)}"/>`)
  }
  return `<svg viewBox="-64 -64 128 128" fill="none" stroke="currentColor" stroke-width="0.8" stroke-linecap="round">
    <circle r="14"/><circle r="9" opacity="0.6"/><circle cx="3" cy="-2" r="3"/>
    ${rays.join('')}
  </svg>`
}

export const SEED = seed()
