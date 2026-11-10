declare module 'nspell' {
  interface NSpell {
    correct(word: string): boolean;
    suggest(word: string): string[];
    /** Add a word; with `model`, it also gets the inflections of that dictionary word. */
    add(word: string, model?: string): NSpell;
    remove(word: string): NSpell;
  }
  /** Hunspell-compatible spell checker; `aff` and `dic` are the contents of the dictionary files. */
  export default function nspell(aff: string, dic: string): NSpell;
}
