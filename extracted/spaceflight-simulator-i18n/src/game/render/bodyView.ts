// Planet rendering using adaptive arc strips so curvature stays exact at every zoom level.

import * as THREE from "three";
import type { BodyDef } from "../core/types";

const MAX_SEG = 220;

class StripMesh {
  mesh: THREE.Mesh;
  private pos: Float32Array;
  private col: Float32Array;
  private posAttr: THREE.BufferAttribute;
  private colAttr: THREE.BufferAttribute;

  constructor(renderOrder: number, additive = false) {
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAX_SEG * 4 * 3);
    this.col = new Float32Array(MAX_SEG * 4 * 4);
    this.posAttr = new THREE.BufferAttribute(this.pos, 3);
    this.colAttr = new THREE.BufferAttribute(this.col, 4);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.colAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("position", this.posAttr);
    geo.setAttribute("color", this.colAttr);
    const idx = new Uint16Array(MAX_SEG * 6);
    for (let k = 0; k < MAX_SEG; k++) {
      const b = k * 4;
      idx.set([b, b + 1, b + 2, b + 1, b + 3, b + 2], k * 6);
    }
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.setDrawRange(0, 0);
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.renderOrder = renderOrder;
    this.mesh.frustumCulled = false;
  }

  /** angles: n+1 boundary angles. colors(k) -> [outer rgba, inner rgba]. */
  fill(cx: number, cy: number, angles: number[], ro: number, ri: number, colors: (k: number) => number[]): void {
    const n = Math.min(MAX_SEG, angles.length - 1);
    for (let k = 0; k < n; k++) {
      const a0 = angles[k];
      const a1 = angles[k + 1];
      const c = colors(k);
      const p = k * 12;
      this.pos[p] = cx + Math.cos(a0) * ro;
      this.pos[p + 1] = cy + Math.sin(a0) * ro;
      this.pos[p + 3] = cx + Math.cos(a0) * ri;
      this.pos[p + 4] = cy + Math.sin(a0) * ri;
      this.pos[p + 6] = cx + Math.cos(a1) * ro;
      this.pos[p + 7] = cy + Math.sin(a1) * ro;
      this.pos[p + 9] = cx + Math.cos(a1) * ri;
      this.pos[p + 10] = cy + Math.sin(a1) * ri;
      const q = k * 16;
      for (let j = 0; j < 4; j++) {
        const src = j === 0 || j === 2 ? 0 : 4;
        this.col[q + j * 4] = c[src];
        this.col[q + j * 4 + 1] = c[src + 1];
        this.col[q + j * 4 + 2] = c[src + 2];
        this.col[q + j * 4 + 3] = c[src + 3];
      }
    }
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    this.mesh.geometry.setDrawRange(0, n * 6);
    this.mesh.visible = n > 0;
  }

  hide() {
    this.mesh.visible = false;
  }
}

const rgba = (hex: string, a: number): number[] => {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b, a];
};

export class BodyView {
  body: BodyDef;
  ground = new StripMesh(2);
  atmo = new StripMesh(1);
  private cA: number[];
  private cB: number[];
  private groundColors: number[][];
  private atmoColors: number[][];
  private angles: number[] = [];

  constructor(body: BodyDef, parent: THREE.Object3D) {
    this.body = body;
    this.cA = [...rgba(body.color, 1), ...rgba(body.color, 1)];
    this.cB = [...rgba(body.colorAlt, 1), ...rgba(body.colorAlt, 1)];
    this.groundColors = [this.cA, this.cB];
    const sky = body.atmo ? rgba(body.sky, 0.55) : rgba(body.sky, 0);
    const skyOut = rgba(body.sky, 0);
    this.atmoColors = [[...skyOut, ...sky]];
    parent.add(this.atmo.mesh, this.ground.mesh);
  }

  /**
   * cx, cy: body centre relative to the camera centre (world metres, un-rotated).
   * vr: half-diagonal of the view in metres.
   */
  update(cx: number, cy: number, vr: number, mpp: number, mapMode: boolean): void {
    const b = this.body;
    const R = mapMode ? Math.max(b.radius, mpp * 3) : b.radius;
    const H = b.atmo ? b.atmo.height : 0;
    const d = Math.hypot(cx, cy);
    if (d - (R + H) > vr * 1.05) {
      this.ground.hide();
      this.atmo.hide();
      return;
    }
    const full = R <= vr * 2.2 || d < vr * 1.3;
    const angles = this.angles;
    angles.length = 0;
    let ri: number;
    if (full) {
      const N = 160;
      for (let i = 0; i <= N; i++) angles.push((i / N) * Math.PI * 2);
      ri = 0;
      this.ground.fill(cx, cy, angles, R, 0, () => this.groundColors[0]);
    } else {
      const phi0 = Math.atan2(-cy, -cx);
      const beta = Math.min(Math.PI, Math.asin(Math.min(1, (vr * 1.1) / d)) + (0.3 * vr) / R);
      let L = Math.pow(10, Math.round(Math.log10(vr / 8)));
      while ((2 * beta * R) / L > MAX_SEG - 4) L *= 2;
      const k0 = Math.floor(((phi0 - beta) * R) / L);
      const k1 = Math.ceil(((phi0 + beta) * R) / L);
      for (let k = k0; k <= k1; k++) angles.push((k * L) / R);
      ri = Math.max(0, Math.min(R, d) - 2.2 * vr);
      const par0 = ((k0 % 2) + 2) % 2;
      this.ground.fill(cx, cy, angles, R, ri, (k) => this.groundColors[(par0 + k) % 2]);
    }
    if (b.atmo) {
      const aAngles: number[] = [];
      if (full) {
        const N = 128;
        for (let i = 0; i <= N; i++) aAngles.push((i / N) * Math.PI * 2);
      } else {
        const phi0 = Math.atan2(-cy, -cx);
        const beta = Math.min(Math.PI, Math.asin(Math.min(1, (vr * 1.1) / d)) + (0.3 * vr) / R);
        const N = 64;
        for (let i = 0; i <= N; i++) aAngles.push(phi0 - beta + (2 * beta * i) / N);
      }
      this.atmo.fill(cx, cy, aAngles, R + H, R, () => this.atmoColors[0]);
    } else this.atmo.hide();
    void ri;
  }
}
