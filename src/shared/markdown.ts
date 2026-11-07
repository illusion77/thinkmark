/**
 * Markdown <-> mind map tree.
 *
 * Mapping rules
 *  - Headings nest by level. List items nest under the heading (or list item) above them.
 *  - If the document has exactly one top-level heading it becomes the central topic;
 *    otherwise the central topic is "virtual" (the file name) and is not written back.
 *  - Paragraphs, code blocks, tables, quotes... under a heading / list item become the topic's note.
 *  - The first image on a topic line becomes the topic image: ![alt|width](src).
 *  - GitHub task markers ([ ] / [x]) become topic checkboxes.
 *  - <br> inside a topic line is a line break inside the topic.
 *
 * The serializer keeps the source style where it can (heading levels, list markers,
 * indentation), so editing one topic changes only that topic's line.
 */
import type { LineStyle, Layout, MapSettings, MindDoc, MindImage, MindNode, NodeKind, SerializeOptions } from './model';

const HEADING_RE = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const LIST_RE = /^([ \t]*)([-*+]|\d{1,9}[.)])(?:[ \t]+(.*?))?[ \t]*$/;
const HR_RE = /^ {0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}$/;
const FENCE_RE = /^[ \t]*(`{3,}|~{3,})/;
const TASK_RE = /^\[([ xX])\](?:[ \t]+(.*))?$/;
/** A whole topic that is one link: [label](url "title"). */
const TOPIC_LINK_RE = /^\[((?:[^[\]\\]|\\.|\[[^[\]]*\])*)\]\(\s*(<[^>]*>|[^\s)]+)(?:\s+("[^"]*"|'[^']*'))?\s*\)$/;
const IMG_RE = /!\[([^\]]*)\]\(\s*(<[^>]*>|[^\s)]+)(?:\s+("[^"]*"|'[^']*'))?\s*\)/;
const BR_RE = /<br\s*\/?>/gi;
const BLANK_RE = /^[ \t]*$/;
/** Marks a main topic that sits on the left of the central topic: `## Topic <!-- mindmap: left -->`. */
const LEFT_RE = /[ \t]*<!--[ \t]*(?:mindmap[ \t]*:[ \t]*)?left[ \t]*-->[ \t]*/gi;
const LEFT_MARK = '<!-- mindmap: left -->';

const LAYOUTS: Layout[] = ['map', 'right', 'left', 'down'];
const LINE_STYLES: LineStyle[] = ['curve', 'elbow', 'straight'];

export interface ParseOptions {
  /** Text of the central topic when the document has no single top heading. */
  rootText: string;
  genId?: () => string;
}

/** Columns of leading whitespace (tabs = 4). */
function cols(ws: string): number {
  let c = 0;
  for (const ch of ws) c = ch === '\t' ? c + 4 - (c % 4) : c + 1;
  return c;
}

function leadingWs(line: string): string {
  return /^[ \t]*/.exec(line)![0];
}

/** Remove up to n columns of leading whitespace. */
function dedent(line: string, n: number): string {
  let col = 0;
  let i = 0;
  while (i < line.length && col < n) {
    const c = line[i];
    if (c === ' ') {
      col++;
      i++;
    } else if (c === '\t') {
      const next = col + 4 - (col % 4);
      if (next > n) return ' '.repeat(next - n) + line.slice(i + 1);
      col = next;
      i++;
    } else break;
  }
  return line.slice(i);
}

export function parseTopicText(raw: string): Pick<MindNode, 'text' | 'image' | 'task' | 'side' | 'link' | 'linkTitle'> {
  let s = raw;
  let side: MindNode['side'];
  if (LEFT_RE.test(s)) {
    side = 'left';
    s = s.replace(LEFT_RE, ' ').trim();
  }
  LEFT_RE.lastIndex = 0;
  let task: MindNode['task'];
  const tm = TASK_RE.exec(s);
  if (tm) {
    task = tm[1] === ' ' ? 'todo' : 'done';
    s = tm[2] ?? '';
  }
  let image: MindImage | undefined;
  // a linked image ([![x](a.png)](url)) is kept as plain text so it is written back unchanged
  const linkedImage = s.includes('[![');
  const im = linkedImage ? null : IMG_RE.exec(s);
  if (im) {
    let alt = im[1];
    let width: number | undefined;
    const wm = /^(.*?)\|(\d+)(?:x\d+)?$/.exec(alt);
    if (wm) {
      alt = wm[1];
      width = parseInt(wm[2], 10);
    }
    const before = s.slice(0, im.index).trim();
    const after = s.slice(im.index + im[0].length).trim();
    image = { src: im[2], alt, width, title: im[3], atStart: !before && !!after };
    s = [before, after].filter(Boolean).join(' ');
  }
  let link: string | undefined;
  let linkTitle: string | undefined;
  const lm = linkedImage ? null : TOPIC_LINK_RE.exec(s);
  if (lm) {
    s = lm[1];
    link = lm[2];
    linkTitle = lm[3];
  }
  return { text: s.replace(BR_RE, '\n'), image, task, side, link, linkTitle };
}

export function imageToken(img: MindImage): string {
  const w = img.width ? `|${Math.round(img.width)}` : '';
  return `![${img.alt}${w}](${img.src}${img.title ? ' ' + img.title : ''})`;
}

/** One topic as written on its heading / list line. `main`: a child of the central topic. */
export function topicLine(n: MindNode, main = false): string {
  let t = n.text.replace(/\r?\n/g, '<br>');
  if (n.link) t = `[${t}](${n.link}${n.linkTitle ? ' ' + n.linkTitle : ''})`;
  if (n.image) {
    const tok = imageToken(n.image);
    t = !t ? tok : n.image.atStart ? `${tok} ${t}` : `${t} ${tok}`;
  }
  if (n.task) t = (n.task === 'done' ? '[x]' : '[ ]') + (t ? ' ' + t : '');
  if (main && n.side === 'left') t = t ? `${t} ${LEFT_MARK}` : LEFT_MARK;
  return t;
}

function parseFrontMatter(lines: string[], doc: MindDoc) {
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^mindmap[ \t]*:[ \t]*$/.test(lines[i])) {
      doc.mindmapAt = out.length;
      i++;
      while (i < lines.length && (/^[ \t]+\S/.test(lines[i]) || BLANK_RE.test(lines[i]))) {
        const m = /^[ \t]+([\w-]+)[ \t]*:[ \t]*["']?([^"'#]*?)["']?[ \t]*(?:#.*)?$/.exec(lines[i]);
        const key = m?.[1];
        const val = m?.[2] ?? '';
        if (key === 'layout' && (LAYOUTS as string[]).includes(val)) doc.settings.layout = val as Layout;
        else if (key === 'theme' && val) doc.settings.theme = val;
        else if ((key === 'lineStyle' || key === 'line-style') && (LINE_STYLES as string[]).includes(val)) doc.settings.lineStyle = val as LineStyle;
        else if (lines[i].trim()) doc.mindmapExtra.push(lines[i]);
        i++;
      }
      i--;
      continue;
    }
    out.push(lines[i]);
  }
  doc.frontMatter = out;
}

function buildFrontMatter(doc: MindDoc): string[] | null {
  const s = doc.settings;
  const block: string[] = [];
  if (s.layout || s.theme || s.lineStyle || doc.mindmapExtra.length) {
    block.push('mindmap:');
    if (s.layout) block.push(`  layout: ${s.layout}`);
    if (s.theme) block.push(`  theme: ${s.theme}`);
    if (s.lineStyle) block.push(`  lineStyle: ${s.lineStyle}`);
    block.push(...doc.mindmapExtra);
  }
  if (!doc.frontMatter && !block.length) return null;
  const fm = doc.frontMatter ? [...doc.frontMatter] : [];
  if (block.length) {
    const at = doc.mindmapAt >= 0 && doc.mindmapAt <= fm.length ? doc.mindmapAt : fm.length;
    fm.splice(at, 0, ...block);
  }
  return fm;
}

let fallbackSeq = 0;
const fallbackId = () => 'm' + (++fallbackSeq).toString(36);

export function parseMarkdown(src: string, opts: ParseOptions): MindDoc {
  const genId = opts.genId ?? fallbackId;
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  const lines = src.split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();

  const doc: MindDoc = {
    root: null as unknown as MindNode,
    virtualRoot: false,
    mindmapAt: -1,
    mindmapExtra: [],
    settings: {},
    eol,
    indentUnit: 2,
  };

  let i = 0;
  if (lines.length && /^---[ \t]*$/.test(lines[0])) {
    let j = 1;
    while (j < lines.length && !/^(---|\.\.\.)[ \t]*$/.test(lines[j])) j++;
    if (j < lines.length) {
      parseFrontMatter(lines.slice(1, j), doc);
      i = j + 1;
    }
  }

  const top: MindNode = { id: genId(), text: opts.rootText, kind: 'heading', children: [] };
  const notes = new Map<MindNode, string[]>();
  const preamble: string[] = [];
  const headingStack: MindNode[] = [];
  let listStack: { node: MindNode; indent: number; content: number }[] = [];
  let currentHeading: MindNode | null = null;
  let seenStructure = false;
  let pendingBlanks = 0;
  let fence: { ch: string; len: number; target: MindNode | null; dedent: number } | null = null;
  const nestedIndents: number[] = [];

  const append = (target: MindNode | null, line: string) => {
    if (!target) {
      preamble.push(line);
      return;
    }
    let buf = notes.get(target);
    if (!buf) notes.set(target, (buf = []));
    buf.push(line);
  };

  const mkNode = (raw: string, kind: NodeKind, line: number): MindNode => {
    const t = parseTopicText(raw);
    seenStructure = true;
    return { id: genId(), ...t, kind, line, children: [] };
  };

  for (; i < lines.length; i++) {
    const line = lines[i];

    if (fence) {
      append(fence.target, dedent(line, fence.dedent));
      const m = /^[ \t]*(`{3,}|~{3,})[ \t]*$/.exec(line);
      if (m && m[1][0] === fence.ch && m[1].length >= fence.len) fence = null;
      continue;
    }

    if (BLANK_RE.test(line)) {
      pendingBlanks++;
      continue;
    }

    const hm = HEADING_RE.exec(line);
    if (hm) {
      pendingBlanks = 0;
      listStack = [];
      const level = hm[1].length;
      const node = mkNode(hm[2] ?? '', 'heading', i);
      node.level = level;
      while (headingStack.length && headingStack[headingStack.length - 1].level! >= level) headingStack.pop();
      (headingStack.length ? headingStack[headingStack.length - 1] : top).children.push(node);
      headingStack.push(node);
      currentHeading = node;
      continue;
    }

    const lm = HR_RE.test(line) ? null : LIST_RE.exec(line);
    if (lm) {
      pendingBlanks = 0;
      const indent = cols(lm[1]);
      while (listStack.length && indent < listStack[listStack.length - 1].content) listStack.pop();
      const parentEntry = listStack[listStack.length - 1];
      const node = mkNode(lm[3] ?? '', 'list', i);
      node.marker = lm[2];
      node.indent = parentEntry ? indent - parentEntry.indent : indent;
      if (parentEntry) nestedIndents.push(node.indent);
      (parentEntry ? parentEntry.node : currentHeading ?? top).children.push(node);
      listStack.push({ node, indent, content: indent + lm[2].length + 1 });
      continue;
    }

    // Anything else is note content for the closest topic.
    const ind = cols(leadingWs(line));
    let target: MindNode | null;
    let dedentBy = 0;
    if (listStack.length) {
      let k = listStack.length - 1;
      while (k >= 0 && listStack[k].content > ind) k--;
      if (k >= 0) {
        target = listStack[k].node;
        dedentBy = listStack[k].content;
        listStack.length = k + 1;
      } else if (pendingBlanks === 0) {
        // lazy continuation line
        target = listStack[listStack.length - 1].node;
        dedentBy = ind;
      } else {
        listStack = [];
        target = currentHeading ?? top;
      }
    } else {
      target = currentHeading ?? (seenStructure ? top : null);
    }
    for (; pendingBlanks > 0; pendingBlanks--) append(target, '');
    append(target, dedent(line, dedentBy));
    const fm = FENCE_RE.exec(line);
    if (fm) fence = { ch: fm[1][0], len: fm[1].length, target, dedent: dedentBy };
  }

  for (const [node, buf] of notes) {
    let a = 0;
    let b = buf.length;
    while (a < b && BLANK_RE.test(buf[a])) a++;
    while (b > a && BLANK_RE.test(buf[b - 1])) b--;
    if (b > a) node.note = buf.slice(a, b).join('\n');
  }
  {
    let a = 0;
    let b = preamble.length;
    while (a < b && BLANK_RE.test(preamble[a])) a++;
    while (b > a && BLANK_RE.test(preamble[b - 1])) b--;
    if (b > a) doc.preamble = preamble.slice(a, b).join('\n');
  }

  if (top.children.length === 1 && top.children[0].kind === 'heading' && !top.note) {
    doc.root = top.children[0];
    doc.virtualRoot = false;
  } else {
    doc.root = top;
    doc.virtualRoot = top.children.length > 0 || !!top.note;
  }

  if (nestedIndents.length) {
    const freq = new Map<number, number>();
    for (const n of nestedIndents) freq.set(n, (freq.get(n) ?? 0) + 1);
    doc.indentUnit = [...freq.entries()].sort((x, y) => y[1] - x[1] || x[0] - y[0])[0][0];
  }
  return doc;
}

export interface SerializeResult {
  text: string;
  /** Node id -> 0-based line of its heading / list item. */
  lineOf: Map<string, number>;
}

export function serializeDoc(doc: MindDoc, opts: SerializeOptions): SerializeResult {
  const out: string[] = [];
  const lineOf = new Map<string, number>();
  const unit = doc.indentUnit || 2;
  const blank = () => {
    if (out.length && out[out.length - 1] !== '') out.push('');
  };
  const pushLines = (text: string) => {
    for (const l of text.split(/\r?\n/)) out.push(l);
  };

  const resolveKinds = (kids: MindNode[], childDepth: number): NodeKind[] => {
    const dflt: NodeKind = childDepth < opts.headingLevels ? 'heading' : 'list';
    let prev: NodeKind = kids.find(k => k.kind)?.kind ?? dflt;
    return kids.map(k => (prev = k.kind ?? prev));
  };

  const headingLevelFor = (kids: MindNode[], kinds: NodeKind[], plevel: number): number => {
    let lv: number | undefined;
    let consistent = true;
    kids.forEach((k, i) => {
      if (kinds[i] === 'heading' && k.kind === 'heading' && k.level) {
        if (lv === undefined) lv = k.level;
        else if (lv !== k.level) consistent = false;
      }
    });
    return lv !== undefined && consistent && lv > plevel && lv <= 6 ? lv : plevel + 1;
  };

  const emitList = (items: MindNode[], parent: { indent: number; markerLen: number } | null, depth: number) => {
    const firstMarker = items.find(k => k.marker)?.marker ?? '-';
    const om = /^(\d+)([.)])$/.exec(firstMarker);
    const startM = items[0].marker ? /^(\d+)/.exec(items[0].marker) : null;
    const start = startM ? parseInt(startM[1], 10) : 1;
    const bullet = om ? '-' : firstMarker;
    const stored = items.find(k => k.kind === 'list' && k.indent !== undefined)?.indent;
    let indent: number;
    if (parent) {
      const lo = parent.markerLen + 1;
      const delta = Math.min(Math.max(stored ?? unit, lo), lo + 3);
      indent = parent.indent + delta;
    } else {
      indent = stored !== undefined && stored <= 3 ? stored : 0;
    }
    items.forEach((n, idx) => {
      const marker = om ? `${start + idx}${om[2]}` : n.marker && !/^\d/.test(n.marker) ? n.marker : bullet;
      const t = topicLine(n, depth === 1);
      lineOf.set(n.id, out.length);
      out.push(' '.repeat(indent) + marker + (t ? ' ' + t : ''));
      const content = ' '.repeat(indent + marker.length + 1);
      if (n.note) for (const l of n.note.split(/\r?\n/)) out.push(BLANK_RE.test(l) ? '' : content + l);
      if (n.children.length) emitList(n.children, { indent, markerLen: marker.length }, depth + 1);
    });
  };

  const emitChildren = (p: MindNode, plevel: number, depth: number) => {
    const kids = p.children;
    if (!kids.length) return;
    const kinds = resolveKinds(kids, depth + 1);
    const hl = headingLevelFor(kids, kinds, plevel);
    if (hl > 6) kinds.fill('list');
    // Markdown can only express "list items first, then sub-headings" under a heading.
    let seenHeading = false;
    for (let i = 0; i < kinds.length; i++) {
      if (kinds[i] === 'heading') seenHeading = true;
      else if (seenHeading) kinds[i] = 'heading';
    }
    let i = 0;
    if (kinds[0] === 'list') {
      let j = 0;
      while (j < kids.length && kinds[j] === 'list') j++;
      blank();
      emitList(kids.slice(0, j), null, depth + 1);
      i = j;
    }
    for (; i < kids.length; i++) emitHeading(kids[i], hl, depth + 1);
  };

  const emitHeading = (n: MindNode, level: number, depth: number) => {
    blank();
    lineOf.set(n.id, out.length);
    const t = topicLine(n, depth === 1);
    out.push('#'.repeat(level) + (t ? ' ' + t : ''));
    if (n.note) {
      blank();
      pushLines(n.note);
    }
    emitChildren(n, level, depth);
  };

  const fm = buildFrontMatter(doc);
  if (fm) out.push('---', ...fm, '---');
  if (doc.preamble) {
    blank();
    pushLines(doc.preamble);
  }
  if (doc.virtualRoot) {
    if (doc.root.note) {
      blank();
      pushLines(doc.root.note);
    }
    emitChildren(doc.root, 0, 0);
  } else {
    emitHeading(doc.root, doc.root.level ?? 1, 0);
  }
  return { text: out.length ? out.join(doc.eol) + doc.eol : '', lineOf };
}

function stripSource(n: MindNode, genId: () => string, keepKind: boolean): MindNode {
  return {
    id: genId(),
    text: n.text,
    kind: keepKind ? 'list' : undefined,
    task: n.task,
    image: n.image ? { ...n.image } : undefined,
    link: n.link,
    linkTitle: n.linkTitle,
    note: n.note,
    children: n.children.map(c => stripSource(c, genId, keepKind)),
  };
}

/** Markdown bullet list for the given topics (used for copy). */
export function nodesToMarkdown(nodes: MindNode[], eol = '\n'): string {
  const root: MindNode = { id: '_', text: '', children: nodes.map(n => stripSource(n, fallbackId, true)) };
  const doc: MindDoc = { root, virtualRoot: true, mindmapAt: -1, mindmapExtra: [], settings: {}, eol, indentUnit: 2 };
  return serializeDoc(doc, { headingLevels: 0 }).text;
}

/** Topics parsed from pasted text. Plain lines become one topic each. */
export function markdownToNodes(text: string, genId: () => string): MindNode[] {
  const doc = parseMarkdown(text, { rootText: '', genId });
  const nodes = doc.virtualRoot ? doc.root.children : doc.root.line !== undefined ? [doc.root] : [];
  if (!nodes.length) {
    return text
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(Boolean)
      .map(l => ({ id: genId(), ...parseTopicText(l), children: [] }));
  }
  return nodes.map(n => stripSource(n, genId, false));
}

export function walk(n: MindNode, fn: (node: MindNode, parent: MindNode | null, depth: number) => void | false, parent: MindNode | null = null, depth = 0) {
  if (fn(n, parent, depth) === false) return;
  for (const c of n.children) walk(c, fn, n, depth + 1);
}

/** Give re-parsed nodes the ids (and fold state) of the nodes they most likely correspond to. */
export function reconcile(oldRoot: MindNode, newRoot: MindNode) {
  newRoot.id = oldRoot.id;
  newRoot.collapsed = oldRoot.collapsed;
  const matchChildren = (olds: MindNode[], news: MindNode[]) => {
    const used = new Set<MindNode>();
    const pairs: (MindNode | undefined)[] = news.map(n => {
      const o = olds.find(x => !used.has(x) && x.text === n.text);
      if (o) used.add(o);
      return o;
    });
    // Pair what is left in order: most likely renamed topics.
    const leftovers = olds.filter(o => !used.has(o));
    let li = 0;
    news.forEach((_, i) => {
      if (!pairs[i] && li < leftovers.length) pairs[i] = leftovers[li++];
    });
    news.forEach((n, i) => {
      const o = pairs[i];
      if (!o) return;
      n.id = o.id;
      n.collapsed = o.collapsed;
      matchChildren(o.children, n.children);
    });
  };
  matchChildren(oldRoot.children, newRoot.children);
}

/** Escape lines of a note that Markdown would otherwise read as headings or list items. */
export function escapeNote(note: string): string {
  let inFence: { ch: string; len: number } | null = null;
  return note
    .split(/\r?\n/)
    .map(line => {
      const f = /^[ \t]*(`{3,}|~{3,})/.exec(line);
      if (inFence) {
        if (f && f[1][0] === inFence.ch && f[1].length >= inFence.len && /^[ \t]*[`~]+[ \t]*$/.test(line)) inFence = null;
        return line;
      }
      if (f) {
        inFence = { ch: f[1][0], len: f[1].length };
        return line;
      }
      if (HEADING_RE.test(line)) return line.replace(/^([ \t]*)#/, '$1\\#');
      if (!HR_RE.test(line) && LIST_RE.test(line)) {
        return /^[ \t]*\d/.test(line) ? line.replace(/^([ \t]*\d+)([.)])/, '$1\\$2') : line.replace(/^([ \t]*)([-*+])/, '$1\\$2');
      }
      return line;
    })
    .join('\n');
}
