import type { Layout, LineStyle } from './model';

export interface MindConfig {
  defaultLayout: Layout;
  defaultTheme: string;
  defaultLineStyle: LineStyle;
  headingLevels: number;
  syncSelection: boolean;
  /** Wrap widths in em (≈ one CJK character each) for the central topic, main topics and deeper topics. */
  topicMaxWidth?: { central: number; main: number; sub: number };
  /** Mark misspelled English words while editing. */
  spellCheck?: boolean;
}

export type ToWebview =
  | { type: 'init'; text: string; baseUri: string | null; fileName: string; config: MindConfig; lang: string; canSaveImages: boolean }
  | { type: 'update'; text: string }
  | { type: 'ack'; text: string }
  | { type: 'config'; config: MindConfig }
  | { type: 'imageReady'; nodeId: string; src: string }
  | { type: 'selectLine'; line: number }
  /** Answer to 'spellCheck': `bad` are the misspelled ones of `words`. */
  | { type: 'spellResult'; words: string[]; bad: string[] }
  | { type: 'spellSuggestions'; word: string; suggestions: string[] };

export type FromWebview =
  | { type: 'ready' }
  | { type: 'edit'; text: string }
  | { type: 'pickImage'; nodeId: string }
  | { type: 'saveImage'; nodeId: string; name: string; mime: string; data: string }
  | { type: 'linkImages'; nodeId: string; uris: string[] }
  | { type: 'openLink'; href: string }
  | { type: 'openImage'; src: string }
  | { type: 'openSource' }
  | { type: 'cleanupImages' }
  | { type: 'revealLine'; line: number }
  | { type: 'notify'; level: 'info' | 'warn' | 'error'; message: string }
  | { type: 'spellCheck'; words: string[] }
  | { type: 'spellSuggest'; word: string }
  /** Add a word to the user's dictionary. */
  | { type: 'spellAdd'; word: string };
