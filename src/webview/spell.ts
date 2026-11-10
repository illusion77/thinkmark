/**
 * Spell checking in the webview's text boxes (topic text, note).
 *
 * VS Code turns off Chromium's own spell checker, so `spellcheck` on a textarea does nothing there.
 * Instead the words are sent to the extension, which has the dictionary, and the misspelled ones are
 * marked in a copy of the text that lies exactly under (topic) or over (note) the text box.
 */
import type { FromWebview } from '../shared/protocol';
import { spellWords, type SpellWord } from '../shared/spellText';
import { escapeHtml } from './inline';

type Field = HTMLTextAreaElement;

interface Host {
  post(m: FromWebview): void;
  /** The marks may have changed although the text did not: an answer arrived, or the caret moved. */
  refresh(): void;
}

let host: Host;
let enabled = false;
/** word → spelled correctly, as answered by the extension */
const verdicts = new Map<string, boolean>();
const asked = new Set<string>();
const suggestions = new Map<string, string[]>();
let waiting: { word: string; done: (list: string[]) => void } | null = null;
/** The state right after the last keystroke: the word at that caret is still being typed. */
let typing: { field: Field; at: number; text: string } | null = null;
/** Text an input method is composing: pinyin letters are not English words. */
let composing: { field: Field; from: number; to: number } | null = null;
/** The marked word that is highlighted: the one whose popover is open. */
let hot: { field: Field; start: number } | null = null;

const isField = (t: EventTarget | null): t is Field => t instanceof HTMLTextAreaElement;

export function initSpell(root: HTMLElement, h: Host) {
  host = h;
  root.addEventListener(
    'input',
    e => {
      if (isField(e.target)) typing = { field: e.target, at: e.target.selectionEnd, text: e.target.value };
    },
    true,
  );
  root.addEventListener(
    'compositionstart',
    e => {
      if (isField(e.target)) composing = { field: e.target, from: e.target.selectionStart, to: e.target.selectionEnd };
    },
    true,
  );
  root.addEventListener(
    'compositionupdate',
    e => {
      if (composing) composing.to = composing.from + e.data.length;
    },
    true,
  );
  root.addEventListener('compositionend', () => {
    composing = null;
    host.refresh();
  });
  // once the caret leaves the word that was being typed, that word is checked too
  const caretMoved = () => {
    if (!typing || caretAt(typing.field) === typing.at) return;
    typing = null;
    host.refresh();
  };
  document.addEventListener('selectionchange', caretMoved);
  root.addEventListener('keyup', caretMoved, true);
  root.addEventListener('mouseup', caretMoved, true);
}

/** Caret offset, or -1 while a range is selected. */
const caretAt = (f: Field) => (f.selectionStart === f.selectionEnd ? f.selectionStart : -1);

/** Turn checking on or off. Also forgets every answer, since the user's dictionary may have changed. */
export function setSpellCheck(on: boolean) {
  enabled = on;
  verdicts.clear();
  asked.clear();
  suggestions.clear();
}

/** Answer from the extension: `bad` are the misspelled ones of `words`. */
export function spellResult(words: string[], bad: string[]) {
  const wrong = new Set(bad);
  for (const w of words) {
    verdicts.set(w, !wrong.has(w));
    asked.delete(w);
  }
  if (bad.length) host.refresh();
}

/**
 * The misspelled words of the text in `field`, as far as known: words not seen before are sent to
 * the extension, and `refresh` is called when its answer changes the result.
 */
function misspelled(text: string, field: Field): SpellWord[] {
  if (!enabled) return [];
  const caret = typing && typing.field === field && typing.text === text && caretAt(field) === typing.at ? typing.at : -1;
  const ime = composing?.field === field ? composing : null;
  const bad: SpellWord[] = [];
  const ask: string[] = [];
  for (const w of spellWords(text)) {
    if (caret >= w.start && caret <= w.end) continue;
    if (ime && w.start <= ime.to && w.end >= ime.from) continue;
    const ok = verdicts.get(w.word);
    if (ok === false) bad.push(w);
    else if (ok === undefined && !asked.has(w.word)) {
      asked.add(w.word);
      ask.push(w.word);
    }
  }
  if (ask.length) host.post({ type: 'spellCheck', words: ask });
  return bad;
}

/** The text of `field` as HTML, with the misspelled words wrapped in `<span class="sp">`. */
export function spellMarkup(text: string, field: Field): string {
  let html = '';
  let at = 0;
  for (const w of misspelled(text, field)) {
    const cls = hot && hot.field === field && hot.start === w.start ? 'sp hot' : 'sp';
    html += `${escapeHtml(text.slice(at, w.start))}<span class="${cls}" data-a="${w.start}" data-b="${w.end}">${escapeHtml(text.slice(w.start, w.end))}</span>`;
    at = w.end;
  }
  // the zero-width space gives a trailing line break its line
  return html + escapeHtml(text.slice(at)) + '&#8203;';
}

/** A marked word and where its box is on the screen. */
export type MarkedWord = SpellWord & { left: number; top: number; bottom: number };

/** Highlight a marked word of `field`, or none: the markup then gives it the class `hot`. */
export function highlightWord(field: Field | null, word?: SpellWord) {
  const next = field && word ? { field, start: word.start } : null;
  if (next?.field === hot?.field && next?.start === hot?.start) return;
  hot = next;
  host.refresh();
}

/** The marked word at a point of the screen; `layer` is the element that holds the markup. */
export function markedWordAt(layer: Element | null | undefined, x: number, y: number): MarkedWord | null {
  for (const el of layer?.querySelectorAll<HTMLElement>('.sp') ?? [])
    for (const r of el.getClientRects())
      if (x >= r.left - 1 && x <= r.right + 1 && y >= r.top - 1 && y <= r.bottom + 3)
        return { start: Number(el.dataset.a), end: Number(el.dataset.b), word: (el.textContent ?? '').replace(/’/g, "'"), left: r.left, top: r.top, bottom: r.bottom };
  return null;
}

/** Replacements for a misspelled word; `done` runs right away if they are known, else when the extension answers. */
export function suggestSpelling(word: string, done: (list: string[]) => void) {
  const known = suggestions.get(word);
  if (known) return done(known);
  waiting = { word, done };
  host.post({ type: 'spellSuggest', word });
}

export function spellSuggestions(word: string, list: string[]) {
  suggestions.set(word, list);
  if (waiting?.word !== word) return;
  const { done } = waiting;
  waiting = null;
  done(list);
}

/** "Add to Dictionary": the extension saves the word in the settings, which come back as a new config. */
export function addSpellWord(word: string) {
  verdicts.set(word, true);
  host.post({ type: 'spellAdd', word });
  host.refresh();
}
