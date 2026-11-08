import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasStyle, setStyle, toggleInline, type InlineStyle } from '../src/webview/format';

/** `|` marks the selection: "a |b| c". Returns the result in the same notation. */
function toggle(marked: string, style: InlineStyle): string {
  const start = marked.indexOf('|');
  const end = marked.indexOf('|', start + 1) - 1;
  const text = marked.replace(/\|/g, '');
  const r = toggleInline(text, start, end < start ? start : end, style);
  return r.start === r.end ? r.text.slice(0, r.start) + '|' + r.text.slice(r.start) : r.text.slice(0, r.start) + '|' + r.text.slice(r.start, r.end) + '|' + r.text.slice(r.end);
}

test('wraps and unwraps a selection', () => {
  assert.equal(toggle('make |this| bold', 'bold'), 'make **|this|** bold');
  assert.equal(toggle('make **|this|** bold', 'bold'), 'make |this| bold');
  assert.equal(toggle('make |**this**| bold', 'bold'), 'make |this| bold');
  assert.equal(toggle('an |idea|', 'italic'), 'an *|idea|*');
  assert.equal(toggle('an *|idea|*', 'italic'), 'an |idea|');
  assert.equal(toggle('|key| point', 'underline'), '<u>|key|</u> point');
  assert.equal(toggle('<u>|key|</u> point', 'underline'), '|key| point');
  assert.equal(toggle('|<u>key</u>| point', 'underline'), '|key| point');
});

test('bold and italic stars do not get mixed up', () => {
  // italic on bold text adds a third star instead of removing one
  assert.equal(toggle('**|word|**', 'italic'), '***|word|***');
  assert.equal(toggle('***|word|***', 'italic'), '**|word|**');
  assert.equal(toggle('***|word|***', 'bold'), '*|word|*');
  // bold on italic text
  assert.equal(toggle('*|word|*', 'bold'), '***|word|***');
});

test('spaces at the edges of the selection stay outside the markers', () => {
  assert.equal(toggle('a| big |deal', 'bold'), 'a **|big|** deal');
});

test('an empty selection inserts a pair, and toggling again removes it', () => {
  assert.equal(toggle('say ||', 'bold'), 'say **|**');
  assert.equal(toggle('say **||**', 'bold'), 'say |');
  assert.equal(toggle('||', 'underline'), '<u>|</u>');
});

test('whole-topic styles', () => {
  assert.equal(hasStyle('**Topic**', 'bold'), true);
  assert.equal(hasStyle('**Topic** and more', 'bold'), false);
  assert.equal(hasStyle('*Topic*', 'bold'), false);
  assert.equal(hasStyle('***Topic***', 'italic'), true);
  assert.equal(setStyle('Topic', 'bold', true), '**Topic**');
  assert.equal(setStyle('**Topic**', 'bold', true), '**Topic**');
  assert.equal(setStyle('**Topic**', 'bold', false), 'Topic');
  assert.equal(setStyle('Topic', 'underline', true), '<u>Topic</u>');
  assert.equal(setStyle('', 'bold', true), '');
});

test('two styled parts are not taken for one styled whole', () => {
  assert.equal(hasStyle('**a** and **b**', 'bold'), false);
  assert.equal(setStyle('**a** and **b**', 'bold', true), '**a and b**');
  assert.equal(setStyle('*a* and *b*', 'italic', true), '*a and b*');
  assert.equal(setStyle('<u>a</u> and b', 'underline', true), '<u>a and b</u>');
  assert.equal(hasStyle('*a* and *b*', 'italic'), false);
  assert.equal(hasStyle('*a **b** c*', 'italic'), true);
  assert.equal(hasStyle('<u>a</u> and <u>b</u>', 'underline'), false);
  assert.equal(toggle('|**a** and **b**|', 'bold'), '**|a and b|**');
  // other styles inside are kept
  assert.equal(toggle('|*a* and **b**|', 'underline'), '<u>|*a* and **b**|</u>');
});

test('italic inside a word renders, like CommonMark', async () => {
  const { renderInline } = await import('../src/webview/inline');
  assert.equal(renderInline('*Require*ments'), '<i>Require</i>ments');
  assert.equal(renderInline('re*quire*ments'), 're<i>quire</i>ments');
  assert.equal(renderInline('**bold** and *it*'), '<b>bold</b> and <i>it</i>');
  assert.equal(renderInline('a * b * c'), 'a * b * c');
  assert.equal(renderInline('snake_case_name'), 'snake_case_name');
  assert.equal(renderInline('<u>under</u>line'), '<u>under</u>line');
});
