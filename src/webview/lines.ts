import type { LineStyle } from '../shared/model';
import type { Box } from './layout';

export interface Pt {
  x: number;
  y: number;
}

export interface LineOpts {
  style: LineStyle;
  vertical: boolean;
  /** Balanced map: main branches grow out of the centre of the central topic. */
  fromCenter: boolean;
  underline: (b: Box) => boolean;
}

const f = (n: number) => Math.round(n * 10) / 10;

function outPoint(b: Box, side: number, o: LineOpts): Pt {
  if (o.vertical) return { x: b.x + b.w / 2, y: b.y + b.h };
  const y = o.underline(b) ? b.y + b.h - 1 : b.y + b.h / 2;
  return { x: side > 0 ? b.x + b.w : b.x, y };
}

function inPoint(b: Box, o: LineOpts): Pt {
  if (o.vertical) return { x: b.x + b.w / 2, y: b.y };
  const y = o.underline(b) ? b.y + b.h - 1 : b.y + b.h / 2;
  return { x: b.side > 0 ? b.x : b.x + b.w, y };
}

/** Where the fold / unfold button of a topic sits. */
export function foldPoint(b: Box, o: LineOpts): Pt {
  const p = outPoint(b, b.side, o);
  if (o.vertical) return { x: p.x, y: p.y + 10 };
  return { x: p.x + (b.side > 0 ? 10 : -10), y: p.y };
}

/** Out-going anchor of a topic, used for drop previews. */
export function anchorOut(b: Box, o: LineOpts): Pt {
  return outPoint(b, b.side || 1, o);
}

function cubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, n: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    pts.push({
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    });
  }
  return pts;
}

/** Filled outline of a stroke that narrows from w0 to w1 along the points. */
function taper(pts: Pt[], w0: number, w1: number): string {
  const n = pts.length;
  const L: Pt[] = [];
  const R: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(i - 1, 0)];
    const b = pts[Math.min(i + 1, n - 1)];
    let tx = b.x - a.x;
    let ty = b.y - a.y;
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
    const w = (w0 + (w1 - w0) * (i / (n - 1))) / 2;
    L.push({ x: pts[i].x - ty * w, y: pts[i].y + tx * w });
    R.push({ x: pts[i].x + ty * w, y: pts[i].y - tx * w });
  }
  const r = w1 / 2;
  return (
    `M${f(L[0].x)},${f(L[0].y)}` +
    L.slice(1).map(p => `L${f(p.x)},${f(p.y)}`).join('') +
    `A${f(r)},${f(r)} 0 0 1 ${f(R[n - 1].x)},${f(R[n - 1].y)}` +
    R.slice(0, -1)
      .reverse()
      .map(p => `L${f(p.x)},${f(p.y)}`)
      .join('') +
    'Z'
  );
}

function elbowH(s: Pt, e: Pt, mx: number): string {
  const dy = e.y - s.y;
  const sx = Math.sign(e.x - s.x) || 1;
  const sy = Math.sign(dy);
  const r = Math.min(8, Math.abs(dy) / 2, Math.abs(mx - s.x), Math.abs(e.x - mx));
  if (Math.abs(dy) < 1 || r < 1) return `M${f(s.x)},${f(s.y)}H${f(mx)}V${f(e.y)}H${f(e.x)}`;
  return `M${f(s.x)},${f(s.y)}H${f(mx - sx * r)}Q${f(mx)},${f(s.y)} ${f(mx)},${f(s.y + sy * r)}V${f(e.y - sy * r)}Q${f(mx)},${f(e.y)} ${f(mx + sx * r)},${f(e.y)}H${f(e.x)}`;
}

function elbowV(s: Pt, e: Pt, my: number): string {
  const dx = e.x - s.x;
  const sy = Math.sign(e.y - s.y) || 1;
  const sx = Math.sign(dx);
  const r = Math.min(8, Math.abs(dx) / 2, Math.abs(my - s.y), Math.abs(e.y - my));
  if (Math.abs(dx) < 1 || r < 1) return `M${f(s.x)},${f(s.y)}V${f(my)}H${f(e.x)}V${f(e.y)}`;
  return `M${f(s.x)},${f(s.y)}V${f(my - sy * r)}Q${f(s.x)},${f(my)} ${f(s.x + sx * r)},${f(my)}H${f(e.x - sx * r)}Q${f(e.x)},${f(my)} ${f(e.x)},${f(my + sy * r)}V${f(e.y)}`;
}

export interface BranchPath {
  d: string;
  filled: boolean;
  width: number;
}

export function branchPath(parent: Box, child: Box, o: LineOpts): BranchPath {
  const e = inPoint(child, o);
  const fromRoot = parent.depth === 0;

  if (fromRoot) {
    const cx = parent.x + parent.w / 2;
    const cy = parent.y + parent.h / 2;
    let s: Pt;
    if (o.vertical) s = { x: cx, y: parent.y + parent.h - 2 };
    else if (o.fromCenter && o.style !== 'elbow') s = { x: cx, y: cy };
    else s = { x: child.side > 0 ? parent.x + parent.w - 2 : parent.x + 2, y: cy };

    if (o.style === 'elbow') {
      const d = o.vertical ? elbowV(s, e, s.y + Math.min((e.y - s.y) / 2, 26)) : elbowH(s, e, s.x + Math.sign(e.x - s.x) * Math.min(Math.abs(e.x - s.x) / 2, 26));
      return { d, filled: false, width: 3 };
    }
    let pts: Pt[];
    const dx = e.x - s.x;
    const dy = e.y - s.y;
    if (o.style === 'straight') pts = cubic(s, s, e, e, 2);
    else if (o.vertical) pts = cubic(s, { x: s.x, y: s.y + dy / 2 }, { x: e.x, y: s.y + dy / 2 }, e, 24);
    else if (o.fromCenter) pts = cubic(s, { x: s.x + dx * 0.25, y: s.y + dy * 0.15 }, { x: s.x + dx * 0.12, y: e.y }, e, 28);
    else pts = cubic(s, { x: s.x + dx / 2, y: s.y }, { x: s.x + dx / 2, y: e.y }, e, 24);
    return { d: taper(pts, 8, 2.6), filled: true, width: 0 };
  }

  const s = outPoint(parent, child.side, o);
  const width = parent.depth === 1 ? 2 : 1.5;
  const dx = e.x - s.x;
  const dy = e.y - s.y;
  let d: string;
  if (o.style === 'straight') d = `M${f(s.x)},${f(s.y)}L${f(e.x)},${f(e.y)}`;
  else if (o.style === 'elbow')
    d = o.vertical ? elbowV(s, e, s.y + Math.min(dy / 2, 18)) : elbowH(s, e, s.x + Math.sign(dx) * Math.min(Math.abs(dx) / 2, 14));
  else if (o.vertical) d = `M${f(s.x)},${f(s.y)}C${f(s.x)},${f(s.y + dy / 2)} ${f(e.x)},${f(s.y + dy / 2)} ${f(e.x)},${f(e.y)}`;
  else d = `M${f(s.x)},${f(s.y)}C${f(s.x + dx / 2)},${f(s.y)} ${f(s.x + dx / 2)},${f(e.y)} ${f(e.x)},${f(e.y)}`;
  return { d, filled: false, width };
}
