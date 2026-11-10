import nspell from 'nspell';
import { EXTRA_WORDS } from './words';

/** A dictionary noun with a regular plural: the model for `word+` entries. */
const NOUN = 'gadget';
/** Longer "words" are not prose, and looking for suggestions gets slow. */
const MAX_LENGTH = 40;

/** English spell checker: a Hunspell dictionary, the built-in software terms and the user's own words. */
export class SpellChecker {
  private readonly spell: ReturnType<typeof nspell>;
  private user = new Set<string>();

  /** `aff`, `dic`: contents of the Hunspell dictionary files. */
  constructor(aff: string, dic: string) {
    this.spell = nspell(aff, dic);
    for (const entry of EXTRA_WORDS.split(/\s+/).filter(Boolean)) {
      const [word, model] = entry.endsWith('+') ? [entry.slice(0, -1), NOUN] : entry.split('/');
      this.spell.add(word, model);
    }
  }

  /** Words the user added. A lower-case word also covers its capitalized form. */
  setUserWords(words: readonly string[]) {
    this.user = new Set(words.map(w => w.trim()).filter(Boolean));
  }

  correct(word: string): boolean {
    return word.length > MAX_LENGTH || this.user.has(word) || this.user.has(word.toLowerCase()) || this.spell.correct(word);
  }

  /** The misspelled ones of `words`. */
  check(words: readonly string[]): string[] {
    return words.filter(w => !this.correct(w));
  }

  /** Replacements for a misspelled word, the most likely first. */
  suggest(word: string, max = 5): string[] {
    if (word.length > MAX_LENGTH) return [];
    return rank(word, this.spell.suggest(word)).slice(0, max);
  }
}

/**
 * The dictionary returns every word within a couple of edits in no useful order ("teh": ten, eh, meh…
 * with "the" ninth). Put first what a typo most likely meant: swapped letters, then the fewest edits,
 * the same first letter, and ordinary words before names and acronyms.
 */
function rank(word: string, list: string[]): string[] {
  const w = word.toLowerCase();
  const letters = [...w].sort().join('');
  const score = (s: string) => {
    const l = s.toLowerCase();
    const swapped = l.length === w.length && [...l].sort().join('') === letters;
    return editDistance(w, l) * 4 - (swapped ? 3 : 0) + (l[0] === w[0] ? 0 : 2) + (word === w && s !== l ? 2 : 0);
  };
  return list
    .map((s, i) => ({ s, i, k: score(s) }))
    .sort((a, b) => a.k - b.k || a.i - b.i)
    .map(x => x.s);
}

/** Edit distance where swapping two neighbouring letters counts as one edit. */
function editDistance(a: string, b: string): number {
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const same = a[i - 1] === b[j - 1];
      let d = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (same ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, prev2[j - 2] + 1);
      row.push(d);
    }
    prev2 = prev;
    prev = row;
  }
  return prev[b.length];
}
