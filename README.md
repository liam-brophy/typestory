# Typestory

A web e-reading framework. Text is typeset with [Pretext](https://github.com/chenglou/pretext), so the reader knows the exact position of every line before painting it. That's what lets figures in the margin step into the text and push the words aside.

- **Progress rule.** A thin rule runs along the top, with a heavier segment that grows across as you read the current chapter. It tracks the chapter only, not the whole book.
- **Chapter rail.** One tick per chapter down the left edge, collapsed while you read. It unfolds to show titles on mouseover or keyboard focus, and for a moment on its own when you cross into a new chapter. The menu button pins it open. On small screens it becomes a menu button.
- **Measure.** A centred, flush-left / ragged-right column at a comfortable reading width (≈ 66 characters).
- **Margin figures.** Line drawings anchored beside a paragraph, with scroll-linked animation hooks. They can be dragged into the text, which reflows around them live, and they spring home when released.
- **Settings drawer ("Aa").** Theme, typeface pairing, size, line spacing, column width, and spaced or indented paragraphs. Settings are remembered, and changing them keeps your place in the text.
- **EPUB import.** Open or drop an `.epub` and it's set in the same format, entirely in the browser. EPUB 2 and 3 are supported, with chapter titles from the table of contents and italics, quotes, section breaks and subheads preserved.
- Window or embedded scrolling, and virtualized rendering for book-length texts (a 93,000-word EPUB sets in about 130 ms).

## Run it

```sh
npm install
npm run dev            # demo at http://localhost:5173
npm run check:browser  # headless Chrome: Pretext vs browser wrapping, drag test, screenshots → scripts/out/
npm run build          # library → dist/
npm run build:demo     # static demo site → dist-demo/
```

Demo URL options: `?stress=40` (200 chapters), `?rail=open|closed|auto`.

## Use it

```ts
import { Reader, parseMarkdownBook } from 'typestory'
import 'typestory/style.css'
import '@fontsource/newsreader/400.css' // + italic and weights you use

const reader = await Reader.mount(document.getElementById('reader')!, {
  book: parseMarkdownBook(markdown),   // or: await parseEpub(arrayBuffer)
  scroll: 'window',                    // or 'element' to read inside a fixed-size frame
  allowUpload: true,                   // "Open an EPUB…" + drag and drop
  // pairings: [...], themes: [...], settings: { pairing: 'classic' }
})

reader.addFigure({
  chapter: 0, block: 1, size: 120, draggable: true,
  content: '<svg>…</svg>',
  onFrame: (art, { progress }) => { art.style.transform = `rotate(${progress * 90}deg)` },
})

reader.on(({ chapter, progress }) => { /* save position, analytics, … */ })
```

Markdown format: `# Book title`, `## Label | Chapter title`, blank-line paragraphs, `*em*`, `**strong**`, `> quote`, `* * *` for a section break.

## Themes and typefaces

Themes are plain data, so new ones (from a moodboard, say) are one object each:

```ts
import { DEFAULT_THEMES, type ThemeDef } from 'typestory'

const vellum: ThemeDef = {
  id: 'vellum', name: 'Vellum', scheme: 'light',
  colors: { paper: '#f3ead8', ink: '#2a2118', muted: '#8a7a62', stroke: '#2a2118', strokeSoft: 'rgba(42,33,24,.2)' },
}
Reader.mount(el, { book, themes: [...DEFAULT_THEMES, vellum] })
```

A typeface pairing names families plus a `baseSize`, tuned so that x-heights read alike. The host page loads the font files. The demo uses `@fontsource` static fonts (see `demo/fonts.ts`). Use **static** fonts: Pretext measures through the canvas `font` string, which can't express variable axes such as `opsz`.

## Checks

```sh
python3 scripts/make-epubs.py      # test EPUBs → scripts/fixtures/
node scripts/settings-check.mjs    # every pairing vs browser wrapping, settings, EPUB import
npm run build:demo && npm run check:browser   # layout, drag, long books, built demo in a sandboxed frame
```

## How it works

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). It covers why scrolling stays smooth, the Pretext constraints the CSS must respect, and the plan for words that scatter and settle.
