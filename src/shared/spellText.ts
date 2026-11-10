/** A word of a text that the spell checker looks at. */
export interface SpellWord {
  /** Offsets in the text; a possessive 's is left out. */
  start: number;
  end: number;
  /** The word as it is looked up: with straight apostrophes. */
  word: string;
}

const blank = (s: string) => s.replace(/[^\n]/g, ' ');

/** Blank out what is not prose in Markdown (code, link targets, HTML, entities), keeping every offset. */
function maskNonProse(text: string): string {
  return text
    .replace(/(^|\n)[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n[ \t]*\2[^\n]*|$)/g, m => blank(m))
    .replace(/`[^`\n]+`/g, m => blank(m))
    .replace(/\]\([^)\n]*\)/g, m => blank(m))
    .replace(/<!--[\s\S]*?-->/g, m => blank(m))
    .replace(/<(?:\/?[a-z][^<>\n]*|[a-z][\w+.-]*:[^<>\s]*)>/gi, m => blank(m))
    .replace(/&#?\w+;/g, m => blank(m));
}

const LETTER = String.raw`\p{Script=Latin}\p{N}\p{M}_`;
/** A run of text without spaces, CJK or ordinary punctuation: a word, or a URL, path, e-mail address… */
const CHUNK = new RegExp(String.raw`[${LETTER}'’\-./\\:@~%#?=&+]+`, 'gu');
const WORD = new RegExp(String.raw`[${LETTER}]+(?:['’][${LETTER}]+)*`, 'gu');
/** URL, e-mail or @mention, file or domain name (a dot or backslash inside a word), path. */
const NOT_PROSE = /:\/\/|^www\.|@|[\p{L}\p{N}_][.\\][\p{L}\p{N}_]|^(?:~|\.{1,2})?\//u;
const PLAIN_WORD = /^[A-Za-z]+(?:'[A-Za-z]+)*$/;

/**
 * The words of a topic text or note worth checking against an English dictionary.
 *
 * Left out: code, link targets, HTML tags, URLs, paths and file names; anything with digits, underscores
 * or non-ASCII letters (other languages); single letters; ACRONYMS and camelCase / ProductNames.
 */
export function spellWords(text: string): SpellWord[] {
  const out: SpellWord[] = [];
  const masked = maskNonProse(text);
  for (const chunk of masked.matchAll(CHUNK)) {
    if (NOT_PROSE.test(chunk[0])) continue;
    for (const m of chunk[0].matchAll(WORD)) {
      // _emphasis_ markers are not part of the word
      const lead = /^_*/.exec(m[0])![0].length;
      const raw = m[0].slice(lead).replace(/_+$/, '').replace(/['’]s$/i, '');
      const word = raw.replace(/’/g, "'");
      if (word.length < 2 || !PLAIN_WORD.test(word)) continue;
      if (word === word.toUpperCase() || /[A-Z]/.test(word.slice(1))) continue;
      const start = chunk.index + m.index + lead;
      out.push({ start, end: start + raw.length, word });
    }
  }
  return out;
}
