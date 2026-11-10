import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spellWords } from '../src/shared/spellText';
import { SpellChecker } from '../src/spell/checker';

const words = (text: string) => spellWords(text).map(w => w.word);

test('takes the words out of plain text', () => {
  assert.deepEqual(words('Shorten a long URL'), ['Shorten', 'long']);
  assert.deepEqual(words('low-latency redirects (fast)'), ['low', 'latency', 'redirects', 'fast']);
  assert.deepEqual(words('client/server, read/write'), ['client', 'server', 'read', 'write']);
});

test('reports where each word is', () => {
  const text = 'a **wrod** here';
  assert.deepEqual(spellWords(text), [
    { start: 4, end: 8, word: 'wrod' },
    { start: 11, end: 15, word: 'here' },
  ]);
  for (const w of spellWords('the user’s wrod')) assert.equal('the user’s wrod'.slice(w.start, w.end), w.word);
});

test('keeps contractions, drops the possessive', () => {
  assert.deepEqual(words("don't, isn’t, the user's, Colin’s"), ["don't", "isn't", 'the', 'user', 'Colin']);
  assert.deepEqual(words("'quoted' words"), ['quoted', 'words']);
});

test('skips acronyms, product names, single letters and anything with digits', () => {
  assert.deepEqual(words('API over HTTP'), ['over']);
  assert.deepEqual(words('GitHub and JavaScript on iOS'), ['and', 'on']);
  assert.deepEqual(words('Base62 counter, 100M urls, p99, v2'), ['counter', 'urls']);
  assert.deepEqual(words('x and I'), ['and']);
});

test('skips code, link targets, HTML and entities', () => {
  assert.deepEqual(words('Cache (`Redsi`) layer'), ['Cache', 'layer']);
  assert.deepEqual(words('[the docz](https://exmaple.com/pagge) here'), ['the', 'docz', 'here']);
  assert.deepEqual(words('![diagrm|220](assets/architecure.svg)'), ['diagrm']);
  assert.deepEqual(words('<u>undrlined</u> text <!-- mindmap: left -->'), ['undrlined', 'text']);
  assert.deepEqual(words('a&nbsp;b &amp; more'), ['more']);
  assert.deepEqual(words('before\n```js\nconst fooo = 1;\n```\nafter'), ['before', 'after']);
  assert.deepEqual(words('open\n~~~\nnever closd'), ['open']);
});

test('skips URLs, e-mail addresses, paths and file names', () => {
  assert.deepEqual(words('see https://exmaple.com/a?b=c now'), ['see', 'now']);
  assert.deepEqual(words('mail colin@exmaple.com or www.exmaple.com'), ['mail', 'or']);
  assert.deepEqual(words('edit src/webview/main.ts and ./runn.sh'), ['edit', 'and']);
  assert.deepEqual(words('in ~/Dwnloads or C:\\Usrs\\colin'), ['in', 'or']);
  assert.deepEqual(words('Node.js, e.g. this'), ['this']);
  assert.deepEqual(words('The end. Next'), ['The', 'end', 'Next']);
});

test('checks English inside Chinese text and leaves other languages alone', () => {
  assert.deepEqual(words('使用Redsi做缓存，再desgin一下'), ['Redsi', 'desgin']);
  assert.deepEqual(words('café naïve Übersicht'), []);
});

test('takes emphasis markers off, skips identifiers', () => {
  assert.deepEqual(words('_emphasised_ and __strng__ but snake_case'), ['emphasised', 'and', 'strng', 'but']);
  assert.deepEqual(spellWords('_wrod_')[0], { start: 1, end: 5, word: 'wrod' });
});

const checker = new SpellChecker(readFileSync('node_modules/dictionary-en/index.aff', 'utf8'), readFileSync('node_modules/dictionary-en/index.dic', 'utf8'));

test('finds misspelled words', () => {
  assert.deepEqual(checker.check(['the', 'teh', 'Receive', 'Recieve', "don't", 'latency', 'latancy']), ['teh', 'Recieve', 'latancy']);
});

test('knows software terms, in either case and in the plural', () => {
  assert.deepEqual(checker.check(['api', 'apis', 'Config', 'configs', 'redis', 'Redis', 'async', 'frontend', 'minified', 'shortener', 'ok']), []);
  assert.deepEqual(checker.check(['kubernets', 'confg']), ['kubernets', 'confg']);
});

test('suggests the likely word first', () => {
  assert.equal(checker.suggest('teh')[0], 'the');
  assert.equal(checker.suggest('wrod')[0], 'word');
  assert.equal(checker.suggest('thier')[0], 'their');
  assert.equal(checker.suggest('Recieve')[0], 'Receive');
  assert.equal(checker.suggest('confg')[0], 'config');
  assert.ok(checker.suggest('adn').length <= 5);
  assert.deepEqual(checker.suggest('x'.repeat(50)), []);
});

test('accepts the words the user added', () => {
  assert.deepEqual(checker.check(['zettelkasten', 'Zettelkasten', 'Colinchen']), ['zettelkasten', 'Zettelkasten', 'Colinchen']);
  checker.setUserWords(['zettelkasten', 'Colinchen']);
  assert.deepEqual(checker.check(['zettelkasten', 'Zettelkasten', 'Colinchen', 'colinchen']), ['colinchen']);
  checker.setUserWords([]);
  assert.deepEqual(checker.check(['zettelkasten']), ['zettelkasten']);
});
