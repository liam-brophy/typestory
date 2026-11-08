/** A run of inline text sharing one style. */
export type Run = {
  text: string
  em?: boolean
  strong?: boolean
}

export type Block =
  | { kind: 'paragraph'; runs: Run[] }
  | { kind: 'quote'; runs: Run[] }
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
