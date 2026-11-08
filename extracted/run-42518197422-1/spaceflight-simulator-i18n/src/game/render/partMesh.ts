// Three.js builders for part visuals (shared by VAB and flight) + SVG icon paths.

import * as THREE from "three";
import type { PartDef } from "../core/types";

const fillMats = new Map<string, THREE.MeshBasicMaterial>();
function fillMat(color: string): THREE.MeshBasicMaterial {
  let m = fillMats.get(color);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, depthTest: false, depthWrite: false });
    fillMats.set(color, m);
  }
  return m;
}
const lineMat = new THREE.LineBasicMaterial({ color: 0x11141a, depthTest: false, depthWrite: false });

interface CachedPart {
  fills: { geo: THREE.BufferGeometry; color: string }[];
  lines: THREE.BufferGeometry[];
}
const cache = new Map<string, CachedPart>();

function getCached(def: PartDef, unit: number, flip: boolean): CachedPart {
  const key = `${def.id}|${unit}|${flip ? 1 : 0}`;
  let c = cache.get(key);
  if (c) return c;
  const W = def.w * unit;
  const H = def.h * unit;
  c = { fills: [], lines: [] };
  for (const poly of def.visual) {
    const pts = poly.pts.map(([px, py]) => new THREE.Vector2((flip ? 1 - px : px) * W - W / 2, py * H - H / 2));
    const shape = new THREE.Shape(pts);
    c.fills.push({ geo: new THREE.ShapeGeometry(shape), color: poly.fill });
    const lg = new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(p.x, p.y, 0)));
    c.lines.push(lg);
  }
  cache.set(key, c);
  return c;
}

/** Build a group centred on the part's centre. `unit` = world units per grid cell. */
export function buildPartObject(def: PartDef, unit: number, flip: boolean, baseOrder = 10): THREE.Group {
  const g = new THREE.Group();
  const c = getCached(def, unit, flip);
  c.fills.forEach((f, i) => {
    const mesh = new THREE.Mesh(f.geo, fillMat(f.color));
    mesh.renderOrder = baseOrder + i * 0.01;
    g.add(mesh);
    const line = new THREE.LineLoop(c.lines[i], lineMat);
    line.renderOrder = baseOrder + i * 0.01 + 0.005;
    g.add(line);
  });
  return g;
}

export interface IconPath {
  d: string;
  fill: string;
}

/** SVG paths for palette icons; viewBox is `0 0 w h`. */
export function partIconPaths(def: PartDef): IconPath[] {
  return def.visual.map((poly) => ({
    fill: poly.fill,
    d:
      poly.pts
        .map(([x, y], i) => `${i === 0 ? "M" : "L"}${(x * def.w).toFixed(2)} ${((1 - y) * def.h).toFixed(2)}`)
        .join(" ") + " Z",
  }));
}

// ----------------------------------------------------------------- flames / canopy

const flameMats = {
  outer: new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.85, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending }),
  mid: new THREE.MeshBasicMaterial({ color: 0xffc247, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending }),
  core: new THREE.MeshBasicMaterial({ color: 0xfff6d8, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending }),
};

function tri(w: number, l: number): THREE.BufferGeometry {
  const s = new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(0, -l)]);
  return new THREE.ShapeGeometry(s);
}
const flameGeos = { outer: tri(1, 1), mid: tri(0.62, 0.72), core: tri(0.3, 0.45) };

/** Unit flame: width 1, length 1, pointing -y. Scale it per frame. */
export function buildFlame(): THREE.Group {
  const g = new THREE.Group();
  const a = new THREE.Mesh(flameGeos.outer, flameMats.outer);
  const b = new THREE.Mesh(flameGeos.mid, flameMats.mid);
  const c = new THREE.Mesh(flameGeos.core, flameMats.core);
  a.renderOrder = 8;
  b.renderOrder = 8.1;
  c.renderOrder = 8.2;
  g.add(a, b, c);
  return g;
}

const canopyGeo = (() => {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 20; i++) {
    const a = Math.PI - (Math.PI * i) / 20;
    pts.push(new THREE.Vector2(Math.cos(a) * 0.5, Math.sin(a) * 0.5));
  }
  return new THREE.ShapeGeometry(new THREE.Shape(pts));
})();
const canopyMat = new THREE.MeshBasicMaterial({ color: 0xe2483d, side: THREE.DoubleSide, depthTest: false, depthWrite: false });
const stringMat = new THREE.LineBasicMaterial({ color: 0xdddddd, depthTest: false, depthWrite: false });

export function buildCanopy(): { group: THREE.Group; canopy: THREE.Mesh; strings: THREE.LineSegments } {
  const group = new THREE.Group();
  const canopy = new THREE.Mesh(canopyGeo, canopyMat);
  canopy.renderOrder = 12;
  const sg = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(-0.5, 1, 0),
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.5, 1, 0),
  ]);
  const strings = new THREE.LineSegments(sg, stringMat);
  strings.renderOrder = 11;
  group.add(canopy, strings);
  return { group, canopy, strings };
}

const plasmaGeo = new THREE.CircleGeometry(0.5, 32);
export function buildPlasma(): THREE.Mesh {
  const m = new THREE.Mesh(
    plasmaGeo,
    new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  m.renderOrder = 9;
  return m;
}
