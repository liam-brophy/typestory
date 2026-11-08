import '@fontsource/newsreader/latin-400.css'
import '@fontsource/newsreader/latin-400-italic.css'
import '@fontsource/newsreader/latin-500.css'
import '@fontsource/newsreader/latin-500-italic.css'
import '@fontsource/newsreader/latin-600.css'
import '@fontsource/newsreader/latin-600-italic.css'
import '@fontsource/inter/latin-400.css'
import { parseMarkdownBook, Reader, type Book } from '../src'
import { CUBE, SEED } from './figures'
import sample from './sample.md?raw'

const params = new URLSearchParams(location.search)
let book: Book = parseMarkdownBook(sample)

// ?stress=20 repeats the book to test long-document scrolling.
const stress = Number(params.get('stress') ?? 0)
if (stress > 1) {
  const base = book.chapters
  book = {
    ...book,
    chapters: Array.from({ length: stress }, (_, n) =>
      base.map(c => ({ ...c, id: `${c.id}-${n}`, title: n ? `${c.title} (${n + 1})` : c.title })),
    ).flat(),
  }
}

const reader = await Reader.mount(document.getElementById('reader')!, {
  book,
  rail: (params.get('rail') as 'auto' | 'open' | 'closed') ?? 'auto',
})

reader.addFigure({
  chapter: 0,
  block: 1,
  size: 92,
  content: CUBE,
  draggable: true,
  label: 'A small wireframe cube',
  onFrame: (art, { progress }) => {
    art.style.transform = `rotate(${(progress * 160 - 80).toFixed(2)}deg)`
  },
})

reader.addFigure({
  chapter: 1,
  block: 2,
  size: 150,
  content: SEED,
  draggable: true,
  label: 'An ink drawing of a seed head',
  onFrame: (art, { progress, time }) => {
    const breathe = 1 + Math.sin(time * 1.4) * 0.025
    art.style.transform = `rotate(${(progress * 90).toFixed(2)}deg) scale(${breathe.toFixed(4)})`
  },
})

// Handy while developing.
Object.assign(window, { reader })
