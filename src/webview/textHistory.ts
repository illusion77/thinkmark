/**
 * Undo / redo and select-all for the webview's own text fields (topic text, note, link).
 *
 * Inside VS Code these keys never reach a field's built-in behaviour: the webview host forwards
 * Cmd/Ctrl+Z and Y to VS Code, which undoes the Markdown document instead (custom editors take
 * priority over webviews), and select-all only works through VS Code's command. So each field keeps
 * its own history and the keys are handled here.
 */

export type TextField = HTMLTextAreaElement | HTMLInputElement;

interface Snap {
  value: string;
  start: number;
  end: number;
}

interface History {
  undo: Snap[];
  redo: Snap[];
  /** Time and kind of the last recorded change: a quick burst of the same kind is one undo step. */
  at: number;
  kind: string;
}

const MERGE_MS = 800;
const LIMIT = 200;
const histories = new WeakMap<TextField, History>();

const isField = (t: EventTarget | null): t is TextField => t instanceof HTMLTextAreaElement || t instanceof HTMLInputElement;

function historyOf(el: TextField): History {
  let h = histories.get(el);
  if (!h) histories.set(el, (h = { undo: [], redo: [], at: 0, kind: '' }));
  return h;
}

const snap = (el: TextField): Snap => ({
  value: el.value,
  start: el.selectionStart ?? el.value.length,
  end: el.selectionEnd ?? el.value.length,
});

/** Forget a field's history, e.g. after code replaced its value. `base`: a state to go back to, which typing right after continues. */
export function resetHistory(el: TextField, base?: string) {
  const h = historyOf(el);
  h.undo = base === undefined ? [] : [{ value: base, start: 0, end: base.length }];
  h.redo = [];
  h.at = base === undefined ? 0 : performance.now();
  h.kind = base === undefined ? '' : 'insert';
}

/** Record the state before a change. */
export function recordChange(el: TextField, kind: 'insert' | 'delete' | 'other') {
  const h = historyOf(el);
  const now = performance.now();
  if (kind === 'other' || kind !== h.kind || now - h.at > MERGE_MS || !h.undo.length) {
    h.undo.push(snap(el));
    if (h.undo.length > LIMIT) h.undo.shift();
  }
  h.redo = [];
  h.at = now;
  h.kind = kind;
}

function step(el: TextField, redo: boolean) {
  const h = historyOf(el);
  const s = (redo ? h.redo : h.undo).pop();
  if (!s) return;
  (redo ? h.undo : h.redo).push(snap(el));
  el.value = s.value;
  el.setSelectionRange(s.start, s.end);
  h.kind = '';
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Record history for every text field inside `root` from the browser's input events. */
export function trackHistory(root: HTMLElement) {
  root.addEventListener(
    'beforeinput',
    e => {
      if (!isField(e.target) || e.isComposing) return;
      if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') {
        e.preventDefault();
        return step(e.target, e.inputType === 'historyRedo');
      }
      const kind = e.inputType === 'insertText' ? 'insert' : e.inputType.startsWith('delete') && e.inputType !== 'deleteByCut' ? 'delete' : 'other';
      recordChange(e.target, kind);
    },
    true,
  );
  // IME input: one step per composition
  root.addEventListener('compositionstart', e => isField(e.target) && recordChange(e.target, 'other'), true);
}

/** Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z, Ctrl+Y and Cmd/Ctrl+A in a text field. Returns true if the key was handled. */
export function handleEditKey(e: KeyboardEvent, el: TextField, mod: boolean): boolean {
  if (!mod || e.altKey || e.isComposing) return false;
  const k = e.key.toLowerCase();
  if (k === 'z') step(el, e.shiftKey);
  else if (k === 'y' && !e.shiftKey) step(el, true);
  else if (k === 'a' && !e.shiftKey) el.select();
  else return false;
  e.preventDefault();
  e.stopPropagation();
  return true;
}
