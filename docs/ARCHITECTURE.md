# Typestory — architecture & research notes

## The one idea everything rests on

The browser never wraps a single line of body text. **Pretext decides every line break**, and the DOM only paints what it was told. Each line is an absolutely positioned `<span>` with `white-space: pre`.

That costs a little (we own line painting), and it buys three things a normal reflowing page can't do cheaply:

1. **Exact heights without the DOM.** The whole book's height is arithmetic, so the scrollbar is honest from the first frame and only the blocks near the viewport are in the DOM at all (8 blocks for a 200-chapter book in testing).
2. **Variable-width lines.** `layoutNextRichInlineLineRange` takes a different `maxWidth` per line, so text can wrap around any shape, including one that moves.
3. **Deterministic layouts.** For any figure position we can compute exactly where every line goes, before painting. That's what makes animating *between* layouts (the scatter-and-settle idea) tractable.

## Why scrolling works here when "one static screen" was easier

Pretext demos tend to be a single screen because the hard part of scrolling is keeping a long document's geometry stable. Typestory deals with that by splitting the work by **block** (paragraph):

- Each paragraph is `prepareRichInline`'d once (fonts must be loaded first; `clearCache()` after).
- `DocumentLayout.reflow(width, field)` walks the blocks top to bottom. A block is only *re-broken* if the width changed, an obstacle overlaps it, or it was bent last frame and needs to settle. Every other block just gets a new `top`.
- Re-breaking the one or two paragraphs a figure touches costs ~0.03–0.05 ms. A full relayout of 1,280 blocks (200 chapters) costs ~5–7 ms, which only happens on resize.
- When a figure pushes a paragraph taller, everything below it shifts down by the difference. Blocks above never move, so the reading position doesn't jump.

## Modules

| File | Role |
|---|---|
| `src/layout/document.ts` | Book → flat block list; spacing rules; `reflow()`; lazy line materialization |
| `src/layout/field.ts` | Obstacles (`CircleObstacle`, `RectObstacle`) and `Field.slots()`: free horizontal intervals per line band |
| `src/render/column.ts` | Virtualized painter. Keyed by block index; repaints lines only when a block's layout `version` changes; moves with `transform` |
| `src/figures/figure.ts` | Margin figures: home anchoring, drag, spring return (react-motion "gentle"), scroll-linked `onFrame` hook |
| `src/ui/*` | Progress rule, chapter rail, theme toggle |
| `src/reader.ts` | Wires it together: scroll source (window or element), one rAF loop, resize with reading-position anchoring |
| `src/format/markdown.ts` | Minimal Markdown → `Book` importer with typographer's quotes |

## Pretext rules we must keep (from its README)

- Prepare only after the web font has loaded (`document.fonts.load(font, sampleText)`), then `clearCache()`.
- Font sizes and line heights are whole px. Column widths are rounded.
- No `text-rendering: optimizeLegibility`, `hyphens: auto`, `text-wrap: pretty/balance`, `font-variation-settings`, or `font-optical-sizing` tricks on painted text. **Variable fonts with an `opsz` axis are risky**; the demo uses static Newsreader instances.
- Use a named font first in the stack, never `system-ui`.
- Hyphenation = insert soft hyphens (U+00AD) before `prepare`. Not done yet.

`npm run check:browser` re-wraps every on-screen paragraph with the browser's own engine and compares line counts. All paragraphs matched at desktop and mobile widths when this was written.

## Next: words that scatter and settle

The current prototype bends whole lines around a figure, and they snap to their new positions each frame. The scattering idea needs **word-level motion**. Proposed approach (FLIP between two Pretext layouts):

1. **Word identity.** Every word gets a stable id from its block index and segment cursor. Layouts A (before) and B (after) share ids even when the words land on different lines.
2. **Word positions.** For a materialized line, compute each word's x offset with the same canvas `measureText` and font string Pretext used. That keeps the offsets consistent with Pretext's widths. Paint words as individual spans only inside the "disturbed" region, and keep whole-line spans everywhere else.
3. **Animate A → B** per word with springs, adding a velocity impulse away from the figure's motion vector for the scatter. When the figure leaves, B becomes the natural layout again and words spring home. The settle comes for free because the target is always a real layout.
4. **Budget.** Only words within a radius of the figure animate, about 100–300 spans. Everything else stays line-painted. The test is frame time under 4 ms on a mid-range phone.

Open questions to test:

- Should displaced paragraphs **grow** (push text below down, as now) or keep a **fixed height**, with overflow words tucked into the band after the figure? Fixed height avoids any shift below the disturbance.
- Hull shapes for drawn figures: trace an alpha-mask polygon (as in Pretext's dynamic-layout demo) rather than a circle.
- Accessibility: during motion, the DOM text order must stay reading order, and `prefers-reduced-motion` should turn scattering into a plain wrap.
- Find-in-page (Cmd+F) can't see virtualized blocks. Consider a hidden full-text layer or an in-reader search.
