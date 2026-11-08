import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeNote, markdownToNodes, nodesToMarkdown, parseMarkdown, reconcile, serializeDoc } from '../src/shared/markdown';
import type { MindNode } from '../src/shared/model';

const opts = { headingLevels: 2 };
let seq = 0;
const genId = () => 't' + ++seq;
const parse = (s: string) => parseMarkdown(s, { rootText: 'file', genId });
const ser = (d: ReturnType<typeof parse>) => serializeDoc(d, opts).text;
const roundTrip = (s: string) => assert.equal(ser(parse(s)), s);
const texts = (n: MindNode): unknown => (n.children.length ? { [n.text]: n.children.map(texts) } : n.text);

test('canonical document round-trips unchanged', () => {
  roundTrip(`# Root

Root note.

## A

- a1
  - a11
- a2

## B ![pic|120](assets/b.png)

### B1

text under B1
spanning two lines

\`\`\`js
# not a heading
- not a list
\`\`\`
`);
});

test('tree structure', () => {
  const d = parse(`# Root\n\n## A\n\n- a1\n  - a11\n- a2\n\n## B\n\n### B1\n`);
  assert.equal(d.virtualRoot, false);
  assert.deepEqual(texts(d.root), { Root: [{ A: [{ a1: ['a11'] }, 'a2'] }, { B: ['B1'] }] });
});

test('multiple top-level headings use a virtual root', () => {
  const s = `# A\n\n- a1\n\n# B\n`;
  const d = parse(s);
  assert.equal(d.virtualRoot, true);
  assert.equal(d.root.text, 'file');
  assert.deepEqual(texts(d.root), { file: [{ A: ['a1'] }, 'B'] });
  roundTrip(s);
});

test('list-only document', () => {
  const s = `- a\n  - b\n- c\n`;
  const d = parse(s);
  assert.equal(d.virtualRoot, true);
  assert.deepEqual(texts(d.root), { file: [{ a: ['b'] }, 'c'] });
  roundTrip(s);
});

test('keeps 4-space indentation, bullets, numbering, skipped heading levels', () => {
  roundTrip(`# R\n\n- a\n    - b\n        - c\n* d\n`);
  roundTrip(`# R\n\n1. one\n2. two\n   - nested\n`);
  roundTrip(`# R\n\n### Skipped level\n\n#### Deeper\n`);
  roundTrip(`## Starts at h2\n\n### Child\n`);
});

test('front matter is preserved and map settings are read and written', () => {
  const s = `---\ntitle: Notes\nmindmap:\n  layout: right\n  theme: fresh\ntags: [a]\n---\n\n# R\n`;
  const d = parse(s);
  assert.equal(d.settings.layout, 'right');
  assert.equal(d.settings.theme, 'fresh');
  roundTrip(s);
  d.settings.layout = 'down';
  assert.equal(ser(d), s.replace('layout: right', 'layout: down'));
  const plain = parse(`# R\n`);
  plain.settings.lineStyle = 'elbow';
  assert.equal(ser(plain), `---\nmindmap:\n  lineStyle: elbow\n---\n\n# R\n`);
});

test('topic text: image, task, line breaks', () => {
  const d = parse(`# R\n\n- [x] done ![shot|200](<my img.png> "t")\n- [ ] todo\n- two<br>lines\n`);
  const [a, b, c] = d.root.children;
  assert.equal(a.task, 'done');
  assert.equal(a.text, 'done');
  assert.deepEqual(a.image, { src: '<my img.png>', alt: 'shot', width: 200, title: '"t"', atStart: false });
  assert.equal(b.task, 'todo');
  assert.equal(c.text, 'two\nlines');
  roundTrip(`# R\n\n- [x] done ![shot|200](<my img.png> "t")\n- [ ] todo\n- two<br>lines\n`);
  roundTrip(`# R\n\n- ![](a.png) caption first\n`);
});

test('editing one topic changes only its line', () => {
  const s = `# Root\n\nintro\n\n## A\n\n- a1\n- a2\n\n## B\n`;
  const d = parse(s);
  d.root.children[0].children[1].text = 'renamed';
  const out = ser(d).split('\n');
  const orig = s.split('\n');
  assert.equal(out.length, orig.length);
  assert.deepEqual(out.map((l, i) => (l === orig[i] ? null : l)).filter(Boolean), ['- renamed']);
});

test('new topics follow siblings, then headingLevels', () => {
  const d = parse(`# Root\n\n## A\n`);
  d.root.children.push({ id: genId(), text: 'B', children: [{ id: genId(), text: 'b1', children: [] }] });
  d.root.children[0].children.push({ id: genId(), text: 'a1', children: [] });
  assert.equal(ser(d), `# Root\n\n## A\n\n- a1\n\n## B\n\n- b1\n`);
});

test('empty file: root is the file name and is written on first edit', () => {
  const d = parse('');
  assert.equal(d.virtualRoot, false);
  assert.equal(d.root.text, 'file');
  d.root.children.push({ id: genId(), text: 'Main', children: [] });
  assert.equal(ser(d), `# file\n\n## Main\n`);
});

test('list item moved after a heading sibling becomes a heading; deep headings become lists', () => {
  const d = parse(`# R\n\n- x\n\n## H\n`);
  const [x, h] = d.root.children;
  d.root.children = [h, x];
  assert.equal(ser(d), `# R\n\n## H\n\n## x\n`);
  const deep = parse(`###### six\n`);
  deep.root.children.push({ id: genId(), text: 'seven', kind: 'heading', children: [] });
  assert.equal(ser(deep), `###### six\n\n- seven\n`);
});

test('headings moved under list items become list items with indented notes', () => {
  const d = parse(`# R\n\n- item\n\n## H\n\nnote line\n`);
  const [item, h] = d.root.children;
  d.root.children = [item];
  item.children.push(h);
  const out = ser(d);
  assert.equal(out, `# R\n\n- item\n  - H\n    note line\n`);
  assert.deepEqual(texts(parse(out).root), { R: [{ item: ['H'] }] });
});

test('CRLF line endings are kept', () => {
  roundTrip(`# R\r\n\r\n## A\r\n`);
});

test('paragraph continuation and nested code inside list items', () => {
  const s = `# R\n\n- item\n  more about item\n  \`\`\`\n  - code\n  \`\`\`\n- next\n`;
  const d = parse(s);
  assert.equal(d.root.children.length, 2);
  assert.equal(d.root.children[0].note, 'more about item\n```\n- code\n```');
  roundTrip(s);
});

test('note escaping keeps structure-like lines as text', () => {
  assert.equal(escapeNote('# a\n- b\n1. c\n```\n# code\n```\nplain'), '\\# a\n\\- b\n1\\. c\n```\n# code\n```\nplain');
  const d = parse(`# R\n`);
  d.root.note = escapeNote('- not a child');
  const again = parse(ser(d));
  assert.equal(again.root.children.length, 0);
});

test('copy / paste helpers', () => {
  const d = parse(`# R\n\n## A\n\n- a1\n  - a11\n`);
  assert.equal(nodesToMarkdown([d.root.children[0]]), `- A\n  - a1\n    - a11\n`);
  const pasted = markdownToNodes(`- x\n  - y\n- z`, genId);
  assert.deepEqual(pasted.map(texts), [{ x: ['y'] }, 'z']);
  assert.deepEqual(markdownToNodes(`line one\nline two\n`, genId).map(n => n.text), ['line one', 'line two']);
  assert.deepEqual(markdownToNodes(`# Title\n- a`, genId).map(texts), [{ Title: ['a'] }]);
});

test('reconcile keeps ids across external edits', () => {
  const a = parse(`# R\n\n## A\n\n## B\n\n- b1\n`);
  const idB = a.root.children[1].id;
  const idB1 = a.root.children[1].children[0].id;
  const b = parse(`# R\n\n## New\n\n## A\n\n## B\n\n- b1 renamed\n`);
  reconcile(a.root, b.root);
  assert.equal(b.root.children[2].id, idB);
  assert.equal(b.root.children[2].children[0].id, idB1);
  assert.notEqual(b.root.children[0].id, a.root.children[0].id);
});

test('left-side marker on main topics', () => {
  const s = `# R\n\n## A\n\n## B <!-- mindmap: left -->\n\n- b1\n`;
  const d = parse(s);
  assert.equal(d.root.children[0].side, undefined);
  assert.equal(d.root.children[1].side, 'left');
  assert.equal(d.root.children[1].text, 'B');
  roundTrip(s);
  // list-item main topics, tasks and images keep the marker at the end of the line
  roundTrip(`# R\n\n- [ ] a ![](a.png) <!-- mindmap: left -->\n  - a1\n- b\n`);
  // several top-level headings (central topic = file name)
  roundTrip(`# A <!-- mindmap: left -->\n\n# B\n`);
  // short form is accepted and written in the canonical form
  assert.equal(ser(parse(`# R\n\n## A <!--left-->\n`)), `# R\n\n## A <!-- mindmap: left -->\n`);
  // only main topics carry it
  assert.equal(ser(parse(`# R\n\n## A\n\n- x <!-- mindmap: left -->\n`)), `# R\n\n## A\n\n- x\n`);
  // toggling it changes only that line
  const t = parse(`# R\n\n## A\n\n## B\n`);
  t.root.children[1].side = 'left';
  assert.equal(ser(t), `# R\n\n## A\n\n## B <!-- mindmap: left -->\n`);
});

test('topic links (Cmd+K) are written as [text](url)', () => {
  const s = `# R\n\n## [Docs](https://example.com/docs) ![](a.png) <!-- mindmap: left -->\n\n- [x] [Spec](<./my spec.md> "Spec")\n- see [inline](https://x.y) link\n- [![badge](b.svg)](https://ci)\n`;
  const d = parse(s);
  const [docs, spec, inline, badge] = [d.root.children[0], d.root.children[0].children[0], d.root.children[0].children[1], d.root.children[0].children[2]];
  assert.equal(docs.text, 'Docs');
  assert.equal(docs.link, 'https://example.com/docs');
  assert.equal(docs.image?.src, 'a.png');
  assert.equal(docs.side, 'left');
  assert.equal(spec.text, 'Spec');
  assert.equal(spec.link, '<./my spec.md>');
  assert.equal(spec.task, 'done');
  assert.equal(inline.link, undefined);
  assert.equal(inline.text, 'see [inline](https://x.y) link');
  assert.equal(badge.link, undefined);
  assert.equal(badge.image, undefined);
  roundTrip(s);
  const t = parse(`# R\n\n## A\n`);
  t.root.children[0].link = 'https://a.b';
  assert.equal(ser(t), `# R\n\n## [A](https://a.b)\n`);
  delete t.root.children[0].link;
  assert.equal(ser(t), `# R\n\n## A\n`);
});

test('empty topics survive a round trip', () => {
  const d = parse(`# Root\n\n## A\n\n- a1\n- b1\n  - b11\n`);
  const a = d.root.children[0];
  a.text = '';
  a.children[1].text = '';
  const out = ser(d);
  assert.equal(out, `# Root\n\n##\n\n- a1\n-\n  - b11\n`);
  assert.deepEqual(texts(parse(out).root), { Root: [{ '': ['a1', { '': ['b11'] }] }] });
});

test('an empty central topic survives a round trip', () => {
  const d = parse(`# Root\n\n## A\n`);
  d.root.text = '';
  const out = ser(d);
  assert.deepEqual(texts(parse(out).root), { '': ['A'] });
  assert.equal(ser(parse(out)), out);
});
