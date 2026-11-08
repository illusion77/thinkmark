export type NodeKind = 'heading' | 'list';
export type Layout = 'map' | 'right' | 'left' | 'down';
export type LineStyle = 'curve' | 'elbow' | 'straight';

export interface MindImage {
  /** Link target exactly as written in Markdown (may be wrapped in <>). */
  src: string;
  alt: string;
  /** Display width in px, stored Obsidian-style as ![alt|240](src). */
  width?: number;
  /** Optional link title, kept verbatim including quotes. */
  title?: string;
  /** Whether the image token came before the topic text on its line. */
  atStart?: boolean;
}

export interface MindNode {
  id: string;
  /** Topic text (inline Markdown, image token removed, <br> as \n). */
  text: string;
  /** How the node is written in Markdown. Undefined for freshly created nodes. */
  kind?: NodeKind;
  /** Heading level as written in the source. */
  level?: number;
  /** List marker as written (-, *, +, 1., 1)). */
  marker?: string;
  /** Indentation (columns) of a list item relative to its parent list item. */
  indent?: number;
  task?: 'todo' | 'done';
  /** Main topics only: drawn on the left of the central topic in the mind map structure. */
  side?: 'left';
  /** Topic width in px set by dragging its edge in the map (none: fits the text). */
  width?: number;
  image?: MindImage;
  /** Topic hyperlink (Cmd+K): the topic line is written as [text](link). Kept as written (may be <...>). */
  link?: string;
  /** Optional link title, kept verbatim including quotes. */
  linkTitle?: string;
  /** Body Markdown attached to the topic (paragraphs, code, tables...). */
  note?: string;
  children: MindNode[];
  /** UI-only state. */
  collapsed?: boolean;
  /** 0-based source line of the heading / list item. */
  line?: number;
}

export interface MapSettings {
  layout?: Layout;
  theme?: string;
  lineStyle?: LineStyle;
}

export interface MindDoc {
  root: MindNode;
  /** True when the Markdown has no single top heading; the root is then the file name and is not written. */
  virtualRoot: boolean;
  /** Front matter lines (without the --- fences and without the mindmap: block). */
  frontMatter?: string[];
  /** Index in frontMatter where the mindmap: block was found (-1: append). */
  mindmapAt: number;
  /** Unknown lines inside the mindmap: block, kept verbatim. */
  mindmapExtra: string[];
  /** Text before the first heading / list item. */
  preamble?: string;
  settings: MapSettings;
  eol: string;
  /** Most common nested list indentation in the source. */
  indentUnit: number;
}

export interface SerializeOptions {
  /** New topics with no siblings become headings for the first N tree levels (root = level 1). */
  headingLevels: number;
}
