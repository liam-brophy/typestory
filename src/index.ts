import './styles.css'

export { Reader, type ReaderOptions, type ReaderPosition } from './reader'
export { MarginFigure, type FigureOptions, type FigureScrollInfo } from './figures/figure'
export { DocumentLayout, type LayoutBlock, type PlacedLine } from './layout/document'
export { Field, CircleObstacle, RectObstacle, type Obstacle, type Interval } from './layout/field'
export { fontString, type Typography, type TextStyle } from './typography'
export {
  DEFAULT_PAIRINGS, DEFAULT_THEMES, DEFAULT_SETTINGS, typographyFor, applyTheme,
  type FontPairing, type ThemeDef, type ReaderSettings,
} from './settings'
export { parseMarkdownBook } from './format/markdown'
export { parseEpub, EpubError } from './format/epub'
export type { Book, Chapter, Block, Run } from './types'
export type { RailMode } from './ui/chapter-rail'
