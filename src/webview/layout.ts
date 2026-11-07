import type { Layout, MindNode } from '../shared/model';

export interface Box {
  node: MindNode;
  parent: Box | null;
  children: Box[];
  depth: number;
  /** +1 right / below, -1 left, 0 root. */
  side: 1 | -1 | 0;
  w: number;
  h: number;
  x: number;
  y: number;
  /** Extent of the subtree along the stacking axis. */
  ext: number;
  /** Extent of the children block along the stacking axis. */
  inner: number;
  branch: string;
  el: HTMLElement;
}

// Gaps, indexed by depth (last value repeats).
const H_GAP = [64, 40, 30]; // parent -> children, horizontal layouts (by parent depth)
const V_GAP = [0, 22, 10, 8]; // between siblings, horizontal layouts (by child depth)
const DOWN_V_GAP = [56, 44, 34]; // parent -> children, org chart (by parent depth)
const DOWN_H_GAP = [0, 36, 16]; // between siblings, org chart (by child depth)

const at = (a: number[], i: number) => a[Math.min(i, a.length - 1)];

/** Positions every box; the central topic is centred on (0, 0). */
export function layoutTree(root: Box, layout: Layout) {
  if (layout === 'down') {
    measureV(root);
    placeV(root, -root.ext / 2, -root.h / 2);
    return;
  }
  root.x = -root.w / 2;
  root.y = -root.h / 2;
  root.side = 0;
  const kids = root.children;
  let right: Box[] = [];
  let left: Box[] = [];
  if (layout === 'right') right = kids;
  else if (layout === 'left') left = kids;
  else {
    // Mind map: main topics go on the right unless they were explicitly put on the left.
    right = kids.filter(k => k.node.side !== 'left');
    left = kids.filter(k => k.node.side === 'left');
  }
  const groups: [Box[], 1 | -1][] = [
    [right, 1],
    [left, -1],
  ];
  for (const [group, dir] of groups) {
    if (!group.length) continue;
    const vg = at(V_GAP, 1);
    const total = group.reduce((a, b) => a + measureH(b), 0) + vg * (group.length - 1);
    let top = -total / 2;
    const x = dir > 0 ? root.x + root.w + H_GAP[0] : root.x - H_GAP[0];
    for (const b of group) {
      placeH(b, x, top, dir);
      top += b.ext + vg;
    }
  }
}

function measureH(b: Box): number {
  if (!b.children.length) {
    b.inner = 0;
    return (b.ext = b.h);
  }
  const vg = at(V_GAP, b.depth + 1);
  b.inner = b.children.reduce((a, c) => a + measureH(c), 0) + vg * (b.children.length - 1);
  return (b.ext = Math.max(b.h, b.inner));
}

function placeH(b: Box, x: number, top: number, dir: 1 | -1) {
  b.side = dir;
  b.x = dir > 0 ? x : x - b.w;
  b.y = top + (b.ext - b.h) / 2;
  if (!b.children.length) return;
  const vg = at(V_GAP, b.depth + 1);
  const cx = dir > 0 ? b.x + b.w + at(H_GAP, b.depth) : b.x - at(H_GAP, b.depth);
  let cy = top + (b.ext - b.inner) / 2;
  for (const c of b.children) {
    placeH(c, cx, cy, dir);
    cy += c.ext + vg;
  }
}

function measureV(b: Box): number {
  if (!b.children.length) {
    b.inner = 0;
    return (b.ext = b.w);
  }
  const hg = at(DOWN_H_GAP, b.depth + 1);
  b.inner = b.children.reduce((a, c) => a + measureV(c), 0) + hg * (b.children.length - 1);
  return (b.ext = Math.max(b.w, b.inner));
}

function placeV(b: Box, left: number, y: number) {
  b.side = b.depth === 0 ? 0 : 1;
  b.x = left + (b.ext - b.w) / 2;
  b.y = y;
  if (!b.children.length) return;
  const hg = at(DOWN_H_GAP, b.depth + 1);
  let cx = left + (b.ext - b.inner) / 2;
  const cy = y + b.h + at(DOWN_V_GAP, b.depth);
  for (const c of b.children) {
    placeV(c, cx, cy);
    cx += c.ext + hg;
  }
}
