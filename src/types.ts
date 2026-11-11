/** A run of inline text sharing one style. */
export type Run = {
  text: string
  em?: boolean
  strong?: boolean
}

export type Block =
  /** `note`: this paragraph is a footnote or endnote; the value is its marker ("1", "*", or "" if none). */
  | { kind: 'paragraph'; runs: Run[]; note?: string }
  | { kind: 'quote'; runs: Run[] }
  /** A heading inside a chapter (EPUB h2–h6 below the chapter title). */
  | { kind: 'subhead'; runs: Run[] }
  | { kind: 'break' }

export type Chapter = {
  id: string
  title: string
  /** Optional small label set above the title, e.g. "Chapter One". */
  label?: string
  blocks: Block[]
}

export type Book = {
  title: string
  author?: string
  chapters: Chapter[]
}
