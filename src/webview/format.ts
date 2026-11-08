/**
 * Bold / italic / underline toggles on Markdown text (Cmd+B / I / U).
 * Bold is `**text**`, italic `*text*`, underline `<u>text</u>` (Markdown has no underline syntax).
 * Pure string functions, so they are shared by the topic text box, the note box and whole topics.
 */

export type InlineStyle = 'bold' | 'italic' | 'underline';

export interface TextEdit {
  text: string;
  start: number;
  end: number;
}

const STAR: Record<'bold' | 'italic', number> = { bold: 2, italic: 1 };

/** Number of `*` in a row ending at `i` (exclusive) going left, or starting at `i` going right. */
function starsBefore(s: string, i: number): number {
  let n = 0;
  while (i - n - 1 >= 0 && s[i - n - 1] === '*') n++;
  return n;
}

function starsAfter(s: string, i: number): number {
  let n = 0;
  while (i + n < s.length && s[i + n] === '*') n++;
  return n;
}

/** Whether a run of n stars on both sides carries the style: bold needs 2+, italic an odd count (1 or 3). */
const starsHave = (style: 'bold' | 'italic', n: number) => (style === 'bold' ? n >= 2 : n % 2 === 1);

/** Whether s is wrapped in the style's markers that pair with each other (not `**a** and **b**`). */
function wrapped(s: string, style: InlineStyle): boolean {
  if (style === 'underline') return s.length >= 7 && s.startsWith('<u>') && s.endsWith('</u>') && !s.slice(3, -4).includes('</u>');
  const k = STAR[style];
  const l = starsAfter(s, 0);
  if (s.length <= 2 * k || l >= s.length || !starsHave(style, Math.min(l, starsBefore(s, s.length)))) return false;
  const inner = s.slice(k, s.length - k);
  return style === 'bold' ? !inner.includes('**') : !inner.replace(/\*\*/g, '').includes('*');
}

/**
 * Add or remove a style on text[start, end). Removes it when the selection is wrapped in the style's
 * markers, either inside the selection or right around it; otherwise wraps the selection (without its
 * leading / trailing spaces, which Markdown does not allow inside the markers). An empty selection gets
 * an empty pair with the cursor in the middle.
 */
export function toggleInline(text: string, start: number, end: number, style: InlineStyle): TextEdit {
  if (start > end) [start, end] = [end, start];
  // keep spaces at the edges of the selection outside the markers
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;
  const sel = text.slice(start, end);

  if (style === 'underline') {
    const open = '<u>';
    const close = '</u>';
    if (wrapped(sel, style)) return edit(text, start, end, sel.slice(open.length, sel.length - close.length), 0);
    if (text.slice(start - open.length, start) === open && text.slice(end, end + close.length) === close)
      return { text: text.slice(0, start - open.length) + sel + text.slice(end + close.length), start: start - open.length, end: end - open.length };
    return edit(text, start, end, open + unstyle(sel, style) + close, open.length, close.length);
  }

  const k = STAR[style];
  // markers inside the selection: **text** selected
  if (wrapped(sel, style)) return edit(text, start, end, sel.slice(k, sel.length - k), 0);
  // markers around the selection: **[text]**, or an empty **|** pair
  const outL = starsBefore(text, start);
  const outR = starsAfter(text, end);
  if (starsHave(style, Math.min(outL, outR)))
    return { text: text.slice(0, start - k) + sel + text.slice(end + k), start: start - k, end: end - k };
  const mark = '*'.repeat(k);
  return edit(text, start, end, mark + unstyle(sel, style) + mark, k, k);
}

/** Drop the style from styled parts inside s, so wrapping it gives `**a and b**`, not `****a** and **b****`. */
function unstyle(s: string, style: InlineStyle): string {
  if (style === 'underline') return s.replace(/<u>([\s\S]*?)<\/u>/g, '$1');
  if (style === 'bold') return s.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '$1');
  return s.replace(/(^|[^*])\*(?=[^\s*])([^*]*?[^\s*])\*(?!\*)/g, '$1$2');
}

/** Replace text[start, end) with `inner`, selecting it minus `lead` / `trail` characters at its ends. */
function edit(text: string, start: number, end: number, inner: string, lead: number, trail = lead): TextEdit {
  return { text: text.slice(0, start) + inner + text.slice(end), start: start + lead, end: start + inner.length - trail };
}

/** Whether the whole text carries the style. */
export function hasStyle(text: string, style: InlineStyle): boolean {
  return wrapped(text.trim(), style);
}

/** Set the style on or off for a whole topic text. */
export function setStyle(text: string, style: InlineStyle, on: boolean): string {
  if (!text.trim() || hasStyle(text, style) === on) return text;
  return toggleInline(text, 0, text.length, style).text;
}
