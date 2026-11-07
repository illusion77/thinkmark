export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Small inline-Markdown renderer for topic text: code, links, bold, italic, strike, highlight. */
export function renderInline(text: string): string {
  const slots: string[] = [];
  const keep = (html: string) => `\u0000${slots.push(html) - 1}\u0000`;
  let s = escapeHtml(text);
  s = s.replace(/\\([\\`*_{}[\]()#+\-.!|~])/g, (_, c) => keep(c));
  s = s.replace(/`([^`]+)`/g, (_, c) => keep(`<code>${c}</code>`));
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (_, label, href) => keep(`<a data-href="${href}" title="${href}">${label}</a>`));
  s = s.replace(/&lt;((?:https?|mailto):[^\s&]+)&gt;/g, (_, u) => keep(`<a data-href="${u}" title="${u}">${u}</a>`));
  s = s.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '<b>$2</b>');
  s = s.replace(/(^|[^\w*])\*(?=[^\s*])([^*]*?[^\s*])\*(?!\w)/g, '$1<i>$2</i>');
  s = s.replace(/(^|[^\w_])_(?=[^\s_])([^_]*?[^\s_])_(?!\w)/g, '$1<i>$2</i>');
  s = s.replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<s>$1</s>');
  s = s.replace(/==(?=\S)([\s\S]*?\S)==/g, '<mark>$1</mark>');
  // Slots can contain other slots (a link label with code), so restore until stable.
  for (let i = 0; i < 3 && s.includes('\u0000'); i++) s = s.replace(/\u0000(\d+)\u0000/g, (_, n) => slots[+n]);
  return s;
}
