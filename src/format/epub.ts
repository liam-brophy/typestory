import { unzipSync } from 'fflate'
import type { Block, Book, Chapter, Run } from '../types'

/**
 * EPUB 2/3 → Book, entirely in the browser.
 *
 * Reads the spine in order and turns each XHTML document's text into blocks
 * (paragraphs, quotes, subheads, section breaks) with italic/bold runs.
 * Chapter titles come from the EPUB3 nav document or the EPUB2 NCX. When the
 * table of contents points at anchors inside one file (common in Project
 * Gutenberg books), the file is split at those anchors.
 *
 * Not handled yet: images, tables as tables, footnote pop-ups, right-to-left
 * page progression, fixed-layout books, DRM-protected files.
 */
export async function parseEpub(data: ArrayBuffer | Uint8Array): Promise<Book> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes)
  } catch {
    throw new EpubError('This file is not a readable EPUB (it could not be unzipped).')
  }
  const text = (path: string) => {
    const f = files[path] ?? files[decodeURIComponent(path)]
    return f ? new TextDecoder('utf-8').decode(f) : null
  }

  if (files['META-INF/encryption.xml'] && /EncryptedData/.test(text('META-INF/encryption.xml') ?? '')) {
    const enc = text('META-INF/encryption.xml')!
    // Font obfuscation is harmless; anything else means DRM.
    if (!/http:\/\/www\.idpf\.org\/2008\/embedding|http:\/\/ns\.adobe\.com\/pdf\/enc#RC/.test(enc) || /\.x?html/.test(enc)) {
      throw new EpubError('This EPUB is DRM-protected, so its text can’t be read.')
    }
  }

  const container = xml(text('META-INF/container.xml'), 'META-INF/container.xml')
  const opfPath = container.querySelector('rootfile')?.getAttribute('full-path')
  if (!opfPath) throw new EpubError('This EPUB has no package document.')
  const opf = xml(text(opfPath), opfPath)
  const base = dirname(opfPath)

  const title = opf.querySelector('metadata > title, metadata title')?.textContent?.trim() || 'Untitled'
  const author = [...opf.querySelectorAll('metadata > creator, metadata creator')].map(e => e.textContent?.trim()).filter(Boolean).join(', ') || undefined

  type Item = { href: string; type: string; props: string }
  const manifest = new Map<string, Item>()
  for (const it of opf.querySelectorAll('manifest > item')) {
    manifest.set(it.getAttribute('id') ?? '', {
      href: resolve(base, it.getAttribute('href') ?? ''),
      type: it.getAttribute('media-type') ?? '',
      props: it.getAttribute('properties') ?? '',
    })
  }

  // Table of contents: file → [{ fragment, title }] in reading order.
  const toc = new Map<string, { fragment: string | null; title: string }[]>()
  const addToc = (href: string, label: string) => {
    const [file, fragment] = href.split('#')
    if (!label.trim()) return
    const list = toc.get(file) ?? []
    if (!list.some(e => e.fragment === (fragment ?? null))) list.push({ fragment: fragment ?? null, title: clean(label) })
    toc.set(file, list)
  }
  const navItem = [...manifest.values()].find(i => i.props.split(/\s+/).includes('nav'))
  const navDoc = navItem && text(navItem.href)
  if (navDoc) {
    const nav = html(navDoc)
    const tocNav = [...nav.querySelectorAll('nav')].find(n => /toc/.test(n.getAttribute('epub:type') ?? n.getAttribute('role') ?? '')) ?? nav.querySelector('nav')
    for (const a of tocNav?.querySelectorAll('a[href]') ?? []) addToc(resolve(dirname(navItem.href), a.getAttribute('href')!), a.textContent ?? '')
  } else {
    const ncxId = opf.querySelector('spine')?.getAttribute('toc')
    const ncxItem = (ncxId && manifest.get(ncxId)) || [...manifest.values()].find(i => i.type === 'application/x-dtbncx+xml')
    const ncxText = ncxItem && text(ncxItem.href)
    if (ncxText) {
      const ncx = xml(ncxText, ncxItem.href)
      for (const np of ncx.querySelectorAll('navPoint')) {
        const src = np.querySelector(':scope > content')?.getAttribute('src')
        const label = np.querySelector(':scope > navLabel')?.textContent ?? ''
        if (src) addToc(resolve(dirname(ncxItem.href), src), label)
      }
    }
  }

  const chapters: Chapter[] = []
  const usedIds = new Set<string>()
  const spine = [...opf.querySelectorAll('spine > itemref')]
  for (const ref of spine) {
    if (ref.getAttribute('linear') === 'no') continue
    const item = manifest.get(ref.getAttribute('idref') ?? '')
    if (!item || !/x?html/.test(item.type)) continue
    const src = text(item.href)
    if (!src) continue
    const doc = html(src)
    const entries = toc.get(item.href) ?? []
    const splits = new Map<string, string>() // anchor id → title
    for (const e of entries) if (e.fragment && doc.getElementById(e.fragment)) splits.set(e.fragment, e.title)
    const fileTitle = entries.find(e => !e.fragment)?.title ?? (splits.size ? null : entries[0]?.title ?? null)

    const sections = extractSections(doc.body ?? doc.documentElement, splits)
    sections.forEach((sec, i) => {
      let t = sec.title ?? (i === 0 ? fileTitle : null)
      // Drop a leading heading that just repeats the chapter title, or adopt it as the title.
      const first = sec.blocks[0]
      if (first?.kind === 'subhead') {
        const ht = first.runs.map(r => r.text).join('').trim()
        if (!t || sameText(ht, t)) { t = t ?? ht; sec.blocks.shift() }
      }
      if (!sec.blocks.some(b => b.kind !== 'break')) {
        // A title page or a cover with no text: keep it only if the TOC names it.
        if (!t) return
      }
      const id = uniqueId(slug(t ?? '') || `section-${chapters.length + 1}`, usedIds)
      chapters.push({ id, title: t ?? `Section ${chapters.length + 1}`, blocks: trimBreaks(sec.blocks) })
    })
  }

  if (!chapters.length) throw new EpubError('No readable text was found in this EPUB.')
  return { title: clean(title), author: author && clean(author), chapters }
}

export class EpubError extends Error {}

// ── XHTML → blocks ─────────────────────────────────────────

const SKIP = new Set(['head', 'script', 'style', 'svg', 'math', 'img', 'image', 'video', 'audio', 'object', 'iframe', 'noscript', 'template'])
const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
const LEAF_BLOCKS = new Set(['p', 'li', 'dt', 'dd', 'figcaption', 'pre', 'caption', 'td', 'th', 'address'])
const CONTAINERS = new Set(['body', 'div', 'section', 'article', 'main', 'header', 'footer', 'aside', 'nav', 'ul', 'ol', 'dl', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'figure', 'hgroup', 'center', 'blockquote'])
const EM = new Set(['em', 'i', 'cite', 'dfn', 'var'])
const STRONG = new Set(['strong', 'b'])

type Section = { title: string | null; blocks: Block[] }

function extractSections(root: Element, splits: Map<string, string>): Section[] {
  const sections: Section[] = [{ title: null, blocks: [] }]
  const cur = () => sections[sections.length - 1]

  const startIfAnchor = (el: Element) => {
    const id = el.getAttribute('id')
    if (id && splits.has(id)) {
      // Start a new section unless the current one is still empty.
      if (cur().blocks.length || cur().title) sections.push({ title: splits.get(id)!, blocks: [] })
      else cur().title = splits.get(id)!
      splits.delete(id)
    }
    // Anchors can also sit on descendants, e.g. <h2><a id="chap01"/>…</h2>.
    for (const [id2, t] of splits) {
      if (el.querySelector(`[id="${CSS.escape(id2)}"]`) && !hasBlockDescendant(el)) {
        if (cur().blocks.length || cur().title) sections.push({ title: t, blocks: [] })
        else cur().title = t
        splits.delete(id2)
      }
    }
  }

  const walk = (el: Element, quote: boolean) => {
    const tag = el.localName.toLowerCase()
    if (SKIP.has(tag)) return
    startIfAnchor(el)
    if (tag === 'hr') { cur().blocks.push({ kind: 'break' }); return }
    if (/(^|\s)(pagebreak|page-break)(\s|$)/.test(el.getAttribute('epub:type') ?? '')) return
    if (HEADINGS.has(tag)) {
      const runs = inlineRuns(el)
      if (runs.length) cur().blocks.push({ kind: 'subhead', runs })
      return
    }
    if (LEAF_BLOCKS.has(tag) || (CONTAINERS.has(tag) && !hasBlockChild(el))) {
      if (tag === 'blockquote') quote = true
      pushText(el, quote)
      return
    }
    // Mixed container: walk children, gathering stray inline content into paragraphs.
    let loose: Node[] = []
    const flush = () => {
      if (!loose.length) return
      const holder = el.ownerDocument.createElement('p')
      for (const n of loose) holder.append(n.cloneNode(true))
      pushText(holder, quote)
      loose = []
    }
    for (const child of [...el.childNodes]) {
      if (child.nodeType === 1 && isBlock(child as Element)) {
        flush()
        walk(child as Element, quote || tag === 'blockquote')
      } else loose.push(child)
    }
    flush()
  }

  const pushText = (el: Element, quote: boolean) => {
    const runs = inlineRuns(el)
    if (!runs.length) return
    const plain = runs.map(r => r.text).join('').trim()
    if (/^([*·•⁂~#]\s*){1,5}$/.test(plain)) { cur().blocks.push({ kind: 'break' }); return }
    cur().blocks.push({ kind: quote ? 'quote' : 'paragraph', runs })
  }

  walk(root, false)
  return sections
}

function isBlock(el: Element): boolean {
  const t = el.localName.toLowerCase()
  return HEADINGS.has(t) || LEAF_BLOCKS.has(t) || CONTAINERS.has(t) || t === 'hr'
}
function hasBlockChild(el: Element): boolean {
  for (const c of el.children) if (isBlock(c)) return true
  return false
}
function hasBlockDescendant(el: Element): boolean {
  return !!el.querySelector('p, div, section, h1, h2, h3, h4, h5, h6, li, blockquote')
}

/** Flatten inline markup into styled runs with collapsed whitespace. */
function inlineRuns(el: Element): Run[] {
  const runs: Run[] = []
  const visit = (node: Node, em: boolean, strong: boolean) => {
    if (node.nodeType === 3) {
      const t = (node.nodeValue ?? '').replace(/[\s ]+/g, m => (m.includes(' ') && m.length === 1 ? ' ' : ' '))
      if (t) runs.push({ text: t, em, strong })
      return
    }
    if (node.nodeType !== 1) return
    const e = node as Element
    const tag = e.localName.toLowerCase()
    if (SKIP.has(tag)) return
    if (tag === 'br') { runs.push({ text: ' ', em, strong }); return }
    // Footnote reference markers would read as stray numbers mid-sentence.
    if (/noteref/.test(e.getAttribute('epub:type') ?? '') || (tag === 'sup' && e.querySelector('a[href]'))) return
    const style = e.getAttribute('style') ?? ''
    const nextEm = em !== (EM.has(tag) || /font-style:\s*italic/.test(style)) // nested em flips back
    const nextStrong = strong || STRONG.has(tag) || /font-weight:\s*(bold|[6-9]00)/.test(style)
    for (const c of e.childNodes) visit(c, nextEm, nextStrong)
  }
  for (const c of el.childNodes) visit(c, false, false)

  // Merge neighbours with the same style; trim the paragraph's edges.
  const merged: Run[] = []
  for (const r of runs) {
    const last = merged[merged.length - 1]
    if (last && !!last.em === !!r.em && !!last.strong === !!r.strong) last.text += r.text
    else merged.push({ ...r })
  }
  for (const r of merged) r.text = r.text.replace(/ {2,}/g, ' ')
  while (merged.length && !merged[0].text.trim()) merged.shift()
  while (merged.length && !merged[merged.length - 1].text.trim()) merged.pop()
  if (merged.length) {
    merged[0].text = merged[0].text.replace(/^\s+/, '')
    merged[merged.length - 1].text = merged[merged.length - 1].text.replace(/\s+$/, '')
  }
  return merged.map(r => {
    const out: Run = { text: r.text }
    if (r.em) out.em = true
    if (r.strong) out.strong = true
    return out
  })
}

function trimBreaks(blocks: Block[]): Block[] {
  const out = blocks.filter((b, i) => !(b.kind === 'break' && blocks[i - 1]?.kind === 'break'))
  while (out[0]?.kind === 'break') out.shift()
  while (out[out.length - 1]?.kind === 'break') out.pop()
  return out
}

// ── helpers ────────────────────────────────────────────────

function xml(src: string | null, path: string): Document {
  if (!src) throw new EpubError(`This EPUB is missing ${path}.`)
  const doc = new DOMParser().parseFromString(src, 'application/xml')
  if (doc.querySelector('parsererror')) return new DOMParser().parseFromString(src, 'text/html')
  return doc
}

function html(src: string): Document {
  // Strict XHTML first (keeps namespaced attributes like epub:type); fall back to
  // the forgiving HTML parser for the many EPUBs with malformed markup.
  const strict = new DOMParser().parseFromString(src, 'application/xhtml+xml')
  if (!strict.querySelector('parsererror') && strict.body) return strict
  return new DOMParser().parseFromString(src, 'text/html')
}

function dirname(p: string): string {
  const i = p.lastIndexOf('/')
  return i < 0 ? '' : p.slice(0, i + 1)
}

function resolve(base: string, href: string): string {
  const [path, frag] = href.split('#')
  const parts = (base + decodeURIComponent(path)).split('/')
  const out: string[] = []
  for (const seg of parts) {
    if (seg === '..') out.pop()
    else if (seg !== '.' && seg !== '') out.push(seg)
  }
  return out.join('/') + (frag !== undefined ? `#${frag}` : '')
}

function clean(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

function sameText(a: string, b: string): boolean {
  const n = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
  return n(a) === n(b) || n(b).endsWith(n(a)) || n(a).endsWith(n(b))
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
}

function uniqueId(id: string, used: Set<string>): string {
  let out = id, n = 2
  while (used.has(out)) out = `${id}-${n++}`
  used.add(out)
  return out
}
