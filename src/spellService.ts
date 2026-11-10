import * as vscode from 'vscode';
import { SpellChecker } from './spell/checker';

const SETTING = 'spellCheck.userWords';
/** What the webview may send: plain words, like the ones it takes out of a topic's text. */
const WORD = /^[A-Za-z]+(?:'[A-Za-z]+)*$/;
const isWord = (w: unknown): w is string => typeof w === 'string' && w.length <= 60 && WORD.test(w);

function userWords(): string[] {
  const v = vscode.workspace.getConfiguration('thinkmark').get<unknown>(SETTING);
  return Array.isArray(v) ? v.filter((w): w is string => typeof w === 'string') : [];
}

/**
 * Spell checking for the mind maps. VS Code turns off Chromium's own spell checker in webviews, so the
 * words are checked here: one dictionary, read on first use, for all open maps.
 */
export class SpellService {
  private checker: Promise<SpellChecker | undefined> | undefined;

  /** `dictDir`: folder with the Hunspell files en.aff and en.dic. */
  constructor(private readonly dictDir: vscode.Uri) {}

  private load(): Promise<SpellChecker | undefined> {
    return (this.checker ??= (async () => {
      try {
        const read = async (name: string) => Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(this.dictDir, name))).toString('utf8');
        const [aff, dic] = await Promise.all([read('en.aff'), read('en.dic')]);
        return new SpellChecker(aff, dic);
      } catch (err) {
        console.error('Thinkmark: could not load the spelling dictionary', err);
        return undefined;
      }
    })());
  }

  /** The misspelled ones of `words`. */
  async check(words: unknown): Promise<string[]> {
    const checker = await this.load();
    if (!checker || !Array.isArray(words)) return [];
    checker.setUserWords(userWords());
    return checker.check(words.filter(isWord));
  }

  async suggest(word: unknown): Promise<string[]> {
    const checker = await this.load();
    return checker && isWord(word) ? checker.suggest(word) : [];
  }

  /** "Add to Dictionary": the word goes into the user settings, which every open map then picks up. */
  async addWord(word: unknown): Promise<void> {
    if (!isWord(word)) return;
    const config = vscode.workspace.getConfiguration('thinkmark');
    const saved = config.inspect<unknown>(SETTING)?.globalValue;
    const words = Array.isArray(saved) ? saved.filter((w): w is string => typeof w === 'string') : [];
    if (words.includes(word)) return;
    await config.update(SETTING, [...words, word].sort((a, b) => a.localeCompare(b)), vscode.ConfigurationTarget.Global);
  }
}
