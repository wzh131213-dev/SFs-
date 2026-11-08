// Three.js renderer for the Vehicle Assembly Building (grid editor).

import * as THREE from "three";
import type { Blueprint, PartDef } from "../core/types";
import { getDef } from "../data/parts";
import type { SnapResult } from "../vab/grid";
import { buildPartObject } from "./partMesh";

export class VabRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);
  private partsGroup = new THREE.Group();
  private ghostGroup = new THREE.Group();
  private hlGroup = new THREE.Group();
  private minor: THREE.LineSegments;
  private comMarker: THREE.Mesh;
  private copMarker: THREE.Mesh;
  width = 1;
  height = 1;
  ppc = 9; // pixels per grid cell
  center = { x: 0, y: 34 };

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.scene.background = new THREE.Color(0x0e1218);

    // ground
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(900, 200),
      new THREE.MeshBasicMaterial({ color: 0x151d18, depthTest: false, depthWrite: false }),
    );
    ground.position.set(0, -100, 0);
    ground.renderOrder = 0;
    this.scene.add(ground);
    const pad = new THREE.Mesh(
      new THREE.PlaneGeometry(52, 1.6),
      new THREE.MeshBasicMaterial({ color: 0x59606c, depthTest: false, depthWrite: false }),
    );
    pad.position.set(0, -0.8, 0);
    pad.renderOrder = 0.5;
    this.scene.add(pad);

    // grid
    const minorPts: number[] = [];
    const majorPts: number[] = [];
    const X0 = -44;
    const X1 = 44;
    const Y0 = 0;
    const Y1 = 220;
    for (let x = X0; x <= X1; x++) (x % 4 === 0 ? majorPts : minorPts).push(x, Y0, 0, x, Y1, 0);
    for (let y = Y0; y <= Y1; y++) (y % 4 === 0 ? majorPts : minorPts).push(X0, y, 0, X1, y, 0);
    const mk = (pts: number[], color: number, opacity: number, order: number) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pts), 3));
      const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false }));
      l.renderOrder = order;
      this.scene.add(l);
      return l;
    };
    this.minor = mk(minorPts, 0x2a3445, 0.35, 1);
    mk(majorPts, 0x34425a, 0.55, 1.1);
    const axis = mk([0, 0, 0, 0, Y1, 0], 0xff8a1f, 0.35, 1.2);
    void axis;

    this.scene.add(this.partsGroup, this.hlGroup, this.ghostGroup);

    const ring = new THREE.RingGeometry(0.55, 0.9, 24);
    this.comMarker = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: 0xffd23f, depthTest: false, depthWrite: false }));
    this.copMarker = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: 0x4da3ff, depthTest: false, depthWrite: false }));
    this.comMarker.renderOrder = 50;
    this.copMarker.renderOrder = 50;
    this.comMarker.visible = false;
    this.copMarker.visible = false;
    this.scene.add(this.comMarker, this.copMarker);
  }

  resize(w: number, h: number, dpr: number): void {
    this.width = Math.max(1, w);
    this.height = Math.max(1, h);
    this.renderer.setPixelRatio(Math.min(2, dpr));
    this.renderer.setSize(this.width, this.height, false);
  }

  screenToCell(px: number, py: number): { x: number; y: number } {
    return { x: this.center.x + (px - this.width / 2) / this.ppc, y: this.center.y - (py - this.height / 2) / this.ppc };
  }

  zoomAt(deltaY: number, px: number, py: number): void {
    const before = this.screenToCell(px, py);
    this.ppc = Math.min(48, Math.max(3, this.ppc * Math.exp(-deltaY * 0.0012)));
    const after = this.screenToCell(px, py);
    this.center.x += before.x - after.x;
    this.center.y += before.y - after.y;
  }

  pan(dxPx: number, dyPx: number): void {
    this.center.x -= dxPx / this.ppc;
    this.center.y += dyPx / this.ppc;
  }

  frame(bp: Blueprint): void {
    if (!bp.parts.length) {
      this.center = { x: 0, y: 30 };
      this.ppc = Math.min(14, this.height / 70);
      return;
    }
    let maxY = 0;
    for (const p of bp.parts) maxY = Math.max(maxY, p.gy + getDef(p.defId).h);
    this.center = { x: 0, y: maxY / 2 + 2 };
    this.ppc = Math.min(16, Math.max(3.5, (this.height * 0.82) / (maxY + 8)));
  }

  setBlueprint(bp: Blueprint, highlight: Set<number> | null): void {
    while (this.partsGroup.children.length) this.partsGroup.remove(this.partsGroup.children[0]);
    while (this.hlGroup.children.length) this.hlGroup.remove(this.hlGroup.children[0]);
    for (const p of bp.parts) {
      const def = getDef(p.defId);
      const flip = !!def.radial && p.gx + def.w / 2 < 0;
      const obj = buildPartObject(def, 1, flip, 10);
      obj.position.set(p.gx + def.w / 2, p.gy + def.h / 2, 0);
      this.partsGroup.add(obj);
      if (highlight && highlight.has(p.id)) {
        const r = new THREE.Mesh(
          new THREE.PlaneGeometry(def.w, def.h),
          new THREE.MeshBasicMaterial({ color: 0xff8a1f, transparent: true, opacity: 0.35, depthTest: false, depthWrite: false }),
        );
        r.position.set(p.gx + def.w / 2, p.gy + def.h / 2, 0);
        r.renderOrder = 30;
        this.hlGroup.add(r);
      }
    }
  }

  setGhost(def: PartDef | null, snap: SnapResult | null): void {
    while (this.ghostGroup.children.length) this.ghostGroup.remove(this.ghostGroup.children[0]);
    if (!def || !snap) return;
    const spots = [{ gx: snap.gx, gy: snap.gy }];
    if (snap.mirror) spots.push(snap.mirror);
    for (const s of spots) {
      const flip = !!def.radial && s.gx + def.w / 2 < 0;
      const obj = buildPartObject(def, 1, flip, 25);
      obj.position.set(s.gx + def.w / 2, s.gy + def.h / 2, 0);
      this.ghostGroup.add(obj);
      const r = new THREE.Mesh(
        new THREE.PlaneGeometry(def.w, def.h),
        new THREE.MeshBasicMaterial({ color: snap.valid ? 0x35e08a : 0xff4d4d, transparent: true, opacity: 0.38, depthTest: false, depthWrite: false }),
      );
      r.position.set(s.gx + def.w / 2, s.gy + def.h / 2, 0);
      r.renderOrder = 40;
      this.ghostGroup.add(r);
    }
  }

  setMarkers(com: { x: number; y: number } | null, cop: { x: number; y: number } | null): void {
    this.comMarker.visible = !!com;
    this.copMarker.visible = !!cop;
    if (com) this.comMarker.position.set(com.x, com.y, 0);
    if (cop) this.copMarker.position.set(cop.x, cop.y, 0);
  }

  render(): void {
    const hw = this.width / (2 * this.ppc);
    const hh = this.height / (2 * this.ppc);
    const c = this.camera;
    c.left = this.center.x - hw;
    c.right = this.center.x + hw;
    c.top = this.center.y + hh;
    c.bottom = this.center.y - hh;
    c.updateProjectionMatrix();
    (this.minor.material as THREE.LineBasicMaterial).opacity = Math.max(0, Math.min(1, (this.ppc - 5) / 8)) * 0.35;
    const ms = 7 / this.ppc;
    this.comMarker.scale.setScalar(ms);
    this.copMarker.scale.setScalar(ms);
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.renderer.dispose();
  }
}
