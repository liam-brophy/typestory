# Typestory — notes for Claude Code

A web e-reading framework (vanilla TypeScript library + demo app). Text is set with
[Pretext](https://github.com/chenglou/pretext) (`@chenglou/pretext`): Pretext decides every
line break and the DOM only paints absolutely positioned lines. Read `docs/ARCHITECTURE.md`
before changing layout or rendering.

## Commands

```sh
npm run dev                         # demo at localhost:5173 (?sample, ?stress=40, ?rail=open)
npm run typecheck
npm run build                       # library → dist/ (typestory.js + typestory.css)
npm run build:demo                  # single-file demo → dist-demo/index.html (fonts inlined)
python3 scripts/make-epubs.py       # test EPUBs → scripts/fixtures/
node scripts/settings-check.mjs     # every pairing vs browser wrapping, settings, EPUB import
npm run check:browser               # layout, drag, long books, built demo in a sandboxed iframe
```

The check scripts drive Chromium via Playwright: run `npx playwright install chromium` once,
or set `CHROME=/path/to/chrome` to use an installed Chrome.
After any change to layout, fonts or CSS, run the checks: a passing typecheck has hidden real
bugs here before (see Gotchas).

## Product decisions (from Liam)

- **Top rule**: thin rule across the top; a heavier segment fills as the *current chapter* is
  read. Chapter progress only — never whole-book progress.
- **Chapter rail** (left edge): one tick per chapter. Rests collapsed (ticks only). Unfolds on
  mouseover / keyboard focus, and briefly (~2.4 s) on its own when a new chapter is reached.
  Menu button pins it. On phones it's a menu button; no auto-peek there.
- **Text**: centred column, ~66 characters, flush left / ragged right, never justified.
- **Settings ("Aa" drawer)**: theme, typeface pairing, size, line spacing, column width,
  spaced vs indented paragraphs. Persisted; changes keep the reader's place.
- **Themes** are data (`ThemeDef` in `src/settings.ts`). Liam has moodboards for more themes —
  ask whether a theme changes only colours or also type/texture/rules before designing it.
- **EPUB upload** via settings or drag-and-drop; parsed in the browser (`src/format/epub.ts`).
- **Margin figures**: line drawings in the margin, scroll-animated; can be dragged into the
  text, which reflows around them live and settles when they spring home.
- **Next big piece**: words that *scatter and settle* as a figure moves through the text
  (word-level FLIP between two Pretext layouts). Plan in `docs/ARCHITECTURE.md`. Open
  question: should a disturbed paragraph grow (push text down, current) or keep its height?
- Visual language: clean, thin 1px strokes, calm, accessible. Liam is a professional book
  designer: typographic details (indents, spacing after headings, real quotes/dashes) matter.

## Pretext rules the CSS must keep

- Prepare text only after the web font loads, then `clearCache()`.
- Whole-px font sizes and line heights; rounded column widths.
- Static fonts only (no `opsz`/variable axes); named family first in the stack.
- No `text-rendering: optimizeLegibility`, `hyphens: auto`, `text-wrap: pretty/balance`.
- Painted fonts must exactly match `fontString()` in `src/typography.ts`.

## Gotchas already hit

- `vite build` (Vite 8) tree-shook `src/styles.css` when package.json had a `sideEffects`
  pattern. Don't re-add `sideEffects`; the demo imports the stylesheet explicitly, and
  `scripts/inline-demo.mjs` fails the build if reader CSS is missing.
- Hosts that serve pages in sandboxed, origin-less iframes (claude.ai artifacts) block Vite's
  `crossorigin` asset tags — hence the single-file demo build.
- `all: unset` resets inherit `pointer-events: none` from `.ts-chrome`, and a
  `.ts-settings button` reset out-specifies component rules — use `:where()` for resets.

## Layout of the code

- `src/layout/document.ts` — book → blocks, spacing, `reflow()` (only re-breaks blocks that
  changed width or touch an obstacle), prepared-handle reuse across setting changes
- `src/layout/field.ts` — obstacles and free line slots
- `src/render/column.ts` — virtualized line painter
- `src/reader.ts` — the `Reader` class: settings, typesetting, scroll, frame loop, upload
- `src/ui/` — progress rule, chapter rail, settings panel
- `src/figures/figure.ts` — draggable margin figures with spring return
- `demo/` — sample book (original text), fonts, figure drawings, last-book IndexedDB store
