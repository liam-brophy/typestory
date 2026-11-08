# Typestory

A web e-reading framework. Text is typeset with [Pretext](https://github.com/chenglou/pretext), so the reader knows the exact position of every line before painting it. That's what lets figures in the margin step into the text and push the words aside.

- **Progress rule.** A thin rule runs along the top, with a heavier segment that grows across as you read the current chapter.
- **Chapter rail.** One tick per chapter down the left edge. It shows titles at rest and collapses to ticks once you start reading. Hover, focus, or the menu button opens it again. On small screens it becomes a menu button.
- **Measure.** A centred, flush-left / ragged-right column at a comfortable reading width (≈ 66 characters).
- **Margin figures.** Line drawings anchored beside a paragraph, with scroll-linked animation hooks. They can be dragged into the text, which reflows around them live, and they spring home when released.
- Light and dark themes, window or embedded scrolling, virtualized rendering for book-length texts.

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
  book: parseMarkdownBook(markdown),
  scroll: 'window', // or 'element' to read inside a fixed-size frame
})

reader.addFigure({
  chapter: 0, block: 1, size: 120, draggable: true,
  content: '<svg>…</svg>',
  onFrame: (art, { progress }) => { art.style.transform = `rotate(${progress * 90}deg)` },
})

reader.on(({ chapter, progress }) => { /* save position, analytics, … */ })
```

Markdown format: `# Book title`, `## Label | Chapter title`, blank-line paragraphs, `*em*`, `**strong**`, `> quote`, `* * *` for a section break.

## How it works

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). It covers why scrolling stays smooth, the Pretext constraints the CSS must respect, and the plan for words that scatter and settle.
