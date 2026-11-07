export interface TextSplice {
  /** Offsets into the old text. */
  start: number;
  end: number;
  /** Replacement for old[start, end). */
  text: string;
}

const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;

/** Smallest single replacement that turns `oldText` into `newText` (null when equal). */
export function minimalSplice(oldText: string, newText: string): TextSplice | null {
  if (oldText === newText) return null;
  let start = 0;
  const min = Math.min(oldText.length, newText.length);
  while (start < min && oldText.charCodeAt(start) === newText.charCodeAt(start)) start++;
  let endOld = oldText.length;
  let endNew = newText.length;
  while (endOld > start && endNew > start && oldText.charCodeAt(endOld - 1) === newText.charCodeAt(endNew - 1)) {
    endOld--;
    endNew--;
  }
  // never split a surrogate pair or a CRLF
  while (start > 0 && (isLow(oldText.charCodeAt(start)) || isLow(newText.charCodeAt(start)) || (oldText[start] === '\n' && oldText[start - 1] === '\r'))) start--;
  while (
    endOld < oldText.length &&
    (isLow(oldText.charCodeAt(endOld)) || (oldText[endOld] === '\n' && oldText[endOld - 1] === '\r'))
  ) {
    endOld++;
    endNew++;
  }
  return { start, end: endOld, text: newText.slice(start, endNew) };
}
