// VAB grid logic: occupancy, attachment graph, snapping and edit operations.

import type { Blueprint, PartDef, PartInstance } from "../core/types";
import { getDef } from "../data/parts";

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function rectOf(p: PartInstance): Rect {
  const d = getDef(p.defId);
  return { x0: p.gx, y0: p.gy, x1: p.gx + d.w, y1: p.gy + d.h };
}

const overlapLen = (a0: number, a1: number, b0: number, b1: number) => Math.min(a1, b1) - Math.max(a0, b0);

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return overlapLen(a.x0, a.x1, b.x0, b.x1) > 0 && overlapLen(a.y0, a.y1, b.y0, b.y1) > 0;
}

/** Do two placed parts attach to each other? */
export function connects(ra: Rect, da: PartDef, rb: Rect, db: PartDef): boolean {
  // Side contact: needs at least one radial part.
  if ((ra.x1 === rb.x0 || rb.x1 === ra.x0) && overlapLen(ra.y0, ra.y1, rb.y0, rb.y1) > 0) {
    return !!(da.radial || db.radial);
  }
  // Top / bottom contact: both must be stack parts.
  if ((ra.y1 === rb.y0 || rb.y1 === ra.y0) && overlapLen(ra.x0, ra.x1, rb.x0, rb.x1) > 0) {
    return !da.radial && !db.radial;
  }
  return false;
}

export interface Analysis {
  root: number | null;
  parent: Map<number, number | null>;
  adj: Map<number, number[]>;
  reachable: Set<number>;
}

export function analyze(bp: Blueprint): Analysis {
  const parts = bp.parts;
  const adj = new Map<number, number[]>();
  for (const p of parts) adj.set(p.id, []);
  const rects = parts.map(rectOf);
  const defs = parts.map((p) => getDef(p.defId));
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      if (connects(rects[i], defs[i], rects[j], defs[j])) {
        adj.get(parts[i].id)!.push(parts[j].id);
        adj.get(parts[j].id)!.push(parts[i].id);
      }
    }
  }
  // Root: lowest-id command part, otherwise the topmost part.
  let root: number | null = null;
  for (let i = 0; i < parts.length; i++) {
    if (defs[i].category === "command" && (root === null || parts[i].id < root)) root = parts[i].id;
  }
  if (root === null && parts.length) {
    let best = -Infinity;
    for (let i = 0; i < parts.length; i++) {
      if (rects[i].y1 > best) {
        best = rects[i].y1;
        root = parts[i].id;
      }
    }
  }
  const parent = new Map<number, number | null>();
  const reachable = new Set<number>();
  if (root !== null) {
    parent.set(root, null);
    reachable.add(root);
    const queue = [root];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const n of adj.get(cur)!) {
        if (!reachable.has(n)) {
          reachable.add(n);
          parent.set(n, cur);
          queue.push(n);
        }
      }
    }
  }
  return { root, parent, adj, reachable };
}

export function canPlace(bp: Blueprint, def: PartDef, gx: number, gy: number): boolean {
  const r: Rect = { x0: gx, y0: gy, x1: gx + def.w, y1: gy + def.h };
  for (const p of bp.parts) if (rectsOverlap(r, rectOf(p))) return false;
  if (bp.parts.length === 0) return !def.radial;
  for (const p of bp.parts) if (connects(r, def, rectOf(p), getDef(p.defId))) return true;
  return false;
}

export const mirrorX = (def: PartDef, gx: number): number => -(gx + def.w);

export interface SnapResult {
  gx: number;
  gy: number;
  valid: boolean;
  /** Mirror partner position, if symmetry is on and the part is off-axis. */
  mirror: { gx: number; gy: number } | null;
}

function evaluate(bp: Blueprint, def: PartDef, gx: number, gy: number, symmetry: boolean): SnapResult | null {
  if (!canPlace(bp, def, gx, gy)) return null;
  if (!symmetry) return { gx, gy, valid: true, mirror: null };
  const mx = mirrorX(def, gx);
  if (mx === gx) return { gx, gy, valid: true, mirror: null };
  // Both halves must be placeable together (they must not overlap each other).
  const a: Rect = { x0: gx, y0: gy, x1: gx + def.w, y1: gy + def.h };
  const b: Rect = { x0: mx, y0: gy, x1: mx + def.w, y1: gy + def.h };
  if (rectsOverlap(a, b)) return null;
  const tmp: Blueprint = { ...bp, parts: [...bp.parts, { id: -1, defId: def.id, gx, gy, stage: -1 }] };
  if (!canPlace(tmp, def, mx, gy)) return null;
  return { gx, gy, valid: true, mirror: { gx: mx, gy } };
}

/**
 * Find the best snapped placement for `def` near the cursor (cell coordinates, float).
 * Generates flush-attachment candidates around every existing part.
 */
export function findSnap(bp: Blueprint, def: PartDef, curX: number, curY: number, symmetry: boolean): SnapResult {
  const free: SnapResult = {
    gx: Math.round(curX - def.w / 2),
    gy: Math.round(curY - def.h / 2),
    valid: false,
    mirror: null,
  };
  if (bp.parts.length === 0) {
    const gx = Math.floor(-def.w / 2);
    const r = evaluate(bp, def, gx, free.gy, false);
    return r ?? { ...free, gx };
  }
  const cands: [number, number][] = [];
  const axisX = Math.floor(-def.w / 2);
  for (const p of bp.parts) {
    const pd = getDef(p.defId);
    const cursorGx = Math.round(curX - def.w / 2);
    const cursorGy = Math.round(curY - def.h / 2);
    if (!def.radial) {
      const xs = [axisX, p.gx, p.gx + pd.w - def.w, Math.max(p.gx - def.w + 1, Math.min(p.gx + pd.w - 1, cursorGx))];
      for (const gx of xs) {
        cands.push([gx, p.gy - def.h]);
        cands.push([gx, p.gy + pd.h]);
      }
    }
    const ys = [p.gy, p.gy + pd.h - def.h, Math.max(p.gy - def.h + 1, Math.min(p.gy + pd.h - 1, cursorGy))];
    for (const gy of ys) {
      cands.push([p.gx + pd.w, gy]);
      cands.push([p.gx - def.w, gy]);
    }
  }
  let best: SnapResult | null = null;
  let bestD = 14;
  const seen = new Set<string>();
  for (const [gx, gy] of cands) {
    const key = gx + "," + gy;
    if (seen.has(key)) continue;
    seen.add(key);
    const d = Math.hypot(gx + def.w / 2 - curX, gy + def.h / 2 - curY);
    if (d >= bestD) continue;
    const r = evaluate(bp, def, gx, gy, symmetry);
    if (r) {
      best = r;
      bestD = d;
    }
  }
  return best ?? free;
}

export function nextId(bp: Blueprint): number {
  let m = 0;
  for (const p of bp.parts) m = Math.max(m, p.id);
  return m + 1;
}

export function addPart(bp: Blueprint, defId: string, snap: SnapResult): Blueprint {
  const parts = [...bp.parts];
  let id = nextId(bp);
  parts.push({ id: id++, defId, gx: snap.gx, gy: snap.gy, stage: -1 });
  if (snap.mirror) parts.push({ id: id++, defId, gx: snap.mirror.gx, gy: snap.mirror.gy, stage: -1 });
  return { ...bp, parts };
}

/** Remove a part and everything that is no longer connected to the root. */
export function removePart(bp: Blueprint, id: number): Blueprint {
  const rest = { ...bp, parts: bp.parts.filter((p) => p.id !== id) };
  const a = analyze(rest);
  return { ...rest, parts: rest.parts.filter((p) => a.reachable.has(p.id)) };
}

/** Shift the rocket so its lowest point sits at y = 0. */
export function normalize(bp: Blueprint): Blueprint {
  if (!bp.parts.length) return bp;
  let minY = Infinity;
  for (const p of bp.parts) minY = Math.min(minY, p.gy);
  if (minY === 0) return bp;
  return { ...bp, parts: bp.parts.map((p) => ({ ...p, gy: p.gy - minY })) };
}
