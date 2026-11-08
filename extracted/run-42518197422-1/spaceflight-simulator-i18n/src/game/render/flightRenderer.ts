// Three.js renderer for the flight view and the map view.
// Uses a floating origin: everything is positioned relative to the camera focus in double
// precision on the CPU, so float32 GPU coordinates stay small at any distance.

import * as THREE from "three";
import { CELL, formatDistance, formatTime, vlen } from "../core/math";
import type { Simulation } from "../flight/simulation";
import type { Prediction } from "../flight/prediction";
import type { PartRT, Vessel } from "../flight/vessel";
import { BODIES, BODY_LIST, bodyAbsPos, bodyOrbit } from "../physics/solar";
import { BodyView } from "./bodyView";
import { drawNavball, type NavData } from "./navball";
import { ParticlePool } from "./particles";
import { buildCanopy, buildFlame, buildPartObject, buildPlasma } from "./partMesh";
import { t } from "../../i18n";
import { bodyName, vesselName } from "../../i18n/game";

export type ViewMode = "flight" | "map";

const triGeo = (() => {
  const s = new THREE.Shape([new THREE.Vector2(0, 1), new THREE.Vector2(-0.7, -0.8), new THREE.Vector2(0, -0.4), new THREE.Vector2(0.7, -0.8)]);
  return new THREE.ShapeGeometry(s);
})();

class VesselView {
  group = new THREE.Group();
  partsGroup = new THREE.Group();
  marker: THREE.Mesh;
  plasma = buildPlasma();
  version = -1;
  flames: { part: PartRT; obj: THREE.Group }[] = [];
  chutes: { part: PartRT; group: THREE.Group; canopy: THREE.Mesh; strings: THREE.LineSegments }[] = [];

  constructor(parent: THREE.Object3D) {
    this.group.add(this.partsGroup, this.plasma);
    this.marker = new THREE.Mesh(triGeo, new THREE.MeshBasicMaterial({ color: 0xff8a1f, depthTest: false, depthWrite: false }));
    this.marker.renderOrder = 20;
    parent.add(this.group, this.marker);
  }

  rebuild(v: Vessel): void {
    while (this.partsGroup.children.length) this.partsGroup.remove(this.partsGroup.children[0]);
    this.flames = [];
    this.chutes = [];
    for (const p of v.parts) {
      const obj = buildPartObject(p.def, CELL, p.flip);
      obj.position.set(p.cx, p.cy, 0);
      this.partsGroup.add(obj);
      if (p.def.engine) {
        const f = buildFlame();
        f.position.set(p.cx, p.cy - (p.def.h * CELL) / 2, 0);
        f.visible = false;
        this.partsGroup.add(f);
        this.flames.push({ part: p, obj: f });
      }
      if (p.def.parachute) {
        const c = buildCanopy();
        c.group.position.set(p.cx, p.cy + (p.def.h * CELL) / 2, 0);
        c.group.visible = false;
        this.partsGroup.add(c.group);
        this.chutes.push({ part: p, group: c.group, canopy: c.canopy, strings: c.strings });
      }
    }
    this.version = v.version;
  }

  dispose(parent: THREE.Object3D) {
    parent.remove(this.group, this.marker);
  }
}

export class FlightRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -100, 100);
  private world = new THREE.Group();
  private bg = new THREE.Color(0x000000);
  private stars: THREE.Points;
  private bodyViews = new Map<string, BodyView>();
  private vesselViews = new Map<number, VesselView>();
  private particles = new ParticlePool();
  private bodyOrbitLines = new Map<string, THREE.Line>();
  private soiLines = new Map<string, THREE.LineLoop>();
  private predLines: THREE.Line[] = [];
  private pad = new THREE.Group();
  private bodyIdx = new Map<string, number>();
  private frameBodies: { abs: { x: number; y: number }; theta: number }[] = [];
  private overlayCtx: CanvasRenderingContext2D | null;
  private navCtx: CanvasRenderingContext2D | null;

  width = 1;
  height = 1;
  private dpr = 1;
  mode: ViewMode = "flight";
  flightMpp = 0.07;
  mapMpp = 5000;
  mapFocusIdx = 0;
  private mapPan = { x: 0, y: 0 };
  private lastFocus = { x: 0, y: 0 };
  private pred: Prediction | null = null;
  private predAge = 99;
  private predDirty = true;

  constructor(
    canvas: HTMLCanvasElement,
    overlay: HTMLCanvasElement,
    navCanvas: HTMLCanvasElement | null,
    private sim: Simulation,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setClearColor(0x000000, 1);
    this.overlayCtx = overlay.getContext("2d");
    this.navCtx = navCanvas ? navCanvas.getContext("2d") : null;
    this.scene.background = this.bg;
    this.scene.add(this.camera);

    // stars follow the camera and stay fixed on screen
    const N = 500;
    const sp = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      sp[i * 3] = (Math.random() - 0.5) * 3600;
      sp[i * 3 + 1] = (Math.random() - 0.5) * 2400;
      sp[i * 3 + 2] = 0;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.BufferAttribute(sp, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, depthTest: false, depthWrite: false }));
    this.stars.renderOrder = 0;
    this.stars.frustumCulled = false;
    this.scene.add(this.stars);
    this.scene.add(this.world);

    BODY_LIST.forEach((b, i) => {
      this.bodyIdx.set(b.id, i);
      this.bodyViews.set(b.id, new BodyView(b, this.world));
      this.frameBodies.push({ abs: { x: 0, y: 0 }, theta: 0 });
      const o = bodyOrbit(b.id);
      if (o) {
        const pts = o.samplePoints(720);
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pts.length / 2 * 3).map((_, k) => (k % 3 === 2 ? 0 : pts[Math.floor(k / 3) * 2 + (k % 3)])), 3));
        const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x4a5668, transparent: true, opacity: 0.8, depthTest: false }));
        line.renderOrder = 3;
        line.frustumCulled = false;
        line.visible = false;
        this.world.add(line);
        this.bodyOrbitLines.set(b.id, line);
      }
      if (isFinite(b.soi)) {
        const cp: THREE.Vector3[] = [];
        for (let k = 0; k < 160; k++) cp.push(new THREE.Vector3(Math.cos((k / 160) * Math.PI * 2), Math.sin((k / 160) * Math.PI * 2), 0));
        const l = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(cp), new THREE.LineBasicMaterial({ color: 0x35607a, transparent: true, opacity: 0.55, depthTest: false }));
        l.scale.setScalar(b.soi);
        l.renderOrder = 3;
        l.frustumCulled = false;
        l.visible = false;
        this.world.add(l);
        this.soiLines.set(b.id, l);
      }
    });

    for (let i = 0; i < 6; i++) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(2100 * 3), 3));
      g.setDrawRange(0, 0);
      const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x5db2ff, depthTest: false }));
      line.renderOrder = 6;
      line.frustumCulled = false;
      line.visible = false;
      this.world.add(line);
      this.predLines.push(line);
    }

    // launch pad
    const padMat = new THREE.MeshBasicMaterial({ color: 0x59606c, depthTest: false, depthWrite: false });
    const towerMat = new THREE.MeshBasicMaterial({ color: 0x8a919d, depthTest: false, depthWrite: false });
    const redMat = new THREE.MeshBasicMaterial({ color: 0xe2483d, depthTest: false, depthWrite: false });
    const mk = (w: number, h: number, x: number, y: number, m: THREE.Material, order: number) => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
      mesh.position.set(x, y, 0);
      mesh.renderOrder = order;
      this.pad.add(mesh);
    };
    mk(36, 1.6, 0, -0.8, padMat, 4);
    mk(2.2, 44, 15, 21, towerMat, 4.1);
    mk(7, 0.6, 12, 30, towerMat, 4.1);
    mk(7, 0.6, 12, 14, towerMat, 4.1);
    mk(1, 2, 15, 45, redMat, 4.2);
    this.world.add(this.pad);
    this.world.add(this.particles.points);
  }

  // ------------------------------------------------------------------ public API

  resize(w: number, h: number, dpr: number): void {
    this.width = Math.max(1, w);
    this.height = Math.max(1, h);
    this.dpr = Math.min(2, dpr);
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(this.width, this.height, false);
    if (this.overlayCtx) {
      const c = this.overlayCtx.canvas;
      c.width = Math.floor(this.width * this.dpr);
      c.height = Math.floor(this.height * this.dpr);
    }
  }

  setMode(mode: ViewMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.mapPan = { x: 0, y: 0 };
    this.predDirty = true;
    if (mode === "map") {
      const v = this.sim.active;
      if (v) {
        const r = vlen(v.pos);
        this.mapMpp = Math.max(50, (r * 2.6) / Math.min(this.width, this.height));
        this.mapFocusIdx = 0;
      }
    }
  }

  invalidatePrediction(): void {
    this.predDirty = true;
  }

  /** Body id the map is focused on, or null when it follows the active vessel. */
  mapFocusBodyId(): string | null {
    return this.mapFocusIdx === 0 ? null : BODY_LIST[this.mapFocusIdx - 1].id;
  }

  cycleMapFocus(): string {
    this.mapFocusIdx = (this.mapFocusIdx + 1) % (BODY_LIST.length + 1);
    this.mapPan = { x: 0, y: 0 };
    return this.mapFocusIdx === 0 ? t("map.vessel") : bodyName(BODY_LIST[this.mapFocusIdx - 1].id);
  }

  zoom(deltaY: number): void {
    const f = Math.exp(deltaY * 0.0012);
    if (this.mode === "flight") this.flightMpp = Math.min(8000, Math.max(0.02, this.flightMpp * f));
    else this.mapMpp = Math.min(6e9, Math.max(20, this.mapMpp * f));
  }

  pan(dxPx: number, dyPx: number): void {
    if (this.mode !== "map") return;
    this.mapPan.x -= dxPx * this.mapMpp;
    this.mapPan.y += dyPx * this.mapMpp;
  }

  dispose(): void {
    this.renderer.dispose();
  }

  // ------------------------------------------------------------------ events & particles

  private toFixed(bodyId: string, x: number, y: number): [number, number] {
    const th = this.frameBodies[this.bodyIdx.get(bodyId)!].theta;
    const c = Math.cos(-th);
    const s = Math.sin(-th);
    return [x * c - y * s, x * s + y * c];
  }

  private burst(bodyId: string, x: number, y: number, count: number, speed: number, size: number, life: number, hotFrac: number) {
    const bi = this.bodyIdx.get(bodyId)!;
    const [fx, fy] = this.toFixed(bodyId, x, y);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = speed * (0.2 + Math.random());
      const hot = Math.random() < hotFrac ? 1 : 0;
      this.particles.spawn(bi, fx, fy, Math.cos(a) * sp, Math.sin(a) * sp, life * (0.5 + Math.random()), size * (0.6 + Math.random() * 0.8), 2.5, hot);
    }
  }

  private emitExhaust(v: Vessel, dt: number): void {
    const bi = this.bodyIdx.get(v.bodyId)!;
    const body = BODIES[v.bodyId];
    const th = this.frameBodies[bi].theta;
    const ca = Math.cos(v.angle - Math.PI / 2);
    const sa = Math.sin(v.angle - Math.PI / 2);
    const cf = Math.cos(-th);
    const sf = Math.sin(-th);
    const atmo = Math.min(1, v.density / 0.3);
    const svx = v.vel.x + body.omega * v.pos.y;
    const svy = v.vel.y - body.omega * v.pos.x;
    const rvx = svx * cf - svy * sf;
    const rvy = svx * sf + svy * cf;
    for (const p of v.engines) {
      if (p.thrustFrac < 0.02) continue;
      const lx = p.cx - v.com.x;
      const ly = p.cy - (p.def.h * CELL) / 2 - v.com.y;
      const wx = v.pos.x + lx * ca - ly * sa;
      const wy = v.pos.y + lx * sa + ly * ca;
      const fx = wx * cf - wy * sf;
      const fy = wx * sf + wy * cf;
      const wm = p.def.w * CELL;
      const rate = 90 * p.thrustFrac * (0.6 + wm * 0.3);
      const n = Math.floor(rate * dt + Math.random());
      const dir = v.angle - p.gimbal + Math.PI - th;
      for (let i = 0; i < n; i++) {
        const spread = (Math.random() - 0.5) * 0.18;
        const sp = (70 + Math.random() * 50) * (0.5 + 0.5 * p.thrustFrac) * (1 + (1 - atmo) * 2);
        const vx = rvx + Math.cos(dir + spread) * sp;
        const vy = rvy + Math.sin(dir + spread) * sp;
        this.particles.spawn(bi, fx, fy, vx, vy, (0.25 + Math.random() * 0.3) * (1 + (1 - atmo) * 0.4), wm * 0.45, 1.2, 1);
        if (atmo > 0.15 && Math.random() < 0.35) {
          this.particles.spawn(bi, fx, fy, vx * 0.25 + (Math.random() - 0.5) * 6, vy * 0.25 + (Math.random() - 0.5) * 6, 2 + Math.random() * 3, wm * 0.5, 3.5, 0);
        }
      }
    }
  }

  // ------------------------------------------------------------------ frame

  render(realDt: number): void {
    const sim = this.sim;
    const t = sim.time;
    const mapMode = this.mode === "map";
    const W = this.width;
    const H = this.height;

    // body frames for this instant
    BODY_LIST.forEach((b, i) => {
      const abs = bodyAbsPos(b.id, t);
      this.frameBodies[i].abs = abs;
      this.frameBodies[i].theta = b.omega * t;
    });

    // events -> particles
    const warp = sim.effectiveWarp;
    for (const e of sim.drainEvents()) {
      if (warp > 5) continue;
      if (e.type === "explosion") this.burst(e.bodyId, e.x, e.y, 160, 45, 3.5, 1.8, 0.6);
      else if (e.type === "separation" || e.type === "stage") this.burst(e.bodyId, e.x, e.y, 24, 14, 0.7, 0.6, 1);
      else if (e.type === "landed") this.burst(e.bodyId, e.x, e.y, 30, 5, 1.2, 1.5, 0);
    }

    // focus
    const active = sim.active;
    const absOf = (v: Vessel) => {
      const b = this.frameBodies[this.bodyIdx.get(v.bodyId)!].abs;
      return { x: b.x + v.pos.x, y: b.y + v.pos.y };
    };
    let base = this.lastFocus;
    if (active) base = absOf(active);
    this.lastFocus = base;
    let focus = base;
    if (mapMode) {
      if (this.mapFocusIdx > 0) base = this.frameBodies[this.mapFocusIdx - 1].abs;
      focus = { x: base.x + this.mapPan.x, y: base.y + this.mapPan.y };
    }
    const mpp = mapMode ? this.mapMpp : this.flightMpp;
    const hw = (W * mpp) / 2;
    const hh = (H * mpp) / 2;
    const cam = this.camera;
    if (cam.right !== hw || cam.top !== hh) {
      cam.left = -hw;
      cam.right = hw;
      cam.top = hh;
      cam.bottom = -hh;
      cam.updateProjectionMatrix();
    }
    const vr = Math.hypot(hw, hh);

    // world rotation (flight view keeps "up" at the top of the screen)
    let upAngle = Math.PI / 2;
    if (active) upAngle = Math.atan2(active.pos.y, active.pos.x);
    this.world.rotation.z = mapMode ? 0 : Math.PI / 2 - upAngle;

    // sky colour + stars
    let skyT = 0;
    if (active && !mapMode) {
      const b = BODIES[active.bodyId];
      if (b.atmo) {
        const alt = Math.max(0, vlen(active.pos) - b.radius);
        skyT = alt >= b.atmo.height ? 0 : Math.exp(-alt / (b.atmo.scaleH * 2.2));
        this.bg.set(0x000000).lerp(new THREE.Color(b.sky), skyT);
      } else this.bg.set(0x000000);
    } else this.bg.set(mapMode ? 0x07090d : 0x000000);
    (this.stars.material as THREE.PointsMaterial).opacity = mapMode ? 0.5 : Math.max(0, 1 - skyT * 1.6);
    this.stars.scale.setScalar(mpp);
    this.stars.position.set(0, 0, -5);

    // bodies
    for (const b of BODY_LIST) {
      const fb = this.frameBodies[this.bodyIdx.get(b.id)!];
      const cx = fb.abs.x - focus.x;
      const cy = fb.abs.y - focus.y;
      this.bodyViews.get(b.id)!.update(cx, cy, vr, mpp, mapMode);
      const ol = this.bodyOrbitLines.get(b.id);
      if (ol) {
        ol.visible = mapMode;
        const par = this.frameBodies[this.bodyIdx.get(b.parent!)!].abs;
        ol.position.set(par.x - focus.x, par.y - focus.y, 0);
      }
      const sl = this.soiLines.get(b.id);
      if (sl) {
        sl.visible = mapMode;
        sl.position.set(cx, cy, 0);
      }
    }

    // launch pad
    const earthFrame = this.frameBodies[this.bodyIdx.get("earth")!];
    const padAng = Math.PI / 2 + BODIES.earth.omega * t;
    const pr = BODIES.earth.radius;
    this.pad.visible = !mapMode && mpp < 40;
    this.pad.position.set(earthFrame.abs.x - focus.x + Math.cos(padAng) * pr, earthFrame.abs.y - focus.y + Math.sin(padAng) * pr, 0);
    this.pad.rotation.z = padAng - Math.PI / 2;

    // vessels
    const alive = new Set<number>();
    const flicker = 0.85 + Math.random() * 0.3;
    for (const v of sim.vessels) {
      alive.add(v.id);
      let view = this.vesselViews.get(v.id);
      if (!view) {
        view = new VesselView(this.world);
        this.vesselViews.set(v.id, view);
      }
      if (view.version !== v.version) view.rebuild(v);
      const a = absOf(v);
      const rx = a.x - focus.x;
      const ry = a.y - focus.y;
      const rot = v.angle - Math.PI / 2;
      const c = Math.cos(rot);
      const s = Math.sin(rot);
      // group origin = vessel frame origin; pos is the CoM
      view.group.position.set(rx - (v.com.x * c - v.com.y * s), ry - (v.com.x * s + v.com.y * c), 0);
      view.group.rotation.z = rot;
      const length = Math.max(1, v.maxY - v.minY);
      const small = mapMode || length / mpp < 14;
      view.group.visible = !small;
      view.marker.visible = small;
      view.marker.position.set(rx, ry, 0);
      view.marker.rotation.z = rot;
      const isActive = v.id === sim.activeId;
      view.marker.scale.setScalar(mpp * (isActive ? 9 : 6));
      (view.marker.material as THREE.MeshBasicMaterial).color.set(isActive ? 0xff8a1f : v.hasCommand ? 0x9fd0ff : 0x7b8494);
      if (!small) this.updateVesselView(view, v, flicker, realDt);
    }
    for (const [id, view] of this.vesselViews) {
      if (!alive.has(id)) {
        view.dispose(this.world);
        this.vesselViews.delete(id);
      }
    }

    // exhaust + particles
    if (warp <= 5 && !mapMode) {
      const dt = realDt * warp;
      for (const v of sim.vessels) {
        if (v.destroyed) continue;
        const fb = this.frameBodies[this.bodyIdx.get(v.bodyId)!].abs;
        if (Math.hypot(fb.x + v.pos.x - focus.x, fb.y + v.pos.y - focus.y) > vr * 1.5) continue;
        this.emitExhaust(v, dt);
      }
      this.particles.update(dt);
    } else if (warp > 5) this.particles.clear();
    this.particles.points.visible = !mapMode;
    if (!mapMode) {
      this.particles.write(
        (bi, px, py, out) => {
          const fb = this.frameBodies[bi];
          const c = Math.cos(fb.theta);
          const s = Math.sin(fb.theta);
          out[0] = fb.abs.x + px * c - py * s - focus.x;
          out[1] = fb.abs.y + px * s + py * c - focus.y;
          return true;
        },
        mpp,
        this.dpr,
      );
    }

    // map overlays
    this.predAge += realDt;
    const ctx = this.overlayCtx;
    if (ctx) {
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
    }
    for (const l of this.predLines) l.visible = false;
    if (mapMode) {
      if (this.predDirty || this.predAge > 0.3) {
        this.pred = sim.predict();
        this.predAge = 0;
        this.predDirty = false;
      }
      this.drawPrediction(focus, mpp, ctx);
      if (ctx) this.drawMapLabels(ctx, focus, mpp);
    }

    // navball
    if (this.navCtx && active) this.drawNav(active);

    this.renderer.render(this.scene, this.camera);
  }

  private updateVesselView(view: VesselView, v: Vessel, flicker: number, realDt: number): void {
    void realDt;
    const prApprox = Math.min(1, v.density / 1.0);
    for (const f of view.flames) {
      const p = f.part;
      if (p.thrustFrac > 0.02 && p.ignited) {
        f.obj.visible = true;
        const wm = p.def.w * CELL;
        const w = wm * 0.85 * (1 + 0.9 * (1 - prApprox));
        const l = wm * (1.2 + 2.6 * p.thrustFrac) * flicker * (1 + 0.5 * (1 - prApprox));
        f.obj.scale.set(w, l, 1);
        f.obj.rotation.z = -p.gimbal;
      } else f.obj.visible = false;
    }
    for (const c of view.chutes) {
      const p = c.part;
      if (!p.chuteDeployed) {
        c.group.visible = false;
        continue;
      }
      c.group.visible = true;
      const frac = Math.min(1, p.chuteT / p.def.parachute!.deploySeconds);
      const W = 16 * (0.15 + 0.85 * frac);
      const L = 10 * frac + 1;
      c.canopy.position.set(0, L, 0);
      c.canopy.scale.set(W, W * 0.55, 1);
      c.strings.scale.set(W, L, 1);
    }
    // re-entry plasma on the leading end
    const body = BODIES[v.bodyId];
    const svx = v.vel.x + body.omega * v.pos.y;
    const svy = v.vel.y - body.omega * v.pos.x;
    const rot = v.angle - Math.PI / 2;
    const uby = -svx * Math.sin(rot) + svy * Math.cos(rot);
    const op = Math.min(0.85, Math.max(0, v.heat * 1.8 - 0.05)) * flicker;
    (view.plasma.material as THREE.MeshBasicMaterial).opacity = op;
    view.plasma.visible = op > 0.01;
    let maxW = 3;
    for (const p of v.parts) maxW = Math.max(maxW, p.def.w * CELL);
    const top = uby > 0;
    view.plasma.position.set(0, top ? v.maxY : v.minY, 0);
    view.plasma.scale.set(maxW * 1.6, maxW * 1.1 * (1 + v.heat), 1);
  }

  private anchorOffset(bodyId: string, anchorT: number, refBody: string, focus: { x: number; y: number }) {
    const a = bodyAbsPos(bodyId, anchorT);
    const r0 = bodyAbsPos(refBody, anchorT);
    const rn = this.frameBodies[this.bodyIdx.get(refBody)!].abs;
    return { x: a.x - r0.x + rn.x - focus.x, y: a.y - r0.y + rn.y - focus.y, absX: a.x - r0.x + rn.x, absY: a.y - r0.y + rn.y };
  }

  private drawPrediction(focus: { x: number; y: number }, mpp: number, ctx: CanvasRenderingContext2D | null): void {
    const pred = this.pred;
    if (!pred || !pred.segments.length) return;
    const ref = pred.segments[0].bodyId;
    pred.segments.forEach((seg, i) => {
      const line = this.predLines[i];
      if (!line) return;
      const n = seg.pts.length / 2;
      if (n < 2) return;
      const off = this.anchorOffset(seg.bodyId, seg.anchorT, ref, focus);
      const step = Math.max(1, Math.ceil(n / 2000));
      const pos = line.geometry.getAttribute("position") as THREE.BufferAttribute;
      let k = 0;
      for (let j = 0; j < n && k < 2100; j += step) {
        pos.setXYZ(k++, seg.pts[j * 2] + off.x, seg.pts[j * 2 + 1] + off.y, 0);
      }
      pos.setXYZ(k++, seg.pts[(n - 1) * 2] + off.x, seg.pts[(n - 1) * 2 + 1] + off.y, 0);
      pos.needsUpdate = true;
      line.geometry.setDrawRange(0, k);
      line.visible = true;
      (line.material as THREE.LineBasicMaterial).color.set(seg.post ? 0xffa13d : seg.bodyId === ref ? 0x5db2ff : 0x6ee7a8);
    });
    if (!ctx) return;
    const W = this.width;
    const H = this.height;
    ctx.font = "11px ui-monospace, Menlo, monospace";
    ctx.textBaseline = "middle";
    for (const m of pred.markers) {
      const off = this.anchorOffset(m.bodyId, m.anchorT, ref, focus);
      const sx = W / 2 + (m.x + off.x) / mpp;
      const sy = H / 2 - (m.y + off.y) / mpp;
      if (sx < -50 || sx > W + 50 || sy < -50 || sy > H + 50) continue;
      const colors: Record<string, string> = { pe: "#35d9ee", ap: "#ffb347", enter: "#6ee7a8", exit: "#ffe066", impact: "#ff5d5d", node: "#4da3ff" };
      const col = colors[m.kind];
      ctx.strokeStyle = col;
      ctx.fillStyle = col;
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (m.kind === "impact") {
        ctx.moveTo(sx - 5, sy - 5);
        ctx.lineTo(sx + 5, sy + 5);
        ctx.moveTo(sx + 5, sy - 5);
        ctx.lineTo(sx - 5, sy + 5);
        ctx.stroke();
      } else if (m.kind === "node") {
        ctx.arc(sx, sy, 8, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillRect(sx - 2, sy - 2, 4, 4);
      } else if (m.kind === "enter" || m.kind === "exit") {
        ctx.arc(sx, sy, 6, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.arc(sx, sy, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      let text = m.label;
      const dtm = m.t - this.sim.time;
      if (m.kind === "pe" || m.kind === "ap" || m.kind === "enter" || m.kind === "exit" || m.kind === "node") text += `  T${dtm >= 0 ? "-" : "+"}${formatTime(Math.abs(dtm))}`;
      ctx.fillStyle = "rgba(10,13,18,0.7)";
      const tw = ctx.measureText(text).width;
      ctx.fillRect(sx + 10, sy - 8, tw + 8, 16);
      ctx.fillStyle = col;
      ctx.fillText(text, sx + 14, sy);
    }
  }

  private drawMapLabels(ctx: CanvasRenderingContext2D, focus: { x: number; y: number }, mpp: number): void {
    const W = this.width;
    const H = this.height;
    ctx.font = "12px ui-sans-serif, system-ui, sans-serif";
    ctx.textBaseline = "alphabetic";
    BODY_LIST.forEach((b, i) => {
      const fb = this.frameBodies[i].abs;
      const sx = W / 2 + (fb.x - focus.x) / mpp;
      const sy = H / 2 - (fb.y - focus.y) / mpp;
      if (sx < -80 || sx > W + 80 || sy < -80 || sy > H + 80) return;
      const rpx = Math.max(b.radius / mpp, 3);
      ctx.fillStyle = "rgba(220,228,240,0.9)";
      ctx.fillText(bodyName(b.id), sx + rpx + 6, sy - rpx - 2);
    });
    for (const v of this.sim.vessels) {
      const b = this.frameBodies[this.bodyIdx.get(v.bodyId)!].abs;
      const sx = W / 2 + (b.x + v.pos.x - focus.x) / mpp;
      const sy = H / 2 - (b.y + v.pos.y - focus.y) / mpp;
      if (sx < 0 || sx > W || sy < 0 || sy > H) continue;
      if (v.id === this.sim.activeId || v.hasCommand) {
        ctx.fillStyle = v.id === this.sim.activeId ? "#ffb066" : "#9fd0ff";
        ctx.fillText(vesselName(v.name), sx + 12, sy + 16);
      }
    }
    void formatDistance;
  }

  private drawNav(v: Vessel): void {
    const sim = this.sim;
    const ref = sim.speedSurface ? v.surfaceVel(BODIES[v.bodyId]) : v.vel;
    const sp = Math.hypot(ref.x, ref.y);
    const d: NavData = {
      angle: v.angle,
      upAngle: Math.atan2(v.pos.y, v.pos.x),
      velAngle: sp > 0.5 ? Math.atan2(ref.y, ref.x) : null,
      nodeAngle: sim.node && sim.node.bodyId === v.bodyId ? v.nodeAngle : null,
      mode: sim.speedSurface ? t("fl.navSurf") : t("fl.navOrbit"),
    };
    drawNavball(this.navCtx!, this.navCtx!.canvas.width, d);
  }
}
