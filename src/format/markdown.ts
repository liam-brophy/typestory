import type { Block, Book, Chapter, Run } from '../types'

/**
 * Minimal Markdown → Book importer, enough for drafting and testing:
 *   # Book title            (first line, optional)
 *   ## Chapter title        starts a chapter; "## Label | Title" sets a small label
 *   blank-line paragraphs, *em*, _em_, **strong**
 *   > quote paragraphs
 *   * * *  or  ***          section break
 */
export function parseMarkdownBook(md: string): Book {
  const book: Book = { title: '', chapters: [] }
  let chapter: Chapter | null = null
  const chunks = md.replace(/\r\n?/g, '\n').split(/\n\s*\n/)

  for (const raw of chunks) {
    const chunk = raw.trim()
    if (!chunk) continue
    if (/^#\s/.test(chunk) && !book.title) {
      book.title = chunk.replace(/^#\s+/, '')
      continue
    }
    if (/^##\s/.test(chunk)) {
      const heading = chunk.replace(/^##\s+/, '')
      const [label, title] = heading.includes('|') ? heading.split('|').map(s => s.trim()) : [undefined, heading]
      chapter = { id: slug(title!) || `chapter-${book.chapters.length + 1}`, title: title!, label, blocks: [] }
      book.chapters.push(chapter)
      continue
    }
    if (!chapter) {
      chapter = { id: 'start', title: book.title || 'Untitled', blocks: [] }
      book.chapters.push(chapter)
    }
    let block: Block
    if (/^(\*\s*){3,}$|^-{3,}$/.test(chunk)) block = { kind: 'break' }
    else if (chunk.startsWith('>')) block = { kind: 'quote', runs: inline(chunk.replace(/^>\s?/gm, '')) }
    else block = { kind: 'paragraph', runs: inline(chunk) }
    chapter.blocks.push(block)
  }
  return book
}

function inline(text: string): Run[] {
  const flat = typographer(text.replace(/\s*\n\s*/g, ' '))
  const runs: Run[] = []
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_)/g
  let last = 0
  for (const m of flat.matchAll(re)) {
    if (m.index! > last) runs.push({ text: flat.slice(last, m.index) })
    const tok = m[0]
    if (tok.startsWith('**')) runs.push({ text: tok.slice(2, -2), strong: true })
    else runs.push({ text: tok.slice(1, -1), em: true })
    last = m.index! + tok.length
  }
  if (last < flat.length) runs.push({ text: flat.slice(last) })
  return runs
}

/** Curly quotes, dashes, ellipses. A book deserves them. */
function typographer(s: string): string {
  return s
    .replace(/---/g, '—')
    .replace(/--/g, '–')
    .replace(/\.\.\./g, '…')
    .replace(/(^|[\s(\[{—–])"/g, '$1“')
    .replace(/"/g, '”')
    .replace(/(^|[\s(\[{—–])'/g, '$1‘')
    .replace(/'/g, '’')
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}
