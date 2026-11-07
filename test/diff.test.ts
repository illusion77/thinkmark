import { test } from 'node:test';
import assert from 'node:assert/strict';
import { minimalSplice } from '../src/shared/diff';

const apply = (a: string, b: string) => {
  const s = minimalSplice(a, b);
  return s ? a.slice(0, s.start) + s.text + a.slice(s.end) : a;
};

test('minimal splice touches only the changed span', () => {
  const a = '# Root\n\n- one\n- two\n- three\n';
  const b = '# Root\n\n- one\n- 2\n- three\n';
  const s = minimalSplice(a, b)!;
  assert.equal(a.slice(s.start, s.end), 'two');
  assert.equal(s.text, '2');
  assert.equal(minimalSplice(a, a), null);
});

test('splice always reproduces the new text', () => {
  const cases: [string, string][] = [
    ['', '# a\n'],
    ['# a\n', ''],
    ['aaa', 'aaaa'],
    ['abc\r\ndef', 'abc\r\nxdef'],
    ['x\r\ny', 'x\ny'],
    ['😀😀', '😀😁'],
    ['a😀b', 'ab'],
    ['- 中文\n', '- 中文主题\n'],
  ];
  for (const [a, b] of cases) assert.equal(apply(a, b), b, JSON.stringify([a, b]));
});

test('does not split CRLF or surrogate pairs', () => {
  const s = minimalSplice('a\r\nb', 'a\r\nc')!;
  assert.ok(s.start >= 3);
  const e = minimalSplice('😀😀', '😀😁')!;
  assert.equal(e.start % 2, 0);
});

import { fileNameSpellings, localLinkTargets } from '../src/shared/links';

test('local link targets found in Markdown', () => {
  const md = [
    '## A ![x|200](assets/a.png)',
    '- [doc](notes/b.md#part) and ![](<assets/my img.png> "t")',
    '![](assets/c%20d.png) ![](https://x.com/e.png) ![](data:image/png;base64,AAA) [top](#anchor)',
    '<img src="assets/f.svg" width="100">',
  ].join('\n');
  assert.deepEqual(localLinkTargets(md), ['assets/a.png', 'notes/b.md', 'assets/my img.png', 'assets/c d.png', 'assets/f.svg']);
  assert.ok(fileNameSpellings('diagram (v2).png').includes('diagram%20%28v2%29.png'));
  // Windows absolute paths are local files, not URL schemes
  assert.deepEqual(localLinkTargets('![](C:\\pics\\a.png) ![](<D:/My Pics/b.png>) [x](mailto:a@b.c)'), ['C:\\pics\\a.png', 'D:/My Pics/b.png']);
});
