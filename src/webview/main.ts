import { escapeNote, imageToken, markdownToNodes, nodesToMarkdown, parseMarkdown, reconcile, serializeDoc, TOPIC_WIDTH_MAX, TOPIC_WIDTH_MIN, walk } from '../shared/markdown';
import type { Layout, LineStyle, MindDoc, MindNode } from '../shared/model';
import type { FromWebview, MindConfig, ToWebview } from '../shared/protocol';
import { setLang, t } from './i18n';
import { icons, layoutIcons } from './icons';
import { escapeHtml, renderInline } from './inline';
import { layoutTree, type Box } from './layout';
import { anchorOut, branchPath, foldPoint, type LineOpts } from './lines';
import { hasStyle, setStyle, toggleInline, type InlineStyle } from './format';
import { handleEditKey, recordChange, resetHistory, trackHistory, type TextField } from './textHistory';
import { readableOn, resolveTheme, THEMES, withAlpha, type Theme } from './themes';

interface VsApi {
  postMessage(m: unknown): void;
  getState(): unknown;
  setState(s: unknown): void;
}
declare function acquireVsCodeApi(): VsApi;

const vscode = acquireVsCodeApi();
const post = (m: FromWebview) => vscode.postMessage(m);
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
/** Shortcut label in the platform's style: Mac "⇧⌘I", Windows / Linux "Ctrl+Shift+I". */
function keyLabel(combo: string): string {
  const parts = combo.split('+');
  const key = parts.pop()!;
  const has = (m: string) => parts.includes(m);
  if (isMac) return (has('alt') ? '⌥' : '') + (has('shift') ? '⇧' : '') + (has('mod') ? '⌘' : '') + (key === 'Enter' ? '↵' : key);
  return [has('mod') && 'Ctrl', has('shift') && 'Shift', has('alt') && 'Alt', key].filter(Boolean).join('+');
}
const LAYOUTS: Layout[] = ['map', 'right', 'left', 'down'];
const LINE_STYLES: LineStyle[] = ['curve', 'elbow', 'straight'];
const FORMAT_W = 272;

let seq = 0;
const genId = () => 'k' + (++seq).toString(36);

type Pos = 'child' | 'before' | 'after' | 'parent';
type Dir = 'up' | 'down' | 'left' | 'right';
interface DropOption {
  pos: Pos;
  /** Which side of the central topic a new main topic goes to (balanced map). */
  side?: 1 | -1;
}
interface DropTarget extends DropOption {
  id: string;
  dir: Dir;
  dirs: Dir[];
  /** Distance of each arrow from the topic's edge (canvas units). */
  offs: Record<Dir, number>;
}

const S = {
  doc: null as MindDoc | null,
  text: '',
  pending: 0,
  pendingReveal: null as number | null,
  config: { defaultLayout: 'map', defaultTheme: 'auto', defaultLineStyle: 'curve', headingLevels: 2, syncSelection: true } as MindConfig,
  fileName: 'Mind Map',
  baseUri: null as string | null,
  canSaveImages: true,
  sel: new Set<string>(),
  focus: null as string | null,
  /** Topic whose image (not the topic itself) is selected: Delete removes just the image. */
  imageSel: null as string | null,
  editing: null as null | { id: string; original: string; isNew: boolean; draft: string },
  view: { x: 0, y: 0, s: 1 },
  boxes: new Map<string, Box>(),
  nodes: new Map<string, MindNode>(),
  parents: new Map<string, MindNode | null>(),
  depth: new Map<string, number>(),
  formatOpen: false,
  noteId: null as string | null,
  hover: null as string | null,
  started: false,
};

// ---------------------------------------------------------------- DOM shell

const app = document.getElementById('app')!;
app.innerHTML = `
<div id="viewport">
  <div id="canvas">
    <svg id="lines"></svg>
    <div id="nodes"></div>
    <div id="folds"></div>
    <svg id="overlay"></svg>
    <textarea id="editor" class="sink" spellcheck="false" autocomplete="off" autocorrect="off" autocapitalize="off" rows="1"></textarea>
  </div>
</div>
<div id="toolbar" class="bar"></div>
<div id="zoombar" class="bar"></div>
<div id="statusbar"></div>
<aside id="format"></aside>
<div id="note" class="card"></div>
<div id="menu" class="card"></div>
<div id="drop-label"></div>
<div id="marquee"></div>
<div id="linkbox" class="card"></div>`;
trackHistory(app);

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const viewport = $<HTMLDivElement>('viewport');
const canvas = $<HTMLDivElement>('canvas');
const linesSvg = document.getElementById('lines') as unknown as SVGSVGElement;
const overlaySvg = document.getElementById('overlay') as unknown as SVGSVGElement;
const nodesLayer = $<HTMLDivElement>('nodes');
const foldsLayer = $<HTMLDivElement>('folds');
const editor = $<HTMLTextAreaElement>('editor');
const toolbar = $<HTMLDivElement>('toolbar');
const zoombar = $<HTMLDivElement>('zoombar');
const statusbar = $<HTMLDivElement>('statusbar');
const formatEl = $<HTMLElement>('format');
const noteEl = $<HTMLDivElement>('note');
const menuEl = $<HTMLDivElement>('menu');
const dropLabelEl = $<HTMLDivElement>('drop-label');
const marqueeEl = $<HTMLDivElement>('marquee');
const linkEl = $<HTMLDivElement>('linkbox');

const topicEls = new Map<string, HTMLElement>();
const foldEls = new Map<string, HTMLElement>();

// ---------------------------------------------------------------- model helpers

const root = () => S.doc!.root;
const node = (id: string | null | undefined) => (id ? S.nodes.get(id) : undefined);
const parentOf = (id: string) => S.parents.get(id) ?? null;

function indexTree() {
  S.nodes.clear();
  S.parents.clear();
  S.depth.clear();
  if (!S.doc) return;
  walk(S.doc.root, (n, p, d) => {
    S.nodes.set(n.id, n);
    S.parents.set(n.id, p);
    S.depth.set(n.id, d);
  });
}

function settings() {
  const s = S.doc?.settings ?? {};
  return {
    layout: (s.layout ?? S.config.defaultLayout) as Layout,
    lineStyle: (s.lineStyle ?? S.config.defaultLineStyle) as LineStyle,
    themeId: s.theme ?? S.config.defaultTheme,
  };
}

const vsDark = () => document.body.classList.contains('vscode-dark') || document.body.classList.contains('vscode-high-contrast');
const theme = (): Theme => resolveTheme(settings().themeId, vsDark());

function isUnderline(b: Box, th: Theme) {
  return (b.depth === 1 && th.main === 'underline') || (b.depth >= 2 && th.sub === 'underline');
}

function lineOpts(th: Theme): LineOpts {
  const { layout, lineStyle } = settings();
  return { style: lineStyle, vertical: layout === 'down', fromCenter: layout === 'map', underline: b => isUnderline(b, th) };
}

function newNode(text: string): MindNode {
  return { id: genId(), text, children: [] };
}

function defaultText(depth: number) {
  return depth <= 1 ? t('mainTopic') : t('newSubtopic');
}

function countDescendants(n: MindNode): number {
  let c = 0;
  walk(n, () => {
    c++;
  });
  return c - 1;
}

function isAncestor(a: string, b: string): boolean {
  for (let p = parentOf(b); p; p = parentOf(p.id)) if (p.id === a) return true;
  return false;
}

/** Selected ids without those whose ancestor is selected too, in document order. */
function topLevelSelection(ids: Iterable<string> = S.sel): string[] {
  const set = new Set(ids);
  const out: string[] = [];
  walk(root(), n => {
    if (set.has(n.id)) {
      out.push(n.id);
      return false;
    }
  });
  return out;
}

function resolveSrc(src: string): string {
  const s = src.replace(/^<|>$/g, '');
  if (/^(https?:|data:|blob:)/i.test(s)) return s;
  if (!S.baseUri) return '';
  try {
    return new URL(s, S.baseUri).toString();
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------- document sync

/** Serialize the model, send it to VS Code, and re-read it so the model matches the file exactly. */
function commit(select?: string[]) {
  const doc = S.doc!;
  const { text, lineOf } = serializeDoc(doc, { headingLevels: S.config.headingLevels });
  const fresh = parseMarkdown(text, { rootText: S.fileName, genId });
  const byLine = new Map<number, MindNode>();
  walk(doc.root, n => {
    const l = lineOf.get(n.id);
    if (l !== undefined) byLine.set(l, n);
  });
  walk(fresh.root, n => {
    const o = n.line !== undefined ? byLine.get(n.line) : undefined;
    if (o) {
      n.id = o.id;
      n.collapsed = o.collapsed;
    }
  });
  if (fresh.root.line === undefined) {
    fresh.root.id = doc.root.id;
    fresh.root.collapsed = doc.root.collapsed;
  }
  S.doc = fresh;
  if (text !== S.text) {
    S.text = text;
    S.pending++;
    post({ type: 'edit', text });
  }
  indexTree();
  if (select) setSelection(select.filter(id => S.nodes.has(id)));
  pruneSelection();
  render();
  if (S.focus) ensureVisible(S.focus);
}

function loadText(text: string) {
  const fresh = parseMarkdown(text, { rootText: S.fileName, genId });
  if (S.doc) reconcile(S.doc.root, fresh.root);
  S.doc = fresh;
  S.text = text;
  indexTree();
  if (S.editing && !S.nodes.has(S.editing.id)) {
    S.editing = null;
    resetEditor();
  }
  if (S.noteId && !S.nodes.has(S.noteId)) closeNote(false);
  pruneSelection();
  render();
}

function pruneSelection() {
  S.sel = new Set([...S.sel].filter(id => S.nodes.has(id)));
  if (S.imageSel && (!node(S.imageSel)?.image || !S.sel.has(S.imageSel))) S.imageSel = null;
  if (!S.focus || !S.nodes.has(S.focus)) S.focus = [...S.sel].pop() ?? null;
}

function setSelection(ids: string[], reveal = true) {
  S.sel = new Set(ids);
  S.imageSel = null;
  S.focus = ids[ids.length - 1] ?? null;
  if (reveal) revealInSource(S.focus);
}

function revealInSource(id: string | null) {
  const n = node(id);
  if (!S.config.syncSelection || n?.line === undefined) return;
  if (S.pending) S.pendingReveal = n.line;
  else post({ type: 'revealLine', line: n.line });
}

function select(id: string, reveal = true) {
  setSelection([id], reveal);
  refreshSelection();
  ensureVisible(id);
}

/** Select the image inside a topic rather than the whole topic. */
function selectImage(id: string) {
  if (!node(id)?.image) return select(id);
  setSelection([id]);
  S.imageSel = id;
  refreshSelection();
}

function refreshSelection() {
  for (const [id, el] of topicEls) {
    el.classList.toggle('sel', S.sel.has(id));
    el.classList.toggle('focus', S.focus === id);
    el.classList.toggle('img-sel', S.imageSel === id);
  }
  positionEditor();
  updateToolbar();
  updateStatus();
}

/** thinkmark.topicMaxWidth.* → the wrap widths in webview.css (which keeps its own defaults for missing values). */
function applyTopicWidths() {
  const w = S.config.topicMaxWidth;
  const set = (name: string, v: number | undefined) => {
    if (typeof v === 'number' && Number.isFinite(v)) app.style.setProperty(name, `${Math.min(200, Math.max(6, v))}em`);
    else app.style.removeProperty(name);
  };
  set('--w-d0', w?.central);
  set('--w-d1', w?.main);
  set('--w-dn', w?.sub);
}

window.addEventListener('message', (e: MessageEvent<ToWebview>) => {
  const m = e.data;
  switch (m.type) {
    case 'init':
      S.config = m.config;
      applyTopicWidths();
      S.fileName = m.fileName || 'Mind Map';
      S.baseUri = m.baseUri;
      S.canSaveImages = m.canSaveImages;
      setLang(m.lang);
      buildChrome();
      loadText(m.text);
      if (!S.focus) setSelection([root().id], false);
      start();
      break;
    case 'update':
      if (S.pending === 0 && m.text !== S.text) loadText(m.text);
      break;
    case 'ack':
      S.pending = Math.max(0, S.pending - 1);
      if (S.pending === 0) {
        if (m.text !== S.text) loadText(m.text);
        if (S.pendingReveal !== null) {
          post({ type: 'revealLine', line: S.pendingReveal });
          S.pendingReveal = null;
        }
      }
      break;
    case 'config':
      S.config = m.config;
      applyTopicWidths();
      render();
      buildFormat();
      break;
    case 'imageReady': {
      const n = node(m.nodeId) ?? node(S.focus) ?? root();
      n.image = { src: m.src, alt: n.image?.alt ?? '', atStart: false };
      commit([n.id]);
      break;
    }
    case 'selectLine':
      selectByLine(m.line);
      break;
  }
});

function start() {
  if (S.started) return;
  S.started = true;
  const st = vscode.getState() as { view?: { x: number; y: number; s: number }; formatOpen?: boolean } | undefined;
  S.formatOpen = !!st?.formatOpen;
  app.classList.toggle('format-open', S.formatOpen);
  if (st?.view) {
    S.view = st.view;
    applyView();
  } else fitView(1);
  focusEditor();
  document.fonts?.ready.then(() => render());
}

function saveState() {
  vscode.setState({ view: S.view, formatOpen: S.formatOpen });
}

function selectByLine(line: number) {
  if (!S.doc) return;
  let best: MindNode | undefined;
  walk(root(), n => {
    if (n.line !== undefined && n.line <= line && (!best || n.line > best.line!)) best = n;
  });
  const target = best ?? root();
  if (target.id === S.focus && S.sel.size === 1) return;
  let changed = false;
  for (let p = parentOf(target.id); p; p = parentOf(p.id))
    if (p.collapsed) {
      p.collapsed = false;
      changed = true;
    }
  setSelection([target.id], false);
  if (changed) render();
  else refreshSelection();
  ensureVisible(target.id);
}

// ---------------------------------------------------------------- rendering

let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}

function applyTheme(th: Theme) {
  const st = app.style;
  const dark = th.dark;
  const vars: Record<string, string> = {
    '--bg': th.bg,
    '--root-bg': th.rootBg,
    '--root-fg': th.rootFg,
    '--root-border': th.rootBorder ?? 'transparent',
    '--main-fg': th.mainFg,
    '--sub-fg': th.subFg,
    '--surface': th.surface,
    '--sel': dark ? '#4da3ff' : '#2e8cf0',
    '--sel-soft': dark ? 'rgba(77,163,255,.35)' : 'rgba(46,140,240,.35)',
    '--ui-bg': dark ? '#2a2d35' : '#ffffff',
    '--ui-fg': dark ? '#e3e6ec' : '#2c2f36',
    '--ui-muted': dark ? '#9399a6' : '#868b94',
    '--ui-border': dark ? 'rgba(255,255,255,.09)' : 'rgba(17,24,39,.09)',
    '--ui-hover': dark ? 'rgba(255,255,255,.07)' : 'rgba(17,24,39,.055)',
    '--ui-active': dark ? 'rgba(77,163,255,.18)' : 'rgba(46,140,240,.12)',
    '--ui-shadow': dark ? 'rgba(0,0,0,.45)' : 'rgba(15,23,42,.10)',
  };
  for (const k in vars) st.setProperty(k, vars[k]);
  document.body.style.background = th.bg;
  app.classList.remove('main-filled', 'main-outline', 'main-tint', 'main-underline', 'sub-plain', 'sub-underline', 'dark', 'light');
  app.classList.add(`main-${th.main}`, `sub-${th.sub}`, dark ? 'dark' : 'light');
}

function topicInner(n: MindNode): string {
  let h = '';
  if (n.image) {
    const w = n.image.width;
    h += `<div class="t-img-wrap"><img class="t-img${w ? ' sized' : ''}" src="${escapeHtml(resolveSrc(n.image.src))}" alt="${escapeHtml(n.image.alt)}" draggable="false"${w ? ` style="width:${w}px"` : ''}><span class="t-img-resize" data-act="resize"></span></div>`;
  }
  h += '<div class="t-row">';
  if (n.task) h += `<span class="t-task${n.task === 'done' ? ' done' : ''}" data-act="task"></span>`;
  h += '<span class="t-text"></span>';
  if (n.link) h += `<span class="t-link" data-act="link" title="${escapeHtml(linkTarget(n.link))}">${icons.linkSmall}</span>`;
  if (n.note) h += `<span class="t-note" data-act="note" title="${escapeHtml(n.note.length > 400 ? n.note.slice(0, 400) + '…' : n.note)}">${icons.noteSmall}</span>`;
  h += '</div>';
  // drag the outer edge to set the width (not for a central topic that is only the file name)
  if (canResize(n)) h += `<span class="t-resize" data-act="width" title="${escapeHtml(t('resizeHint'))}"></span>`;
  return h;
}

const canResize = (n: MindNode) => !(S.doc?.virtualRoot && n === root());

function ensureTopic(n: MindNode, depth: number, branch: string, th: Theme): HTMLElement {
  let el = topicEls.get(n.id);
  if (!el) {
    el = document.createElement('div');
    el.dataset.id = n.id;
    nodesLayer.appendChild(el);
    topicEls.set(n.id, el);
  }
  const sig = JSON.stringify([n.image?.src, n.image?.width, n.task, n.note ?? '', n.link, S.baseUri, canResize(n)]);
  if (el.dataset.sig !== sig) {
    el.innerHTML = topicInner(n);
    el.dataset.sig = sig;
    delete el.dataset.text;
  }
  const editing = S.editing?.id === n.id;
  const text = editing ? S.editing!.draft : n.text;
  const key = (editing ? 'E' : 'R') + text;
  if (el.dataset.text !== key) {
    const tEl = el.querySelector('.t-text') as HTMLElement;
    tEl.innerHTML = editing ? escapeHtml(text) + '&#8203;' : text ? renderInline(text) : '&#8203;';
    el.dataset.text = key;
  }
  el.className =
    'topic ' +
    (depth === 0 ? 'd0' : depth === 1 ? 'd1' : 'dn') +
    (S.sel.has(n.id) ? ' sel' : '') +
    (S.focus === n.id ? ' focus' : '') +
    (S.imageSel === n.id ? ' img-sel' : '') +
    (editing ? ' editing' : '') +
    (n.task === 'done' ? ' task-done' : '') +
    (n.image ? ' has-img' : '') +
    (n.width ? ' sized' : '') +
    (!text && !n.image ? ' empty' : '');
  el.style.width = n.width ? `${n.width}px` : '';
  el.style.setProperty('--branch', branch);
  el.style.setProperty('--branch-fg', th.fillFg === 'auto' ? readableOn(branch) : th.fillFg);
  el.style.setProperty('--branch-tint', withAlpha(branch, th.dark ? 0.22 : 0.12));
  return el;
}

function render() {
  const doc = S.doc;
  if (!doc) return;
  indexTree();
  const th = theme();
  applyTheme(th);
  const { layout } = settings();
  const seen = new Set<string>();
  const boxes = new Map<string, Box>();
  const build = (n: MindNode, parent: Box | null, depth: number, branch: string): Box => {
    const el = ensureTopic(n, depth, branch, th);
    seen.add(n.id);
    const b: Box = { node: n, parent, children: [], depth, side: 0, w: 0, h: 0, x: 0, y: 0, ext: 0, inner: 0, branch, el };
    boxes.set(n.id, b);
    if (!n.collapsed || depth === 0) {
      b.children = n.children.map((c, i) => build(c, b, depth + 1, depth === 0 ? th.palette[i % th.palette.length] : branch));
    }
    return b;
  };
  const rootBox = build(doc.root, null, 0, th.palette[0]);
  for (const [id, el] of topicEls)
    if (!seen.has(id)) {
      el.remove();
      topicEls.delete(id);
    }
  for (const b of boxes.values()) {
    b.w = b.el.offsetWidth;
    b.h = b.el.offsetHeight;
  }
  layoutTree(rootBox, layout);
  for (const b of boxes.values()) {
    b.el.style.transform = `translate(${b.x}px,${b.y}px)`;
    b.el.classList.toggle('left', b.side < 0);
  }
  S.boxes = boxes;
  drawLines(rootBox, th);
  drawFolds(th);
  positionEditor();
  updateStatus();
  updateToolbar();
  if (S.noteId) positionNote();
}

function drawLines(rootBox: Box, th: Theme) {
  const o = lineOpts(th);
  const parts: string[] = [];
  const visit = (b: Box) => {
    for (const c of b.children) {
      const color = th.line ?? c.branch;
      const p = branchPath(b, c, o);
      parts.push(
        p.filled
          ? `<path d="${p.d}" fill="${color}"/>`
          : `<path d="${p.d}" fill="none" stroke="${color}" stroke-width="${p.width}" stroke-linecap="round" stroke-linejoin="round"/>`,
      );
      visit(c);
    }
  };
  visit(rootBox);
  linesSvg.innerHTML = parts.join('');
}

function drawFolds(th: Theme) {
  const o = lineOpts(th);
  const seen = new Set<string>();
  for (const b of S.boxes.values()) {
    const n = b.node;
    if (b.depth === 0 || !n.children.length) continue;
    seen.add(n.id);
    let el = foldEls.get(n.id);
    if (!el) {
      el = document.createElement('div');
      el.dataset.id = n.id;
      el.dataset.act = 'fold';
      foldsLayer.appendChild(el);
      foldEls.set(n.id, el);
    }
    const p = foldPoint(b, o);
    el.style.transform = `translate(${p.x}px,${p.y}px) translate(-50%,-50%)`;
    el.style.setProperty('--fold', th.line ?? b.branch);
    el.textContent = n.collapsed ? String(countDescendants(n)) : '−';
    el.className = 'fold' + (n.collapsed ? ' collapsed' : '') + (S.hover === n.id ? ' hover' : '');
  }
  for (const [id, el] of foldEls)
    if (!seen.has(id)) {
      el.remove();
      foldEls.delete(id);
    }
}

function updateStatus() {
  if (!S.doc) return;
  const count = S.nodes.size;
  const hint = root().children.length === 0 ? ` · ${t('emptyHint')}` : '';
  const sel = S.sel.size > 1 ? ` · ${t('selectedN').replace('{0}', String(S.sel.size))}` : '';
  statusbar.textContent = `${t('topics')}: ${count}${sel}${hint}`;
}

// ---------------------------------------------------------------- view (pan / zoom)

function applyView() {
  const { x, y, s } = S.view;
  canvas.style.transform = `translate(${x}px,${y}px) scale(${s})`;
  const pct = zoombar.querySelector('#zoom-pct');
  if (pct) pct.textContent = `${Math.round(s * 100)}%`;
  saveTimer && clearTimeout(saveTimer);
  saveTimer = setTimeout(saveState, 300);
  if (S.noteId) positionNote();
}
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function zoomAt(cx: number, cy: number, s: number) {
  s = Math.min(3, Math.max(0.2, s));
  const r = viewport.getBoundingClientRect();
  const px = cx - r.left;
  const py = cy - r.top;
  const k = s / S.view.s;
  S.view.x = px - (px - S.view.x) * k;
  S.view.y = py - (py - S.view.y) * k;
  S.view.s = s;
  applyView();
}

function zoomBy(f: number) {
  const r = viewport.getBoundingClientRect();
  zoomAt(r.left + visibleWidth() / 2, r.top + r.height / 2, S.view.s * f);
}

const visibleWidth = () => viewport.clientWidth - (S.formatOpen ? FORMAT_W : 0);

function bounds() {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const b of S.boxes.values()) {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  return isFinite(x0) ? { x0, y0, x1, y1 } : { x0: -50, y0: -20, x1: 50, y1: 20 };
}

function fitView(maxScale = 3) {
  const { x0, y0, x1, y1 } = bounds();
  const top = 72;
  const pad = 48;
  const aw = visibleWidth() - pad * 2;
  const ah = viewport.clientHeight - top - pad * 2;
  const s = Math.min(maxScale, Math.max(0.2, Math.min(aw / (x1 - x0), ah / (y1 - y0))));
  S.view.s = s;
  S.view.x = pad + (aw - (x1 - x0) * s) / 2 - x0 * s;
  S.view.y = top + pad + (ah - (y1 - y0) * s) / 2 - y0 * s;
  applyView();
}

function actualSize() {
  const b = S.boxes.get(root().id);
  S.view.s = 1;
  S.view.x = visibleWidth() / 2 - (b ? b.x + b.w / 2 : 0);
  S.view.y = viewport.clientHeight / 2 - (b ? b.y + b.h / 2 : 0);
  applyView();
}

function ensureVisible(id: string) {
  const b = S.boxes.get(id);
  if (!b) return;
  const m = 40;
  const { x, y, s } = S.view;
  const l = b.x * s + x;
  const r = (b.x + b.w) * s + x;
  const top = b.y * s + y;
  const btm = (b.y + b.h) * s + y;
  const vw = visibleWidth();
  const vh = viewport.clientHeight;
  let dx = 0;
  let dy = 0;
  if (r - l > vw - 2 * m || l < m) dx = m - l;
  else if (r > vw - m) dx = vw - m - r;
  if (top < m + 56) dy = m + 56 - top;
  else if (btm > vh - m) dy = vh - m - btm;
  if (dx || dy) {
    S.view.x += dx;
    S.view.y += dy;
    applyView();
  }
}

function toCanvas(cx: number, cy: number) {
  const r = viewport.getBoundingClientRect();
  return { x: (cx - r.left - S.view.x) / S.view.s, y: (cy - r.top - S.view.y) / S.view.s };
}

// ---------------------------------------------------------------- text editing

function focusEditor() {
  if (document.activeElement !== editor) editor.focus({ preventScroll: true });
}

function resetEditor() {
  editor.value = '';
  resetHistory(editor);
  editor.classList.add('sink');
  editor.classList.remove('active');
  editor.removeAttribute('style');
  focusEditor();
}

function positionEditor() {
  const id = S.editing?.id ?? S.focus;
  const b = id ? S.boxes.get(id) : undefined;
  if (!b) {
    editor.style.transform = 'translate(-9999px,-9999px)';
    return;
  }
  const textEl = b.el.querySelector('.t-text') as HTMLElement;
  const tr = textEl.getBoundingClientRect();
  const br = b.el.getBoundingClientRect();
  const x = b.x + (tr.left - br.left) / S.view.s;
  const y = b.y + (tr.top - br.top) / S.view.s;
  if (S.editing) {
    const cs = getComputedStyle(textEl);
    editor.style.font = cs.font;
    editor.style.lineHeight = cs.lineHeight;
    editor.style.letterSpacing = cs.letterSpacing;
    editor.style.color = cs.color;
    editor.style.textAlign = cs.textAlign;
    // Exact (fractional) size rounded up: a box even 0.3px narrower than the text wraps the last
    // character onto a second line and scrolls to it, which shows a single letter while typing.
    editor.style.width = `${Math.ceil(tr.width / S.view.s) + 1}px`;
    editor.style.height = `${Math.ceil(tr.height / S.view.s)}px`;
    editor.scrollTop = 0;
    editor.scrollLeft = 0;
  }
  editor.style.transform = `translate(${x}px,${y}px)`;
}

function beginEdit(id: string, mode: 'select' | 'end' | 'typed', isNew = false) {
  const n = node(id);
  if (!n) return;
  closeMenu();
  if (S.noteId) closeNote(true);
  S.editing = { id, original: n.text, isNew, draft: n.text };
  if (mode === 'typed') S.editing.draft = editor.value;
  else editor.value = n.text;
  // typing over a topic replaces its text; the first undo brings that text back
  resetHistory(editor, mode === 'typed' ? n.text : undefined);
  editor.classList.remove('sink');
  editor.classList.add('active');
  setSelection([id], !isNew);
  render();
  focusEditor();
  if (mode === 'select') editor.select();
  else if (mode === 'end') editor.setSelectionRange(editor.value.length, editor.value.length);
  ensureVisible(id);
}

function commitEdit() {
  const ed = S.editing;
  if (!ed) return;
  S.editing = null;
  let v = editor.value.replace(/^\s+|\s+$/g, '').replace(/\r/g, '');
  resetEditor();
  const n = node(ed.id);
  if (!n) return render();
  if (v !== n.text || ed.isNew) {
    n.text = v;
    commit([n.id]);
  } else render();
}

function cancelEdit() {
  const ed = S.editing;
  if (!ed) return;
  if (ed.isNew) {
    editor.value = ed.original;
    commitEdit();
    return;
  }
  S.editing = null;
  resetEditor();
  render();
}

editor.addEventListener('input', () => {
  if (!S.editing) {
    if (S.focus && editor.value) beginEdit(S.focus, 'typed');
    else editor.value = '';
    return;
  }
  S.editing.draft = editor.value;
  // Grow the hidden topic text and the text box right away, before the browser paints this keystroke;
  // the rest of the map is laid out again in the next frame.
  const el = topicEls.get(S.editing.id);
  const tEl = el?.querySelector('.t-text') as HTMLElement | null;
  if (el && tEl) {
    tEl.innerHTML = escapeHtml(S.editing.draft) + '&#8203;';
    el.dataset.text = 'E' + S.editing.draft;
    positionEditor();
  }
  scheduleRender();
});

editor.addEventListener('compositionstart', () => {
  if (!S.editing && S.focus) beginEdit(S.focus, 'typed');
});

editor.addEventListener('blur', () => {
  if (S.editing) setTimeout(() => S.editing && document.activeElement !== editor && commitEdit(), 0);
});

// ---------------------------------------------------------------- operations

function addChild(pid?: string | null) {
  if (S.editing) commitEdit();
  const p = node(pid ?? S.focus) ?? root();
  const c = newNode(defaultText((S.depth.get(p.id) ?? 0) + 1));
  p.children.push(c);
  p.collapsed = false;
  indexTree();
  beginEdit(c.id, 'select', true);
}

function addSibling(id: string | null, after: boolean) {
  if (S.editing) commitEdit();
  const n = node(id);
  const p = n && parentOf(n.id);
  if (!n || !p) return addChild(id);
  const c = newNode(defaultText(S.depth.get(n.id) ?? 1));
  c.side = n.side; // a new main topic stays on the side of the topic it was added next to
  p.children.splice(p.children.indexOf(n) + (after ? 1 : 0), 0, c);
  indexTree();
  beginEdit(c.id, 'select', true);
}

function addParent(id: string | null) {
  if (S.editing) commitEdit();
  const n = node(id);
  const p = n && parentOf(n.id);
  if (!n || !p) return;
  const c = newNode(defaultText(S.depth.get(n.id) ?? 1));
  c.children = [n];
  c.side = n.side;
  n.side = undefined;
  p.children[p.children.indexOf(n)] = c;
  indexTree();
  beginEdit(c.id, 'select', true);
}

function deleteSelection() {
  const ids = topLevelSelection().filter(id => id !== root().id);
  if (!ids.length) return;
  const first = node(ids[0])!;
  const p = parentOf(first.id)!;
  const del = new Set(ids);
  const idx = p.children.indexOf(first);
  const next = p.children.slice(idx + 1).find(c => !del.has(c.id)) ?? p.children.slice(0, idx).reverse().find(c => !del.has(c.id)) ?? p;
  for (const id of ids) {
    const pp = parentOf(id)!;
    pp.children.splice(pp.children.indexOf(node(id)!), 1);
  }
  commit([next.id]);
}

function moveSibling(id: string | null, delta: number) {
  const n = node(id);
  const p = n && parentOf(n.id);
  if (!n || !p) return;
  // main topics of the mind map move among the topics on their own side
  const peers = p === root() && settings().layout === 'map' ? p.children.filter(c => (c.side === 'left') === (n.side === 'left')) : p.children;
  const other = peers[peers.indexOf(n) + delta];
  if (!other) return;
  const i = p.children.indexOf(n);
  const j = p.children.indexOf(other);
  [p.children[i], p.children[j]] = [p.children[j], p.children[i]];
  commit([n.id]);
}

/** Put main topics on the left / right of the central topic (mind map structure). */
function setSide(ids: string[], left: boolean) {
  const nodes = ids.map(node).filter((n): n is MindNode => !!n && parentOf(n.id) === root());
  if (!nodes.length) return;
  for (const n of nodes) n.side = left ? 'left' : undefined;
  commit(nodes.map(n => n.id));
}

/** One-off: second half of the main topics to the left, like a balanced XMind map. */
function balanceSides(allRight = false) {
  const kids = root().children;
  const k = Math.ceil(kids.length / 2);
  kids.forEach((c, i) => (c.side = !allRight && i >= k ? 'left' : undefined));
  commit();
}

function moveNodes(ids: string[], targetId: string, pos: Pos, side?: 1 | -1) {
  const target = node(targetId);
  if (!target) return;
  const tops = topLevelSelection(ids).filter(id => id !== root().id && id !== targetId && !isAncestor(id, targetId));
  if (!tops.length) return;
  if (pos === 'parent' && (tops.length > 1 || target === root())) pos = 'before';
  const nodes = tops.map(id => node(id)!);
  const oldParents = new Map(nodes.map(n => [n, parentOf(n.id)!]));
  for (const n of nodes) {
    const p = oldParents.get(n)!;
    p.children.splice(p.children.indexOf(n), 1);
  }
  let newParent: MindNode;
  if (pos === 'child') {
    newParent = target;
    target.children.push(...nodes);
    target.collapsed = false;
    if (target === root() && settings().layout === 'map' && side) for (const n of nodes) n.side = side < 0 ? 'left' : undefined;
  } else if (pos === 'parent') {
    // the dragged topic takes the target's place and the target becomes its last subtopic
    const x = nodes[0];
    newParent = parentOf(targetId)!;
    newParent.children.splice(newParent.children.indexOf(target), 1, x);
    x.children.push(target);
    x.collapsed = false;
    x.side = target.side;
    target.side = undefined;
  } else {
    newParent = parentOf(targetId)!;
    newParent.children.splice(newParent.children.indexOf(target) + (pos === 'after' ? 1 : 0), 0, ...nodes);
    // next to a main topic: join its side
    for (const n of nodes) n.side = target.side;
  }
  for (const n of nodes) if (newParent !== root()) n.side = undefined;
  for (const n of nodes)
    if (oldParents.get(n) !== newParent) {
      // let the topic adopt the Markdown style of its new siblings
      n.kind = undefined;
      n.level = undefined;
      n.marker = undefined;
      n.indent = undefined;
    }
  commit(tops);
}

// ---------------------------------------------------------------- bold / italic / underline (Cmd+B / I / U)

const STYLE_KEYS: Record<string, InlineStyle> = { b: 'bold', i: 'italic', u: 'underline' };

function styleKey(e: KeyboardEvent, mod: boolean): InlineStyle | undefined {
  return mod && !e.shiftKey && !e.altKey ? STYLE_KEYS[e.key.toLowerCase()] : undefined;
}

/** Toggle a style on the selected text of a text box (topic text or note). */
function styleField(el: TextField, style: InlineStyle) {
  const r = toggleInline(el.value, el.selectionStart ?? 0, el.selectionEnd ?? 0, style);
  if (r.text !== el.value) {
    recordChange(el, 'other');
    el.value = r.text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  el.setSelectionRange(r.start, r.end);
}

/** Toggle a style on the whole text of the selected topics: off when all of them have it, on otherwise. */
function styleTopics(style: InlineStyle) {
  const ns = [...S.sel].map(node).filter((n): n is MindNode => !!n && !!n.text.trim());
  if (!ns.length) return;
  const on = !ns.every(n => hasStyle(n.text, style));
  for (const n of ns) n.text = setStyle(n.text, style, on);
  commit([...S.sel]);
}

/** Back to a width that fits the text. */
function resetWidth(id: string) {
  const n = node(id);
  if (!n?.width) return;
  n.width = undefined;
  commit([id]);
}

function toggleFold(id: string | null) {
  const n = node(id);
  if (!n || !n.children.length || n === root()) return;
  n.collapsed = !n.collapsed;
  if (n.collapsed && S.focus && isAncestor(n.id, S.focus)) setSelection([n.id], false);
  render();
}

/** Cmd+/ on a selection: collapse all of it, or expand all of it if it is already collapsed. */
function toggleFoldSelection() {
  const ns = [...S.sel].map(node).filter((n): n is MindNode => !!n && n.children.length > 0 && n !== root());
  if (ns.length <= 1) return toggleFold(ns[0]?.id ?? S.focus);
  const fold = ns.some(n => !n.collapsed);
  for (const n of ns) n.collapsed = fold;
  render();
}

function setAllFolded(folded: boolean) {
  walk(root(), (n, _p, d) => {
    if (d >= 1 && n.children.length) n.collapsed = folded;
  });
  if (folded && S.focus && (S.depth.get(S.focus) ?? 0) > 1) {
    let n = node(S.focus)!;
    while ((S.depth.get(n.id) ?? 0) > 1) n = parentOf(n.id)!;
    setSelection([n.id], false);
  }
  render();
}

function toggleTask(ids: string[]) {
  const nodes = ids.map(node).filter(Boolean) as MindNode[];
  if (!nodes.length) return;
  const add = nodes.some(n => !n.task);
  for (const n of nodes) n.task = add ? n.task ?? 'todo' : undefined;
  commit(ids);
}

function toggleTaskDone(id: string) {
  const n = node(id);
  if (!n) return;
  n.task = n.task === 'done' ? 'todo' : 'done';
  commit([id]);
}

function insertImage(id: string | null = S.focus) {
  if (!S.canSaveImages) return post({ type: 'notify', level: 'warn', message: t('saveFirst') });
  post({ type: 'pickImage', nodeId: id ?? root().id });
}

function removeImage(id: string | null) {
  const n = node(id);
  if (!n?.image) return;
  delete n.image;
  commit([n.id]);
}

function saveImageFile(file: File, nodeId: string) {
  if (!S.canSaveImages) return post({ type: 'notify', level: 'warn', message: t('saveFirst') });
  const reader = new FileReader();
  reader.onload = () => {
    const data = String(reader.result).split(',')[1] ?? '';
    post({ type: 'saveImage', nodeId, name: file.name || 'image.png', mime: file.type || 'image/png', data });
  };
  reader.readAsDataURL(file);
}

function copyMarkdown(): string {
  const img = node(S.imageSel)?.image;
  if (img) return imageToken(img);
  const ids = topLevelSelection();
  return ids.length ? nodesToMarkdown(ids.map(id => node(id)!)) : '';
}

function pasteTopics(text: string) {
  const p = node(S.focus) ?? root();
  const nodes = markdownToNodes(text, genId);
  if (!nodes.length) return;
  p.children.push(...nodes);
  p.collapsed = false;
  commit(nodes.map(n => n.id));
}

// ---------------------------------------------------------------- note panel

function openNote(id: string | null = S.focus) {
  const n = node(id);
  if (!n) return;
  if (S.editing) commitEdit();
  closeMenu();
  S.noteId = n.id;
  noteEl.innerHTML = `
    <div class="note-head"><span class="note-ico">${icons.note}</span><span class="note-title">${escapeHtml(n.text || t('note'))}</span><button class="icon-btn" data-act="close" title="${t('done')}">${icons.close}</button></div>
    <textarea class="note-text" spellcheck="false" placeholder="${escapeHtml(t('notePlaceholder'))}"></textarea>
    <div class="note-foot"><span>${escapeHtml(t('noteHint').replace('{0}', keyLabel('mod+Enter')))}</span><button class="btn primary" data-act="done">${t('done')}</button></div>`;
  const ta = noteEl.querySelector('textarea')!;
  ta.value = (n.note ?? '').replace(/^(\s*)\\([#\-*+])/gm, '$1$2').replace(/^(\s*\d+)\\([.)])/gm, '$1$2');
  noteEl.classList.add('open');
  positionNote();
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
}

function closeNote(save: boolean) {
  const id = S.noteId;
  if (!id) return;
  S.noteId = null;
  const ta = noteEl.querySelector('textarea') as HTMLTextAreaElement | null;
  noteEl.classList.remove('open');
  if (save && ta) {
    const n = node(id);
    const v = ta.value.replace(/\s+$/, '');
    const next = v.trim() ? escapeNote(v) : undefined;
    if (n && next !== n.note) {
      n.note = next;
      commit([id]);
    }
  }
  focusEditor();
}

function positionNote() {
  const b = S.noteId ? S.boxes.get(S.noteId) : undefined;
  const r = viewport.getBoundingClientRect();
  const w = noteEl.offsetWidth || 340;
  const h = noteEl.offsetHeight || 240;
  let left = r.width - w - 16 - (S.formatOpen ? FORMAT_W : 0);
  let top = 72;
  if (b) {
    const { x, y, s } = S.view;
    const right = (b.x + b.w) * s + x + 16;
    const leftSide = b.x * s + x - w - 16;
    left = right + w < visibleWidth() - 8 ? right : leftSide > 8 ? leftSide : left;
    top = Math.min(Math.max(b.y * s + y - 8, 64), r.height - h - 12);
  }
  noteEl.style.left = `${Math.max(8, left)}px`;
  noteEl.style.top = `${Math.max(8, top)}px`;
}

noteEl.addEventListener('mousedown', e => e.stopPropagation());
noteEl.addEventListener('click', e => {
  const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
  if (act === 'close' || act === 'done') closeNote(true);
});
noteEl.addEventListener('keydown', e => {
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if ((e.key === 'Enter' && mod) || e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closeNote(true);
  } else if (e.target instanceof HTMLTextAreaElement) {
    const style = styleKey(e, mod);
    if (!style) return handleEditKey(e, e.target, mod);
    e.preventDefault();
    e.stopPropagation();
    styleField(e.target, style);
  }
});

// ---------------------------------------------------------------- topic links (Cmd+K)

const linkTarget = (raw: string) => raw.replace(/^<|>$/g, '');
let linkIds: string[] = [];

function openTopicLink(n: MindNode) {
  if (n.link) post({ type: 'openLink', href: linkTarget(n.link) });
}

/** What the user typed -> link target as written in Markdown. */
function normalizeLink(v: string): string | undefined {
  let s = v.trim().replace(/^<|>$/g, '');
  if (!s) return undefined;
  const hasScheme = /^[a-z][\w+.-]*:/i.test(s);
  const isPath = /^(\.{0,2}\/|~\/|#)/.test(s) || /\.(md|markdown|txt|pdf|png|jpe?g|gif|svg|html?|docx?|xlsx?|pptx?|csv|json|ya?ml)([#?].*)?$/i.test(s);
  if (!hasScheme && !isPath && !/\s/.test(s) && /^(www\.|[\w-]+(\.[\w-]+)+)(:\d+)?([/?#]|$)/i.test(s)) s = 'https://' + s;
  return /[\s()<>]/.test(s) ? `<${s}>` : s;
}

function setLink(ids: string[], link: string | undefined) {
  let changed = false;
  for (const n of ids.map(node)) {
    if (!n || n.link === link) continue;
    n.link = link;
    n.linkTitle = undefined;
    changed = true;
  }
  if (changed) commit(ids);
}

function openLinkEditor(id?: string) {
  if (S.editing) commitEdit();
  closeMenu();
  if (S.noteId) closeNote(true);
  const ids = id && !S.sel.has(id) ? [id] : topLevelSelection();
  if (!ids.length) return;
  linkIds = ids;
  const main = node(S.focus && ids.includes(S.focus) ? S.focus : ids[0])!;
  const current = main.link ? linkTarget(main.link) : '';
  const hint = ids.length > 1 ? t('linkForN').replace('{0}', String(ids.length)) : t('linkHint');
  linkEl.innerHTML = `
    <div class="lb-row"><span class="lb-ico">${icons.link}</span><input class="lb-input" spellcheck="false" autocomplete="off" placeholder="${escapeHtml(t('linkPlaceholder'))}"></div>
    <div class="lb-foot"><span>${escapeHtml(hint)}</span><span class="lb-actions">${
      current ? `<button class="btn" data-act="open">${t('open')}</button><button class="btn" data-act="remove">${t('removeLink')}</button>` : ''
    }<button class="btn primary" data-act="apply">${t('done')}</button></span></div>`;
  const input = linkEl.querySelector('input')!;
  input.value = current;
  linkEl.classList.add('open');
  // under the topic (above it when there is no room), like a link popover in a document editor
  const b = S.boxes.get(main.id);
  const r = viewport.getBoundingClientRect();
  const w = linkEl.offsetWidth;
  const h = linkEl.offsetHeight;
  let left = 16;
  let top = 72;
  if (b) {
    const { x, y, s } = S.view;
    left = Math.min(Math.max(8, b.x * s + x), visibleWidth() - w - 8);
    top = (b.y + b.h) * s + y + 10;
    if (top + h > r.height - 8) top = b.y * s + y - h - 10;
  }
  linkEl.style.left = `${left}px`;
  linkEl.style.top = `${Math.max(8, top)}px`;
  input.focus();
  input.select();
}

function closeLinkEditor(apply: boolean) {
  if (!linkEl.classList.contains('open')) return;
  const input = linkEl.querySelector('input') as HTMLInputElement;
  linkEl.classList.remove('open');
  const ids = linkIds;
  linkIds = [];
  if (apply) setLink(ids, normalizeLink(input.value));
  focusEditor();
}

linkEl.addEventListener('mousedown', e => e.stopPropagation());
linkEl.addEventListener('click', e => {
  const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
  if (act === 'apply') closeLinkEditor(true);
  else if (act === 'open') {
    const href = (linkEl.querySelector('input') as HTMLInputElement).value.trim();
    if (href) post({ type: 'openLink', href: linkTarget(normalizeLink(href) ?? href) });
  } else if (act === 'remove') {
    (linkEl.querySelector('input') as HTMLInputElement).value = '';
    closeLinkEditor(true);
  }
});
linkEl.addEventListener('keydown', e => {
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (e.key === 'Enter' && !e.isComposing) {
    e.preventDefault();
    e.stopPropagation();
    closeLinkEditor(true);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closeLinkEditor(false);
  } else if (e.target instanceof HTMLInputElement && handleEditKey(e, e.target, mod)) {
    /* handled */
  } else if (mod && e.key.toLowerCase() === 'k') e.stopPropagation();
});

// ---------------------------------------------------------------- chrome: toolbar, zoom, format, menu

function tbButton(act: string, icon: string, label: string, tip: string) {
  return `<button class="tb-btn" data-act="${act}" title="${escapeHtml(tip)}">${icon}<span>${escapeHtml(label)}</span></button>`;
}

function buildChrome() {
  toolbar.innerHTML = [
    tbButton('topic', icons.topic, t('topic'), `${t('addTopicAfter')} (Enter)`),
    tbButton('subtopic', icons.subtopic, t('subtopic'), `${t('addSubtopic')} (Tab)`),
    '<span class="tb-sep"></span>',
    tbButton('image', icons.image, t('image'), `${t('insertImage')} (${keyLabel('mod+shift+I')})`),
    tbButton('link', icons.link, t('link'), `${t('addLink')} (${keyLabel('mod+K')})`),
    tbButton('note', icons.note, t('note'), `${t('editNote')} (F4)`),
    tbButton('task', icons.task, t('task'), t('toggleTask')),
    '<span class="tb-sep"></span>',
    tbButton('expand-all', icons.expandAll, t('expandAll'), t('expandAll')),
    tbButton('collapse-all', icons.collapseAll, t('collapseAll'), t('collapseAll')),
    '<span class="tb-sep"></span>',
    tbButton('source', icons.markdown, t('markdown'), t('openMarkdown')),
    tbButton('format', icons.format, t('format'), t('format')),
  ].join('');
  zoombar.innerHTML = `
    <button class="zb-btn" data-act="zoom-out" title="${t('zoomOut')} (${keyLabel('mod+-')})">${icons.minus}</button>
    <button id="zoom-pct" class="zb-pct" data-act="actual" title="${t('actualSize')} (${keyLabel('mod+0')})">100%</button>
    <button class="zb-btn" data-act="zoom-in" title="${t('zoomIn')} (${keyLabel('mod+=')})">${icons.plus}</button>
    <span class="tb-sep small"></span>
    <button class="zb-btn" data-act="fit" title="${t('fit')} (${keyLabel('mod+shift+0')} / ${keyLabel('shift+1')})">${icons.fit}</button>`;
  buildFormat();
  applyView();
}

function updateToolbar() {
  const n = node(S.focus);
  const isRoot = !!n && n === root();
  // Expand All / Collapse All are greyed out when they would change nothing
  let anyCollapsed = false;
  let anyExpanded = false;
  if (S.doc)
    walk(root(), (x, _p, d) => {
      if (d >= 1 && x.children.length) x.collapsed ? (anyCollapsed = true) : (anyExpanded = true);
    });
  toolbar.querySelectorAll<HTMLButtonElement>('.tb-btn').forEach(b => {
    const act = b.dataset.act;
    if (act === 'expand-all') b.disabled = !anyCollapsed;
    if (act === 'collapse-all') b.disabled = !anyExpanded;
    if (act === 'format') b.classList.toggle('on', S.formatOpen);
    if (act === 'topic') b.disabled = !n;
    if (act === 'note') b.classList.toggle('on', !!n?.note);
    if (act === 'task') b.classList.toggle('on', !!n?.task);
    if (act === 'image') b.classList.toggle('on', !!n?.image);
    if (act === 'link') b.classList.toggle('on', !!n?.link);
    if (act === 'topic') b.title = `${isRoot ? t('addSubtopic') : t('addTopicAfter')} (Enter)`;
  });
}

function toolbarAction(act: string) {
  const id = S.focus;
  switch (act) {
    case 'topic':
      return addSibling(id, true);
    case 'subtopic':
      return addChild(id);
    case 'image':
      return insertImage(id);
    case 'link':
      return openLinkEditor();
    case 'note':
      return S.noteId ? closeNote(true) : openNote(id);
    case 'task':
      return toggleTask(topLevelSelection());
    case 'expand-all':
      return setAllFolded(false);
    case 'collapse-all':
      return setAllFolded(true);
    case 'source':
      return post({ type: 'openSource' });
    case 'format':
      return toggleFormat();
    case 'zoom-in':
      return zoomBy(1.2);
    case 'zoom-out':
      return zoomBy(1 / 1.2);
    case 'actual':
      return actualSize();
    case 'fit':
      return fitView();
  }
}

for (const bar of [toolbar, zoombar]) {
  bar.addEventListener('mousedown', e => {
    e.preventDefault();
    e.stopPropagation();
    if (S.editing) commitEdit();
  });
  bar.addEventListener('click', e => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act) toolbarAction(act);
    focusEditor();
  });
}

function toggleFormat(open = !S.formatOpen) {
  S.formatOpen = open;
  app.classList.toggle('format-open', open);
  buildFormat();
  updateToolbar();
  saveState();
}

function themePreview(th: Theme): string {
  const bars = [0, 1, 2]
    .map(i => {
      const c = th.palette[i % th.palette.length];
      const style =
        th.main === 'filled'
          ? `background:${c}`
          : th.main === 'outline'
            ? `background:${th.surface};border:1.5px solid ${c}`
            : th.main === 'tint'
              ? `background:${withAlpha(c, 0.16)}`
              : `border-bottom:2px solid ${c};border-radius:0`;
      const line = th.line ?? c;
      return `<i class="tp-line" style="background:${line};top:${10 + i * 12}px"></i><i class="tp-main" style="${style};top:${6 + i * 12}px"></i>`;
    })
    .join('');
  return `<span class="tp" style="background:${th.bg}">${bars}<i class="tp-root" style="background:${th.rootBg};${th.rootBorder ? `border:1.5px solid ${th.rootBorder}` : ''}"></i></span>`;
}

function buildFormat() {
  const st = settings();
  const s = S.doc?.settings ?? {};
  const autoTheme = resolveTheme('auto', vsDark());
  formatEl.innerHTML = `
  <div class="fp-head"><span>${t('format')}</span><button class="icon-btn" data-act="close">${icons.close}</button></div>
  <section><h4>${t('structure')}</h4><div class="fp-grid">
    ${LAYOUTS.map(l => `<button class="fp-card${st.layout === l ? ' on' : ''}" data-layout="${l}" title="${t('layout_' + l)}">${layoutIcons[l]}<span>${t('layout_' + l)}</span></button>`).join('')}
  </div></section>
  <section><h4>${t('theme')}</h4><div class="fp-grid themes">
    ${[{ id: 'auto', th: autoTheme }, ...THEMES.map(th => ({ id: th.id, th }))]
      .map(({ id, th }) => `<button class="fp-card theme${st.themeId === id ? ' on' : ''}" data-theme="${id}">${themePreview(th)}<span>${t('theme_' + id)}</span></button>`)
      .join('')}
  </div></section>
  <section><h4>${t('branch')}</h4><div class="seg">
    ${LINE_STYLES.map(l => `<button class="${st.lineStyle === l ? 'on' : ''}" data-line="${l}">${t('line_' + l)}</button>`).join('')}
  </div></section>
  <p class="fp-foot">${t('savedIn')}${s.layout || s.theme || s.lineStyle ? ` <a data-act="reset">${t('reset')}</a>` : ''}</p>`;
}

formatEl.addEventListener('mousedown', e => {
  e.stopPropagation();
  if (S.editing) commitEdit();
});
formatEl.addEventListener('click', e => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('button, a');
  if (!el || !S.doc) return;
  const d = el.dataset;
  if (d.act === 'close') return toggleFormat(false);
  if (d.act === 'reset') S.doc.settings = {};
  else if (d.layout) S.doc.settings.layout = d.layout as Layout;
  else if (d.theme) S.doc.settings.theme = d.theme;
  else if (d.line) S.doc.settings.lineStyle = d.line as LineStyle;
  else return;
  commit();
  buildFormat();
  if (d.layout || d.act === 'reset') fitView(1);
  focusEditor();
});

type MenuItem = { label: string; key?: string; run: () => void; disabled?: boolean } | '-';

function showMenu(x: number, y: number, items: MenuItem[]) {
  menuEl.innerHTML = items
    .map((it, i) =>
      it === '-'
        ? '<div class="ms"></div>'
        : `<div class="mi${it.disabled ? ' disabled' : ''}" data-i="${i}"><span>${escapeHtml(it.label)}</span>${it.key ? `<span class="k">${escapeHtml(it.key)}</span>` : ''}</div>`,
    )
    .join('');
  menuEl.classList.add('open');
  const r = viewport.getBoundingClientRect();
  const w = menuEl.offsetWidth;
  const h = menuEl.offsetHeight;
  menuEl.style.left = `${Math.min(x, r.width - w - 8)}px`;
  menuEl.style.top = `${Math.min(y, r.height - h - 8)}px`;
  menuItems = items;
}
let menuItems: MenuItem[] = [];

function closeMenu() {
  menuEl.classList.remove('open');
}

menuEl.addEventListener('mousedown', e => {
  e.preventDefault();
  e.stopPropagation();
});
menuEl.addEventListener('click', e => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('.mi');
  if (!el || el.classList.contains('disabled')) return;
  const it = menuItems[+el.dataset.i!];
  closeMenu();
  if (it && it !== '-') it.run();
  focusEditor();
});

function topicMenu(id: string): MenuItem[] {
  const n = node(id)!;
  const isRoot = n === root();
  return [
    { label: t('addSubtopic'), key: 'Tab', run: () => addChild(id) },
    { label: t('addTopicAfter'), key: 'Enter', run: () => addSibling(id, true), disabled: isRoot },
    { label: t('addTopicBefore'), key: keyLabel('shift+Enter'), run: () => addSibling(id, false), disabled: isRoot },
    { label: t('addParent'), key: `${keyLabel('mod+Enter')}`, run: () => addParent(id), disabled: isRoot },
    '-',
    { label: t('editText'), key: 'F2', run: () => beginEdit(id, 'select') },
    { label: t('insertImage'), key: `${keyLabel('mod+shift+I')}`, run: () => insertImage(id) },
    ...(n.image ? [{ label: t('removeImage'), run: () => removeImage(id) }] : []),
    { label: t('editNote'), key: 'F4', run: () => openNote(id) },
    { label: n.link ? t('editLink') : t('addLink'), key: `${keyLabel('mod+K')}`, run: () => openLinkEditor(id) },
    ...(n.link
      ? [
          { label: t('openLink'), run: () => openTopicLink(n) },
          { label: t('removeLink'), run: () => setLink([id], undefined) },
        ]
      : []),
    { label: t('toggleTask'), run: () => toggleTask(topLevelSelection()) },
    ...(n.width ? [{ label: t('resetWidth'), run: () => resetWidth(id) }] : []),
    '-',
    ...sideMenu(n),
    ...(n.children.length && !isRoot ? [{ label: n.collapsed ? t('expand') : t('collapse'), key: `${keyLabel('mod+/')}`, run: () => toggleFold(id) }] : []),
    { label: t('copyMd'), key: `${keyLabel('mod+C')}`, run: () => writeClipboard(copyMarkdown()) },
    { label: t('reveal'), run: () => (n.line !== undefined ? post({ type: 'openSource' }) : undefined) },
    '-',
    { label: t('delete'), key: isMac ? '⌫' : 'Delete', run: deleteSelection, disabled: isRoot && S.sel.size <= 1 },
  ];
}

/** Right-click on a topic that is part of a multi-selection. */
function multiMenu(): MenuItem[] {
  const ids = topLevelSelection().filter(id => id !== root().id);
  const foldable = [...S.sel].some(id => (node(id)?.children.length ?? 0) > 0 && id !== root().id);
  return [
    { label: t('copyMd'), key: `${keyLabel('mod+C')}`, run: () => writeClipboard(copyMarkdown()) },
    {
      label: t('cut'),
      key: `${keyLabel('mod+X')}`,
      run: () => {
        writeClipboard(copyMarkdown());
        deleteSelection();
      },
      disabled: !ids.length,
    },
    '-',
    { label: t('addLink'), key: `${keyLabel('mod+K')}`, run: () => openLinkEditor() },
    { label: t('toggleTask'), run: () => toggleTask(topLevelSelection()) },
    ...(foldable ? [{ label: t('foldToggle'), key: `${keyLabel('mod+/')}`, run: toggleFoldSelection }] : []),
    ...(S.focus ? sideMenu(node(S.focus)!) : []),
    '-',
    { label: t('deleteN').replace('{0}', String(ids.length)), key: isMac ? '⌫' : 'Delete', run: deleteSelection, disabled: !ids.length },
  ];
}

function sideMenu(n: MindNode): MenuItem[] {
  if (settings().layout !== 'map') return [];
  if (n === root()) {
    return root().children.length > 1
      ? [
          { label: t('balance'), run: () => balanceSides() },
          { label: t('allRight'), run: () => balanceSides(true), disabled: !root().children.some(c => c.side === 'left') },
        ]
      : [];
  }
  if (parentOf(n.id) !== root()) return [];
  const ids = topLevelSelection().filter(id => parentOf(id) === root());
  return n.side === 'left' ? [{ label: t('moveRight'), run: () => setSide(ids, false) }] : [{ label: t('moveLeft'), run: () => setSide(ids, true) }];
}

function imageMenu(id: string): MenuItem[] {
  const img = node(id)?.image;
  if (!img) return topicMenu(id);
  return [
    { label: t('openImage'), run: () => post({ type: 'openImage', src: img.src }) },
    { label: t('copyImage'), key: `${keyLabel('mod+C')}`, run: () => writeClipboard(imageToken(img)) },
    { label: t('replaceImage'), run: () => insertImage(id) },
    ...(img.width
      ? [
          {
            label: t('resetImageSize'),
            run: () => {
              delete node(id)!.image!.width;
              commit([id]);
              selectImage(id);
            },
          },
        ]
      : []),
    '-',
    { label: t('removeImage'), key: isMac ? '⌫' : 'Delete', run: () => removeImage(id) },
  ];
}

function canvasMenu(): MenuItem[] {
  return [
    { label: t('expandAll'), run: () => setAllFolded(false) },
    { label: t('collapseAll'), run: () => setAllFolded(true) },
    ...sideMenu(root()),
    '-',
    { label: t('fit'), key: `${keyLabel('mod+shift+0')} / ${keyLabel('shift+1')}`, run: () => fitView() },
    { label: t('actualSize'), key: `${keyLabel('mod+0')}`, run: actualSize },
    '-',
    { label: t('format'), run: () => toggleFormat() },
    { label: t('openMarkdown'), run: () => post({ type: 'openSource' }) },
    { label: t('cleanupImages'), run: () => post({ type: 'cleanupImages' }) },
  ];
}

function writeClipboard(text: string) {
  if (!text) return;
  navigator.clipboard?.writeText(text).catch(() => {
    pendingCopy = text;
    document.execCommand('copy');
  });
}
let pendingCopy: string | null = null;

// ---------------------------------------------------------------- keyboard

function navigate(key: string) {
  const cur = S.focus ? S.boxes.get(S.focus) : undefined;
  if (!cur) return select(root().id);
  const vertical = settings().layout === 'down';
  const toward = (b: Box) => (vertical ? 'ArrowDown' : b.side < 0 ? 'ArrowLeft' : 'ArrowRight');
  const back = (b: Box) => (vertical ? 'ArrowUp' : b.side < 0 ? 'ArrowRight' : 'ArrowLeft');
  const cy = (b: Box) => b.y + b.h / 2;
  const cx = (b: Box) => b.x + b.w / 2;
  const nearest = (list: Box[]) => {
    const axis = vertical ? cx : cy;
    return list.reduce((a, b) => (Math.abs(axis(b) - axis(cur)) < Math.abs(axis(a) - axis(cur)) ? b : a));
  };
  let target: Box | undefined;
  if (cur.depth === 0 && !vertical) {
    const kids = cur.children.filter(c => (key === 'ArrowRight' ? c.side > 0 : key === 'ArrowLeft' ? c.side < 0 : false));
    if (kids.length) target = nearest(kids);
  } else if (key === toward(cur)) {
    if (cur.children.length) target = nearest(cur.children);
    else if (cur.node.collapsed) {
      toggleFold(cur.node.id);
      return;
    }
  } else if (key === back(cur)) target = cur.parent ?? undefined;
  if (!target) {
    // spatial search in the pressed direction
    let best = Infinity;
    for (const b of S.boxes.values()) {
      if (b === cur) continue;
      const dx = cx(b) - cx(cur);
      const dy = cy(b) - cy(cur);
      const [main, cross] = key === 'ArrowUp' ? [-dy, dx] : key === 'ArrowDown' ? [dy, dx] : key === 'ArrowLeft' ? [-dx, dy] : [dx, dy];
      if (main <= 1) continue;
      const score = main + Math.abs(cross) * 2.5;
      if (score < best) {
        best = score;
        target = b;
      }
    }
  }
  if (target) select(target.node.id);
}

function stop(e: Event) {
  e.preventDefault();
  e.stopPropagation();
}

editor.addEventListener('keydown', e => {
  const mod = isMac ? e.metaKey : e.ctrlKey;
  const k = e.key;
  if (gesture?.kind === 'drag' && gesture.active) {
    if (k === 'Escape') {
      const g = gesture;
      gesture = null;
      endDrag(g, false);
    }
    return stop(e);
  }
  if (gesture?.kind === 'marquee') {
    if (k === 'Escape') {
      const g = gesture;
      gesture = null;
      endMarquee(g, true);
    }
    return stop(e);
  }
  if (S.editing) {
    if (e.isComposing || e.keyCode === 229) return;
    if (k === 'Enter' && (e.shiftKey || e.altKey)) {
      stop(e);
      recordChange(editor, 'other');
      editor.setRangeText('\n', editor.selectionStart, editor.selectionEnd, 'end');
      editor.dispatchEvent(new Event('input'));
    } else if (k === 'Enter') {
      stop(e);
      commitEdit();
    } else if (k === 'Escape') {
      stop(e);
      cancelEdit();
    } else if (k === 'Tab') {
      stop(e);
      const id = S.editing.id;
      commitEdit();
      addChild(id);
    } else if (mod && k.toLowerCase() === 'k') {
      stop(e);
      const id = S.editing.id;
      commitEdit();
      openLinkEditor(id);
    } else if (styleKey(e, mod)) {
      stop(e);
      styleField(editor, styleKey(e, mod)!);
    } else handleEditKey(e, editor, mod);
    return;
  }
  if (e.isComposing || e.keyCode === 229 || !S.doc) return;
  const id = S.focus;
  // Space: hold and drag to pan (like Figma); a plain press edits the topic (on key up)
  if (k === ' ' && !mod) {
    if (!e.repeat && !space.held) {
      space.held = true;
      space.used = false;
      viewport.classList.add('space-pan');
    }
    return stop(e);
  }
  let handled = true;
  if ((k === 'Tab' && !e.shiftKey) || k === 'Insert') addChild(id);
  else if (k === 'Tab' && e.shiftKey) id && parentOf(id) ? select(parentOf(id)!.id) : null;
  else if (k === 'Enter' && mod) addParent(id);
  else if (k === 'Enter' && e.shiftKey) addSibling(id, false);
  else if (k === 'Enter') addSibling(id, true);
  else if ((k === 'Delete' || k === 'Backspace') && S.imageSel) removeImage(S.imageSel);
  else if (k === 'Delete' || k === 'Backspace') deleteSelection();
  else if (k === 'F2') id && beginEdit(id, 'select');
  else if (mod && k.toLowerCase() === 'k') openLinkEditor();
  else if (k.startsWith('Arrow') && (e.altKey || (mod && e.shiftKey)) && (k === 'ArrowUp' || k === 'ArrowDown')) moveSibling(id, k === 'ArrowUp' ? -1 : 1);
  else if (k.startsWith('Arrow') && !mod) navigate(k);
  else if (mod && k === '/') toggleFoldSelection();
  else if (styleKey(e, mod)) styleTopics(styleKey(e, mod)!);
  else if (mod && (k === '=' || k === '+')) zoomBy(1.2);
  else if (mod && k === '-') zoomBy(1 / 1.2);
  else if (mod && (k === '0' || k === ')') && e.shiftKey) fitView();
  else if (e.shiftKey && !mod && !e.altKey && e.code === 'Digit1') fitView();
  else if (mod && k === '0') actualSize();
  else if (mod && e.shiftKey && k.toLowerCase() === 'i') insertImage(id);
  else if (k === 'F4' || (mod && e.shiftKey && k.toLowerCase() === 'n')) openNote(id);
  else if (mod && !e.shiftKey && k.toLowerCase() === 'a') {
    setSelection([...S.boxes.keys()], false);
    refreshSelection();
  } else if (k === 'Escape') {
    closeMenu();
    if (S.imageSel) {
      S.imageSel = null;
      refreshSelection();
    } else if (S.sel.size > 1 && id) select(id, false);
  } else if (k === 'Home') {
    select(root().id);
  } else handled = false;
  if (handled) stop(e);
});

const space = { held: false, used: false };
editor.addEventListener('keyup', e => {
  if (e.key !== ' ' || !space.held) return;
  space.held = false;
  viewport.classList.remove('space-pan');
  if (!space.used && !S.editing && S.focus) beginEdit(S.focus, 'select');
});
window.addEventListener('blur', () => {
  space.held = false;
  viewport.classList.remove('space-pan');
});

// ---------------------------------------------------------------- clipboard

const typingElsewhere = () => {
  const a = document.activeElement;
  return !!a && a !== editor && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT');
};

document.addEventListener('copy', e => {
  if (pendingCopy !== null) {
    e.clipboardData?.setData('text/plain', pendingCopy);
    pendingCopy = null;
    return e.preventDefault();
  }
  if (S.editing || typingElsewhere()) return;
  const md = copyMarkdown();
  if (!md) return;
  e.clipboardData?.setData('text/plain', md);
  e.preventDefault();
});

document.addEventListener('cut', e => {
  if (S.editing || typingElsewhere()) return;
  if (S.imageSel) {
    e.clipboardData?.setData('text/plain', copyMarkdown());
    e.preventDefault();
    return removeImage(S.imageSel);
  }
  const md = copyMarkdown();
  if (!md) return;
  e.clipboardData?.setData('text/plain', md);
  e.preventDefault();
  deleteSelection();
});

document.addEventListener('paste', e => {
  if (typingElsewhere() || !S.doc) return;
  const dt = e.clipboardData;
  if (!dt) return;
  const file = [...dt.files].find(f => f.type.startsWith('image/'));
  if (file) {
    e.preventDefault();
    const id = S.editing?.id ?? S.focus ?? root().id;
    if (S.editing) commitEdit();
    saveImageFile(file, id);
    return;
  }
  if (S.editing) return;
  const text = dt.getData('text/plain');
  if (!text.trim()) return;
  e.preventDefault();
  pasteTopics(text);
});

// ---------------------------------------------------------------- mouse

type Gesture =
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number; moved: boolean; menuAt?: { x: number; y: number; target: HTMLElement } }
  | MarqueeGesture
  | DragGesture
  | { kind: 'resize'; id: string; sx: number; w0: number; w: number; img: HTMLImageElement }
  | WidthGesture;
/** Dragging a topic's outer edge. */
interface WidthGesture {
  kind: 'width';
  id: string;
  sx: number;
  w0: number;
  /** Width before the drag (undefined: fits the text). */
  before: number | undefined;
  /** +1 for the right edge, -1 for the left edge (topics left of the center). */
  dir: 1 | -1;
  /** 2 for centered topics, whose edge moves by half the width change. */
  gain: number;
  moved: boolean;
}
interface DragGesture {
  kind: 'drag';
  id: string;
  ids: string[];
  sx: number;
  sy: number;
  /** Latest pointer position. */
  cx: number;
  cy: number;
  active: boolean;
  additive: boolean;
  ghost?: HTMLElement;
  target?: DropTarget | null;
  raf?: number;
}
interface MarqueeGesture {
  kind: 'marquee';
  /** Start point in canvas coordinates (stays put while the view scrolls). */
  start: { x: number; y: number };
  cx: number;
  cy: number;
  sx: number;
  sy: number;
  /** Selection before the gesture: restored on Esc, kept when adding with Shift / Cmd. */
  before: string[];
  additive: boolean;
  moved: boolean;
  raf?: number;
}
let gesture: Gesture | null = null;
/**
 * Time of the last right-button press / release. The browser's own contextmenu event comes on press (Mac)
 * or after release (Windows); either way our menu is opened on mouse up, so that event is ignored.
 */
let rightButtonAt = 0;

viewport.addEventListener('mousedown', e => {
  if (e.target === editor && S.editing) return;
  closeMenu();
  if (S.noteId) closeNote(true);
  closeLinkEditor(false);
  const target = e.target as HTMLElement;
  const startPan = (menuAt?: { x: number; y: number; target: HTMLElement }) => {
    e.preventDefault();
    if (S.editing) commitEdit();
    focusEditor();
    gesture = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: S.view.x, vy: S.view.y, moved: false, menuAt };
  };
  // right button (or Ctrl+click on a Mac): drag pans like XMind, a click opens the menu on mouse up
  if (e.button === 2 || (isMac && e.button === 0 && e.ctrlKey)) {
    rightButtonAt = performance.now();
    return startPan({ x: e.clientX, y: e.clientY, target });
  }
  // middle button, Space + drag (Figma) and Alt + drag on empty space pan
  if (e.button === 1 || (e.button === 0 && space.held) || (e.button === 0 && e.altKey && !target.closest('.topic'))) {
    if (space.held) space.used = true;
    return startPan();
  }
  if (e.button !== 0) return;
  e.preventDefault();
  if (S.editing) commitEdit();
  focusEditor();
  const fold = target.closest<HTMLElement>('.fold');
  if (fold) return toggleFold(fold.dataset.id!);
  const topic = target.closest<HTMLElement>('.topic');
  if (!topic) {
    // empty space: draw a selection box (Shift / Cmd adds to the selection)
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    gesture = { kind: 'marquee', start: toCanvas(e.clientX, e.clientY), sx: e.clientX, sy: e.clientY, cx: e.clientX, cy: e.clientY, before: [...S.sel], additive, moved: false };
    return;
  }
  const id = topic.dataset.id!;
  const act = target.closest<HTMLElement>('[data-act]')?.dataset.act;
  if (act === 'task') return toggleTaskDone(id);
  if (act === 'link') return openTopicLink(node(id)!);
  if (act === 'note') {
    select(id);
    return openNote(id);
  }
  if (act === 'width') {
    const n = node(id)!;
    const centered = topic.classList.contains('d0') || settings().layout === 'down';
    gesture = { kind: 'width', id, sx: e.clientX, w0: topic.offsetWidth, before: n.width, dir: topic.classList.contains('left') ? -1 : 1, gain: centered ? 2 : 1, moved: false };
    topic.classList.add('resizing');
    app.classList.add('resizing-w');
    return;
  }
  if (act === 'resize') {
    const img = topic.querySelector('.t-img') as HTMLImageElement;
    const w0 = img.getBoundingClientRect().width / S.view.s;
    gesture = { kind: 'resize', id, sx: e.clientX, w0, w: w0, img };
    return;
  }
  const link = target.closest<HTMLElement>('a[data-href]');
  if (link && (e.metaKey || e.ctrlKey)) return post({ type: 'openLink', href: link.dataset.href! });
  const additive = e.shiftKey || e.metaKey || e.ctrlKey;
  if (additive) {
    const next = new Set(S.sel);
    if (next.has(id) && next.size > 1) next.delete(id);
    else next.add(id);
    setSelection([...[...next].filter(x => x !== id), ...(next.has(id) ? [id] : [])], false);
    refreshSelection();
  } else if (target.closest('.t-img')) selectImage(id);
  else if (!S.sel.has(id) || S.imageSel) select(id);
  else {
    S.focus = id;
    refreshSelection();
  }
  gesture = { kind: 'drag', id, ids: S.sel.has(id) ? [...S.sel] : [id], sx: e.clientX, sy: e.clientY, cx: e.clientX, cy: e.clientY, active: false, additive };
});

window.addEventListener('mousemove', e => {
  const g = gesture;
  if (!g) return;
  if (g.kind === 'pan') {
    const dx = e.clientX - g.sx;
    const dy = e.clientY - g.sy;
    if (!g.moved && Math.abs(dx) + Math.abs(dy) > 3) {
      g.moved = true;
      viewport.classList.add('panning');
    }
    if (!g.moved) return;
    S.view.x = g.vx + dx;
    S.view.y = g.vy + dy;
    applyView();
  } else if (g.kind === 'marquee') {
    g.cx = e.clientX;
    g.cy = e.clientY;
    if (!g.moved && Math.hypot(g.cx - g.sx, g.cy - g.sy) < 4) return;
    g.moved = true;
    updateMarquee(g);
    edgePan(g, () => updateMarquee(g));
  } else if (g.kind === 'width') {
    const n = node(g.id);
    const dx = e.clientX - g.sx;
    if (!n || (!g.moved && Math.abs(dx) < 3)) return;
    g.moved = true;
    n.width = Math.min(TOPIC_WIDTH_MAX, Math.max(TOPIC_WIDTH_MIN, Math.round(g.w0 + (g.dir * g.gain * dx) / S.view.s)));
    scheduleRender();
  } else if (g.kind === 'resize') {
    g.w = Math.max(24, Math.round(g.w0 + (e.clientX - g.sx) / S.view.s));
    g.img.style.width = `${g.w}px`;
    g.img.classList.add('sized');
    scheduleRender();
  } else if (g.kind === 'drag') {
    g.cx = e.clientX;
    g.cy = e.clientY;
    if (!g.active) {
      if (Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < 5 || g.id === root().id) return;
      g.active = true;
      const src = topicEls.get(g.id)!;
      const ghost = src.cloneNode(true) as HTMLElement;
      ghost.classList.add('ghost');
      ghost.classList.remove('sel', 'focus', 'drop-target');
      ghost.style.transform = `scale(${S.view.s})`;
      app.appendChild(ghost);
      g.ghost = ghost;
      const count = topLevelSelection(g.ids).filter(id => id !== root().id).length;
      if (count > 1) {
        const badge = document.createElement('span');
        badge.className = 'ghost-count';
        badge.textContent = String(count);
        ghost.appendChild(badge);
      }
      for (const id of g.ids) topicEls.get(id)?.classList.add('dragging');
      app.classList.add('dragging');
    }
    updateDrag(g);
    edgePan(g, () => updateDrag(g));
  }
});

window.addEventListener('mouseup', e => {
  const g = gesture;
  gesture = null;
  viewport.classList.remove('panning');
  if (!g) return;
  if (g.kind === 'pan') {
    if (g.menuAt) rightButtonAt = performance.now();
    if (g.menuAt && !g.moved) openContextMenu(g.menuAt.x, g.menuAt.y, g.menuAt.target);
  } else if (g.kind === 'marquee') {
    endMarquee(g, false);
  } else if (g.kind === 'width') {
    topicEls.get(g.id)?.classList.remove('resizing');
    app.classList.remove('resizing-w');
    const n = node(g.id);
    if (n && n.width !== g.before) commit([n.id]);
  } else if (g.kind === 'resize') {
    const n = node(g.id);
    if (n?.image && g.w !== g.w0) {
      n.image.width = g.w;
      commit([n.id]);
      selectImage(n.id);
    }
  } else if (g.kind === 'drag') {
    if (!g.active) {
      if (!g.additive && S.sel.size > 1) select(g.id);
      return;
    }
    endDrag(g, true);
  }
});

// ---------------------------------------------------------------- drag & drop of topics
//
// Near a topic, four arrows show where the dragged topic can go:
//   above / below      -> sibling before / after (left / right in the org chart)
//   outward side       -> subtopic (dropping onto the topic itself does the same)
//   inward side        -> new parent: the dragged topic takes the target's place
// The nearest arrow wins, so the choice never depends on hitting a few pixels.

const ARROWS: Record<Dir, { glyph: string; path: string }> = {
  up: { glyph: '↑', path: 'M0,5V-5M-4.5,-0.5L0,-5L4.5,-0.5' },
  down: { glyph: '↓', path: 'M0,-5V5M-4.5,0.5L0,5L4.5,0.5' },
  left: { glyph: '←', path: 'M5,0H-5M-0.5,-4.5L-5,0L-0.5,4.5' },
  right: { glyph: '→', path: 'M-5,0H5M0.5,-4.5L5,0L0.5,4.5' },
};

function dropOptions(b: Box, multi: boolean): Partial<Record<Dir, DropOption>> {
  const layout = settings().layout;
  const o: Partial<Record<Dir, DropOption>> = {};
  if (layout === 'down') {
    o.down = { pos: 'child' };
    if (b.depth === 0) return o;
    o.left = { pos: 'before' };
    o.right = { pos: 'after' };
    if (!multi) o.up = { pos: 'parent' };
    return o;
  }
  if (b.depth === 0) {
    if (layout !== 'left') o.right = { pos: 'child', side: 1 };
    if (layout !== 'right') o.left = { pos: 'child', side: -1 };
    return o;
  }
  o.up = { pos: 'before' };
  o.down = { pos: 'after' };
  o[b.side < 0 ? 'left' : 'right'] = { pos: 'child' };
  if (!multi) o[b.side < 0 ? 'right' : 'left'] = { pos: 'parent' };
  return o;
}

/**
 * How far each arrow sits from the topic: 20px on screen, but never past the middle of the gap
 * to the next topic, so an arrow is always closer to its own topic than to a neighbour.
 */
function padOffsets(b: Box, excluded: (id: string) => boolean): Record<Dir, number> {
  const s = S.view.s;
  const band = 24 / s;
  const gap = { up: Infinity, down: Infinity, left: Infinity, right: Infinity };
  for (const o of S.boxes.values()) {
    if (o === b || excluded(o.node.id)) continue;
    const xBand = o.x < b.x + b.w + band && o.x + o.w > b.x - band;
    const yBand = o.y < b.y + b.h + band && o.y + o.h > b.y - band;
    if (xBand && o.y + o.h <= b.y) gap.up = Math.min(gap.up, b.y - (o.y + o.h));
    if (xBand && o.y >= b.y + b.h) gap.down = Math.min(gap.down, o.y - (b.y + b.h));
    if (yBand && o.x + o.w <= b.x) gap.left = Math.min(gap.left, b.x - (o.x + o.w));
    if (yBand && o.x >= b.x + b.w) gap.right = Math.min(gap.right, o.x - (b.x + b.w));
  }
  const f = (g: number) => Math.max(6 / s, Math.min(20 / s, g / 2 - 3 / s));
  return { up: f(gap.up), down: f(gap.down), left: f(gap.left), right: f(gap.right) };
}

function padPoint(b: Box, dir: Dir, offs: Record<Dir, number>) {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  if (dir === 'up') return { x: cx, y: b.y - offs.up };
  if (dir === 'down') return { x: cx, y: b.y + b.h + offs.down };
  if (dir === 'left') return { x: b.x - offs.left, y: cy };
  return { x: b.x + b.w + offs.right, y: cy };
}

function rectDistance(b: Box, p: { x: number; y: number }) {
  return Math.hypot(Math.max(b.x - p.x, 0, p.x - (b.x + b.w)), Math.max(b.y - p.y, 0, p.y - (b.y + b.h)));
}

function findDropTarget(clientX: number, clientY: number, dragged: string[], current?: DropTarget | null): DropTarget | null {
  const p = toCanvas(clientX, clientY);
  const s = S.view.s;
  const excluded = (id: string) => dragged.some(d => d === id || isAncestor(d, id));
  const multi = topLevelSelection(dragged).filter(id => id !== root().id).length > 1;
  // nearest topic (the one under the pointer always wins; ties go to the closer centre)
  let best: Box | undefined;
  let bestD = 48 / s;
  for (const b of S.boxes.values()) {
    if (excluded(b.node.id)) continue;
    const d = rectDistance(b, p) + 0.001 * Math.hypot(b.x + b.w / 2 - p.x, b.y + b.h / 2 - p.y);
    if (d <= bestD) {
      bestD = d;
      best = b;
    }
  }
  if (!best) return null;
  // keep the current topic while the pointer is still about as close to it (no flicker at borders)
  const cur = current ? S.boxes.get(current.id) : undefined;
  if (cur && cur !== best && rectDistance(best, p) > 0 && rectDistance(cur, p) <= rectDistance(best, p) + 8 / s) best = cur;

  const opts = dropOptions(best, multi);
  const dirs = (Object.keys(opts) as Dir[]).filter(d => opts[d]);
  if (!dirs.length) return null;
  const offs = padOffsets(best, excluded);
  let dir = dirs[0];
  let dmin = Infinity;
  for (const d of dirs) {
    const q = padPoint(best, d, offs);
    const dd = Math.hypot(q.x - p.x, q.y - p.y);
    if (dd < dmin) {
      dmin = dd;
      dir = d;
    }
  }
  // The topic itself counts as its "subtopic" arrow.
  const cx = best.x + best.w / 2;
  const childDirs = dirs.filter(d => opts[d]!.pos === 'child');
  if (childDirs.length && Math.hypot(cx - p.x, best.y + best.h / 2 - p.y) < dmin) {
    dir = childDirs.length > 1 ? (p.x >= cx ? 'right' : 'left') : childDirs[0];
  }
  return { id: best.node.id, dir, dirs, offs, ...opts[dir]! };
}

function previewSvg(b: Box, tg: DropTarget, pw: number, ph: number): string {
  const vertical = settings().layout === 'down';
  const s = S.view.s;
  const stroke = `stroke="var(--sel)" stroke-width="${2 / s}" stroke-dasharray="${5 / s} ${4 / s}"`;
  const box = (x: number, y: number, w = pw) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${ph}" rx="6" fill="var(--bg)" fill-opacity=".92"/>` +
    `<rect x="${x}" y="${y}" width="${w}" height="${ph}" rx="6" fill="var(--sel-soft)" fill-opacity=".45" ${stroke}/>`;
  const link = (a: { x: number; y: number }, c: { x: number; y: number }) => {
    const m = vertical ? `C${a.x},${(a.y + c.y) / 2} ${c.x},${(a.y + c.y) / 2}` : `C${(a.x + c.x) / 2},${a.y} ${(a.x + c.x) / 2},${c.y}`;
    return `<path d="M${a.x},${a.y}${m} ${c.x},${c.y}" fill="none" ${stroke}/>`;
  };
  const bar = (x: number, y: number, w: number, h: number) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${2 / s}" fill="var(--sel)"/>`;
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const t4 = 4 / s;

  if (tg.pos === 'before' || tg.pos === 'after') {
    const first = tg.dir === 'up' || tg.dir === 'left';
    return vertical
      ? bar(first ? b.x - 8 - t4 / 2 : b.x + b.w + 8 - t4 / 2, b.y, t4, b.h)
      : bar(b.x, first ? b.y - 6 - t4 / 2 : b.y + b.h + 6 - t4 / 2, b.w, t4);
  }

  if (tg.pos === 'parent') {
    const w = Math.min(pw, 96);
    if (vertical) {
      const x = cx - w / 2;
      const y = b.y - 18 - ph;
      return link({ x: cx, y: y + ph }, { x: cx, y: b.y }) + box(x, y, w);
    }
    const right = b.side >= 0;
    const x = right ? b.x - 18 - w : b.x + b.w + 18;
    const y = cy - ph / 2;
    return link({ x: right ? x + w : x, y: cy }, { x: right ? b.x : b.x + b.w, y: cy }) + box(x, y, w);
  }

  // subtopic: show the placeholder where it will be appended
  if (vertical) {
    const last = b.children[b.children.length - 1];
    const x = last ? last.x + last.w + 16 : cx - pw / 2;
    const y = last ? last.y : b.y + b.h + 40;
    return link({ x: cx, y: b.y + b.h }, { x: x + pw / 2, y }) + box(x, y);
  }
  const side = tg.side ?? (b.side < 0 ? -1 : 1);
  const kids = b.children.filter(c => b.depth !== 0 || c.side === side);
  let x: number;
  let y: number;
  if (!kids.length) {
    x = side > 0 ? b.x + b.w + 40 : b.x - 40 - pw;
    y = cy - ph / 2;
  } else {
    const last = kids.reduce((a, c) => (c.y + c.h > a.y + a.h ? c : a));
    x = side > 0 ? last.x : last.x + last.w - pw;
    y = last.y + last.h + 10;
  }
  const from = { x: b.depth === 0 ? cx + (side * b.w) / 2 : side > 0 ? b.x + b.w : b.x, y: cy };
  return link(from, { x: side > 0 ? x : x + pw, y: y + ph / 2 }) + box(x, y);
}

function drawDropIndicator(g: DragGesture) {
  const tg = g.target;
  for (const [id, el] of topicEls) el.classList.toggle('drop-target', !!tg && tg.id === id);
  const b = tg ? S.boxes.get(tg.id) : undefined;
  if (!tg || !b) {
    overlaySvg.innerHTML = '';
    dropLabelEl.classList.remove('show');
    return;
  }
  const src = S.boxes.get(g.id);
  const parts = [previewSvg(b, tg, Math.min(src?.w ?? 90, 160), src?.h ?? 28)];
  for (const d of tg.dirs) {
    const q = padPoint(b, d, tg.offs);
    parts.push(
      `<g class="pad${d === tg.dir ? ' on' : ''}" data-dir="${d}" transform="translate(${q.x},${q.y}) scale(${1 / S.view.s})"><circle r="10"/><path d="${ARROWS[d].path}"/></g>`,
    );
  }
  overlaySvg.innerHTML = parts.join('');
  const name = node(tg.id)?.text.replace(/\s+/g, ' ') || '…';
  const short = name.length > 24 ? name.slice(0, 23) + '…' : name;
  const effect = tg.pos === 'child' ? t('eff_child') : tg.pos === 'parent' ? t('eff_parent') : t('eff_sibling');
  dropLabelEl.innerHTML = `${ARROWS[tg.dir].glyph} ${escapeHtml(t('drop_' + tg.dir).replace('{0}', short))} · ${escapeHtml(effect)}<small>${escapeHtml(t('escCancel'))}</small>`;
  dropLabelEl.classList.add('show');
}

function updateDrag(g: DragGesture) {
  if (g.ghost) {
    g.ghost.style.left = `${g.cx + 14}px`;
    g.ghost.style.top = `${g.cy + 14}px`;
  }
  g.target = findDropTarget(g.cx, g.cy, g.ids, g.target);
  drawDropIndicator(g);
}

/** Scroll the map while the pointer is held near the edge of the view (dragging or box-selecting). */
function edgePan(g: { cx: number; cy: number; raf?: number }, onStep: () => void) {
  if (g.raf !== undefined) return;
  const step = () => {
    g.raf = undefined;
    if (gesture !== g) return;
    const r = viewport.getBoundingClientRect();
    const edge = 40;
    const speed = 10;
    const vx = g.cx < r.left + edge ? speed : g.cx > r.left + visibleWidth() - edge ? -speed : 0;
    const vy = g.cy < r.top + edge ? speed : g.cy > r.bottom - edge ? -speed : 0;
    if (!vx && !vy) return;
    S.view.x += vx;
    S.view.y += vy;
    applyView();
    onStep();
    g.raf = requestAnimationFrame(step);
  };
  g.raf = requestAnimationFrame(step);
}

/** Select every visible topic the box touches. */
function updateMarquee(g: MarqueeGesture) {
  const p = toCanvas(g.cx, g.cy);
  const x0 = Math.min(g.start.x, p.x);
  const x1 = Math.max(g.start.x, p.x);
  const y0 = Math.min(g.start.y, p.y);
  const y1 = Math.max(g.start.y, p.y);
  const r = viewport.getBoundingClientRect();
  const { x, y, s } = S.view;
  marqueeEl.style.left = `${r.left + x0 * s + x}px`;
  marqueeEl.style.top = `${r.top + y0 * s + y}px`;
  marqueeEl.style.width = `${(x1 - x0) * s}px`;
  marqueeEl.style.height = `${(y1 - y0) * s}px`;
  marqueeEl.classList.add('show');
  const hits: string[] = [];
  for (const b of S.boxes.values()) if (b.x < x1 && b.x + b.w > x0 && b.y < y1 && b.y + b.h > y0) hits.push(b.node.id);
  const ids = g.additive ? [...new Set([...g.before, ...hits])] : hits;
  setSelection(ids, false);
  refreshSelection();
}

function endMarquee(g: MarqueeGesture, cancel: boolean) {
  if (g.raf !== undefined) cancelAnimationFrame(g.raf);
  marqueeEl.classList.remove('show');
  if (cancel) setSelection(g.before, false);
  else if (!g.moved && !g.additive) setSelection([], false); // a click on empty space clears the selection
  else if (g.moved && S.sel.size === 1) revealInSource(S.focus);
  refreshSelection();
}

function endDrag(g: DragGesture, drop: boolean) {
  if (g.raf !== undefined) cancelAnimationFrame(g.raf);
  g.raf = undefined;
  g.ghost?.remove();
  app.classList.remove('dragging');
  for (const el of topicEls.values()) el.classList.remove('dragging', 'drop-target');
  overlaySvg.innerHTML = '';
  dropLabelEl.classList.remove('show');
  if (drop && g.target) moveNodes(g.ids, g.target.id, g.target.pos, g.target.side);
}

viewport.addEventListener('dblclick', e => {
  const target = e.target as HTMLElement;
  const topic = target.closest<HTMLElement>('.topic');
  if (!topic) return;
  const n = node(topic.dataset.id);
  if (!n) return;
  if (target.classList.contains('t-img') && n.image) return post({ type: 'openImage', src: n.image.src });
  if (target.classList.contains('t-resize')) return resetWidth(n.id);
  beginEdit(n.id, 'select');
});

viewport.addEventListener(
  'wheel',
  e => {
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? viewport.clientHeight : 1;
    if (e.ctrlKey || e.metaKey) zoomAt(e.clientX, e.clientY, S.view.s * Math.exp(-e.deltaY * unit * 0.0075));
    else {
      S.view.x -= e.deltaX * unit;
      S.view.y -= e.deltaY * unit;
      applyView();
    }
  },
  { passive: false },
);

function openContextMenu(clientX: number, clientY: number, target: HTMLElement) {
  if (S.editing) commitEdit();
  const topic = target.closest<HTMLElement>('.topic');
  const r = viewport.getBoundingClientRect();
  const x = clientX - r.left;
  const y = clientY - r.top;
  if (topic && target.closest('.t-img')) {
    const id = topic.dataset.id!;
    selectImage(id);
    showMenu(x, y, imageMenu(id));
  } else if (topic) {
    const id = topic.dataset.id!;
    if (!S.sel.has(id) || S.imageSel) select(id);
    showMenu(x, y, S.sel.size > 1 ? multiMenu() : topicMenu(id));
  } else showMenu(x, y, canvasMenu());
}

viewport.addEventListener('contextmenu', e => {
  e.preventDefault();
  if (gesture?.kind === 'pan' || performance.now() - rightButtonAt < 800) return; // handled on mouse up
  // keyboard menu key: open for the selected topic
  const el = S.focus ? topicEls.get(S.focus) : undefined;
  const b = el?.getBoundingClientRect();
  if (el && b) openContextMenu(b.left + b.width / 2, b.bottom, el);
  else openContextMenu(e.clientX, e.clientY, e.target as HTMLElement);
});

viewport.addEventListener('mouseover', e => {
  const topic = (e.target as HTMLElement).closest<HTMLElement>('.topic, .fold');
  const id = topic?.dataset.id ?? null;
  if (id === S.hover) return;
  if (S.hover) foldEls.get(S.hover)?.classList.remove('hover');
  S.hover = id;
  if (id) foldEls.get(id)?.classList.add('hover');
});

nodesLayer.addEventListener('load', () => scheduleRender(), true);
nodesLayer.addEventListener('error', () => scheduleRender(), true);

// ---------------------------------------------------------------- drop images

const DROP_TYPES = ['Files', 'text/uri-list', 'application/vnd.code.uri-list'];

viewport.addEventListener('dragover', e => {
  if (!e.dataTransfer || !e.dataTransfer.types.some(x => DROP_TYPES.includes(x))) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  const topic = (e.target as HTMLElement).closest<HTMLElement>('.topic');
  for (const [id, el] of topicEls) el.classList.toggle('drop-child', id === topic?.dataset.id);
});

viewport.addEventListener('dragleave', () => {
  for (const el of topicEls.values()) el.classList.remove('drop-child');
});

viewport.addEventListener('drop', e => {
  const dt = e.dataTransfer;
  if (!dt) return;
  e.preventDefault();
  for (const el of topicEls.values()) el.classList.remove('drop-child');
  const topic = (e.target as HTMLElement).closest<HTMLElement>('.topic');
  const id = topic?.dataset.id ?? S.focus ?? root().id;
  const file = [...dt.files].find(f => f.type.startsWith('image/'));
  if (file && file.size) return saveImageFile(file, id);
  const uris = (dt.getData('application/vnd.code.uri-list') || dt.getData('text/uri-list'))
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(s => s && !s.startsWith('#'));
  if (uris.length) post({ type: 'linkImages', nodeId: id, uris });
});

// ---------------------------------------------------------------- misc

new MutationObserver(() => {
  render();
  buildFormat();
}).observe(document.body, { attributes: true, attributeFilter: ['class'] });

window.addEventListener('resize', () => S.noteId && positionNote());
window.addEventListener('focus', () => {
  if (!S.noteId && !typingElsewhere()) focusEditor();
});

post({ type: 'ready' });
