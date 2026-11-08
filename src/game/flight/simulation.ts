// World simulation: time warp, SOI transitions, staging, maneuver nodes and telemetry.

import type { Blueprint } from "../core/types";
import { G0, vlen, type Vec2 } from "../core/math";
import { Orbit } from "../physics/orbit";
import { BODIES, CHILDREN, bodyRelState, pressureRatio } from "../physics/solar";
import { normalize } from "../vab/grid";
import { burnFrame, predictTrajectory, type PredNode, type Prediction } from "./prediction";
import { Vessel, estimateDeltaV, type SasMode, type SimEvent, type StageDv } from "./vessel";
import { bodyName, msg, partName, tm, vesselName, type Msg } from "../../i18n/game";

export const WARP_LEVELS = [1, 2, 5, 10, 50, 100, 1000, 10000, 100000];
export const PHYS_WARP_MAX = 5;
const PHYS_DT = 0.02;

export interface ManeuverNode {
  time: number;
  bodyId: string;
  prograde: number;
  radial: number;
  burned: number;
  dirAngle: number | null;
}

export interface Toast {
  id: number;
  text: string;
  kind: "info" | "good" | "bad";
}

export interface Telemetry {
  time: number;
  warp: number;
  warpIndex: number;
  warpNote: string;
  name: string;
  bodyName: string;
  bodyId: string;
  altitude: number;
  speed: number;
  orbitalSpeed: number;
  verticalSpeed: number;
  horizontalSpeed: number;
  mass: number;
  twr: number;
  thrust: number;
  throttle: number;
  fuel: number;
  fuelCap: number;
  heat: number;
  gForce: number;
  dynQ: number;
  density: number;
  landed: boolean;
  sas: SasMode;
  rcs: boolean;
  speedSurface: boolean;
  orbit: null | { pe: number; ap: number; e: number; period: number; incl: number; hyperbolic: boolean };
  dv: { stages: StageDv[]; total: number };
  stages: { stage: number; names: string[] }[];
  vessels: { id: number; name: string; active: boolean; body: string; landed: boolean }[];
  node: null | { time: number; prograde: number; radial: number; total: number; remaining: number; eta: number; burnTime: number };
  lost: string | null;
  hasVessel: boolean;
}

export class Simulation {
  time = 0;
  vessels: Vessel[] = [];
  activeId: number | null = null;
  warpIndex = 0;
  effectiveWarp = 1;
  warpNoteMsg: Msg | null = null;
  warpTarget: number | null = null;
  node: ManeuverNode | null = null;
  events: SimEvent[] = [];
  toasts: Toast[] = [];
  speedSurface = true;
  lost: Msg | null = null;
  listVersion = 0;
  private nextId = 1;
  private toastId = 1;
  private hooks = {
    emit: (e: SimEvent) => {
      this.events.push(e);
      if (e.text) {
        const kind = e.type === "explosion" || e.type === "chuteCut" ? "bad" : e.type === "landed" ? "good" : "info";
        this.toast(e.text, kind);
      }
    },
  };

  constructor(bp: Blueprint) {
    const v = Vessel.fromBlueprint(normalize(bp), this.nextId++, "earth");
    const body = BODIES.earth;
    v.pos = { x: 0, y: body.radius + v.comHeight };
    v.vel = { x: -body.omega * v.pos.y, y: 0 };
    v.angle = Math.PI / 2;
    v.sasHold = v.angle;
    v.angVel = body.omega;
    v.landed = true;
    v.sas = "stability";
    this.vessels.push(v);
    this.activeId = v.id;
  }

  get active(): Vessel | null {
    return this.vessels.find((v) => v.id === this.activeId) ?? null;
  }

  toast(text: string, kind: Toast["kind"] = "info") {
    this.toasts.push({ id: this.toastId++, text, kind });
  }

  drainEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  // ------------------------------------------------------------------ warp

  setWarpIndex(i: number) {
    this.warpIndex = Math.max(0, Math.min(WARP_LEVELS.length - 1, i));
    this.warpTarget = null;
  }

  private limitWarp(requested: number, realDt: number): number {
    this.warpNoteMsg = null;
    if (requested <= PHYS_WARP_MAX) return requested;
    let lim = requested;
    let note: Msg | null = null;
    for (const v of this.vessels) {
      if (v.destroyed) continue;
      if (v.id !== this.activeId && !v.hasCommand) continue;
      const body = BODIES[v.bodyId];
      const r = vlen(v.pos);
      const alt = r - body.radius;
      const burning = v.estimateThrust(pressureRatio(body, Math.max(alt, 0))) > 0 && (v.throttle > 0 || v.engines.some((e) => e.def.engine!.solid && e.ignited && e.fuel > 0));
      if (burning) {
        lim = Math.min(lim, PHYS_WARP_MAX);
        note = msg("warp.engines");
        continue;
      }
      if (v.landed) continue;
      if (body.atmo && alt < body.atmo.height) {
        lim = Math.min(lim, PHYS_WARP_MAX);
        note = msg("warp.atmo");
        continue;
      }
      const orbit = Orbit.fromState(v.pos.x, v.pos.y, v.vel.x, v.vel.y, body.mu, this.time);
      const hazard = body.radius + (body.atmo ? body.atmo.height : 0) + 200;
      if (orbit.periapsis < hazard && r > hazard) {
        const tt = orbit.timeToRadiusInbound(this.time, hazard);
        if (tt !== null) {
          const l = (0.3 * tt) / realDt;
          if (l < lim) {
            lim = l;
            note = msg("warp.approach", { bodyB: body.id });
          }
        }
      }
    }
    if (lim < requested) this.warpNoteMsg = note;
    return Math.max(1, lim);
  }

  // ------------------------------------------------------------------ main update

  update(realDt: number): void {
    if (!this.vessels.length) return;
    realDt = Math.min(realDt, 0.1);
    const requested = WARP_LEVELS[this.warpIndex];
    let warp = this.limitWarp(requested, realDt);
    if (this.warpTarget !== null) {
      const remaining = this.warpTarget - this.time;
      if (remaining <= 0.5) {
        this.warpTarget = null;
        this.warpIndex = 0;
        warp = 1;
      } else {
        warp = Math.min(warp, Math.max(1, (remaining * 0.5) / realDt));
      }
    }
    this.effectiveWarp = warp;
    this.refreshNodeDirection();
    const total = realDt * warp;
    if (warp <= PHYS_WARP_MAX + 1e-9) {
      const n = Math.max(1, Math.ceil(total / PHYS_DT));
      const dt = total / n;
      for (let i = 0; i < n; i++) this.physicsStep(dt);
    } else {
      const n = Math.min(400, Math.max(1, Math.ceil(total / 120)));
      const dt = total / n;
      for (let i = 0; i < n; i++) this.railStep(dt);
      this.cleanup();
    }
  }

  private physicsStep(dt: number): void {
    for (const v of [...this.vessels]) {
      const body = BODIES[v.bodyId];
      if (v.id !== this.activeId) {
        v.steerInput = 0;
        v.rcsX = 0;
        v.rcsY = 0;
        v.throttle = 0;
      }
      v.step(dt, body, this.hooks);
      if (v.id === this.activeId && this.node && v.thrust > 0) this.node.burned += (v.thrust / v.mass) * dt;
    }
    this.time += dt;
    for (const v of this.vessels) if (!v.destroyed && !v.landed) this.checkSOI(v);
    this.cleanup();
    this.checkNodeDone();
  }

  private railStep(dt: number): void {
    for (const v of this.vessels) {
      if (v.destroyed) continue;
      const body = BODIES[v.bodyId];
      v.heat *= Math.exp(-0.05 * dt);
      if (v.landed) {
        const ang = Math.atan2(v.pos.y, v.pos.x) + body.omega * dt;
        const rr = vlen(v.pos);
        v.pos.x = Math.cos(ang) * rr;
        v.pos.y = Math.sin(ang) * rr;
        v.vel.x = -body.omega * v.pos.y;
        v.vel.y = body.omega * v.pos.x;
        v.angle = ang;
        v.sasHold = ang;
        continue;
      }
      if (!v.railOrbit) v.railOrbit = Orbit.fromState(v.pos.x, v.pos.y, v.vel.x, v.vel.y, body.mu, this.time);
      const s = v.railOrbit.stateAt(this.time + dt);
      v.pos.x = s.x;
      v.pos.y = s.y;
      v.vel.x = s.vx;
      v.vel.y = s.vy;
      v.angVel = 0;
      if (v.id !== this.activeId && !v.hasCommand && Math.hypot(s.x, s.y) < body.radius + (body.atmo ? body.atmo.height * 0.4 : 0)) {
        v.destroyed = true; // untracked debris is silently lost when its orbit intersects the planet
        continue;
      }
      if (v.sas !== "off" && v.sas !== "stability" && v.id === this.activeId) v.angle = v.sasAngle();
      else if (v.sas === "stability") v.angle = v.sasHold;
    }
    this.time += dt;
    for (const v of this.vessels) if (!v.destroyed && !v.landed) this.checkSOI(v);
  }

  private checkSOI(v: Vessel): void {
    const b = BODIES[v.bodyId];
    const r = vlen(v.pos);
    if (b.parent && r > b.soi) {
      const rs = bodyRelState(b.id, this.time);
      v.pos.x += rs.x;
      v.pos.y += rs.y;
      v.vel.x += rs.vx;
      v.vel.y += rs.vy;
      v.bodyId = b.parent;
      v.railOrbit = null;
      if (v.id === this.activeId) this.toast(tm(msg("sim.soiLeave", { fromB: b.id, toB: b.parent })));
      if (this.node && v.id === this.activeId && this.node.bodyId !== v.bodyId) this.node = null;
      return;
    }
    for (const c of CHILDREN[b.id]) {
      const rs = bodyRelState(c.id, this.time);
      if (Math.hypot(v.pos.x - rs.x, v.pos.y - rs.y) < c.soi) {
        v.pos.x -= rs.x;
        v.pos.y -= rs.y;
        v.vel.x -= rs.vx;
        v.vel.y -= rs.vy;
        v.bodyId = c.id;
        v.railOrbit = null;
        if (v.id === this.activeId) this.toast(tm(msg("sim.soiEnter", { bodyB: c.id })), "good");
        if (this.node && v.id === this.activeId && this.node.bodyId !== v.bodyId) this.node = null;
        return;
      }
    }
  }

  private cleanup(): void {
    if (!this.vessels.some((v) => v.destroyed)) return;
    const activeDead = this.vessels.find((v) => v.id === this.activeId && v.destroyed);
    this.vessels = this.vessels.filter((v) => !v.destroyed);
    if (activeDead) {
      const next = this.vessels.find((v) => v.hasCommand);
      this.node = null;
      if (next) {
        this.activeId = next.id;
        this.toast(tm(msg("sim.switched", { vesselV: next.name })));
      } else {
        this.activeId = null;
        this.lost = activeDead.destroyReason ?? msg("lost.default");
      }
    }
    this.listVersion++;
    // limit debris
    const debris = this.vessels.filter((v) => v.id !== this.activeId && !v.hasCommand);
    while (debris.length > 14) {
      const old = debris.shift()!;
      this.vessels = this.vessels.filter((v) => v !== old);
    }
  }

  // ------------------------------------------------------------------ controls

  activateStage(): void {
    const v = this.active;
    if (!v) return;
    const groups = v.stageGroups();
    if (!groups.length) {
      this.toast(tm(msg("sim.noMoreStages")), "info");
      return;
    }
    const g = groups[0];
    const seps = [];
    for (const p of g.parts) {
      p.fired = true;
      if (p.def.engine) p.ignited = true;
      else if (p.def.parachute) p.chuteDeployed = true;
      else if (p.def.separator) seps.push(p);
    }
    for (const sep of seps) {
      const owner = sep.owner;
      const nv = owner.split(sep, this.nextId++);
      if (!nv) continue;
      this.vessels.push(nv);
      this.listVersion++;
      this.events.push({ type: "separation", bodyId: nv.bodyId, x: nv.pos.x, y: nv.pos.y });
      if (nv.hasCommand && !owner.hasCommand && owner.id === this.activeId) {
        this.activeId = nv.id;
        nv.throttle = owner.throttle;
      }
    }
    this.events.push({ type: "stage", bodyId: v.bodyId, x: v.pos.x, y: v.pos.y });
    this.toast(tm(msg("sim.stageActivated", { n: g.stage + 1 })));
  }

  cycleVessel(dir: number): void {
    const list = this.vessels.filter((v) => !v.destroyed);
    if (list.length < 2) return;
    const i = list.findIndex((v) => v.id === this.activeId);
    const next = list[(i + dir + list.length) % list.length];
    this.activeId = next.id;
    this.node = null;
    this.listVersion++;
  }

  selectVessel(id: number): void {
    if (this.vessels.some((v) => v.id === id)) {
      this.activeId = id;
      this.node = null;
      this.listVersion++;
    }
  }

  // ------------------------------------------------------------------ maneuver nodes

  createNode(): void {
    const v = this.active;
    if (!v || v.landed) return;
    const body = BODIES[v.bodyId];
    const o = Orbit.fromState(v.pos.x, v.pos.y, v.vel.x, v.vel.y, body.mu, this.time);
    const dt = isFinite(o.period) ? Math.max(60, o.period / 8) : 300;
    this.node = { time: this.time + dt, bodyId: v.bodyId, prograde: 0, radial: 0, burned: 0, dirAngle: null };
  }

  deleteNode(): void {
    this.node = null;
  }

  /** Move the node to the next periapsis / apoapsis. */
  snapNodeTo(kind: "pe" | "ap"): void {
    const v = this.active;
    if (!v || !this.node) return;
    const body = BODIES[v.bodyId];
    const o = Orbit.fromState(v.pos.x, v.pos.y, v.vel.x, v.vel.y, body.mu, this.time);
    const dt = kind === "pe" ? o.timeToPeriapsis(this.time) : o.timeToApoapsis(this.time);
    if (dt !== null) this.node.time = this.time + Math.max(dt, 5);
  }

  /** Set up a Hohmann-style burn at the node time to move the opposite apsis to `targetAlt`. */
  hohmannTo(targetAlt: number): void {
    const v = this.active;
    if (!v || !this.node) return;
    const body = BODIES[v.bodyId];
    const o = Orbit.fromState(v.pos.x, v.pos.y, v.vel.x, v.vel.y, body.mu, this.time);
    const s = o.stateAt(this.node.time);
    const r = Math.hypot(s.x, s.y);
    const rt = body.radius + targetAlt;
    const aT = (r + rt) / 2;
    const vT = Math.sqrt(body.mu * (2 / r - 1 / aT));
    const vNow = Math.hypot(s.vx, s.vy);
    this.node.prograde = vT - vNow;
    this.node.radial = 0;
  }

  /**
   * Scan departure times along the current (near-circular) orbit for a Hohmann-style burn that
   * produces an encounter with `targetId` (a child of the current body). Places a maneuver node.
   */
  planTransfer(targetId: string): boolean {
    const v = this.active;
    const target = BODIES[targetId];
    if (!v || v.landed || !target || !target.orbit || target.parent !== v.bodyId) {
      this.toast(tm(target?.parent ? msg("sim.needOrbit", { bodyB: target.parent }) : msg("sim.needOrbitParent")));
      return false;
    }
    const body = BODIES[v.bodyId];
    const o = Orbit.fromState(v.pos.x, v.pos.y, v.vel.x, v.vel.y, body.mu, this.time);
    if (o.isHyperbolic || o.e > 0.25 || o.periapsis < body.radius + (body.atmo?.height ?? 0)) {
      this.toast(tm(msg("sim.planNear")));
      return false;
    }
    const rt = target.orbit.a;
    const desiredPe = Math.max(60000, target.radius * 0.6);
    const evaluate = (t: number) => {
      const s = o.stateAt(t);
      const r = Math.hypot(s.x, s.y);
      const vNow = Math.hypot(s.vx, s.vy);
      const aT = (r + rt) / 2;
      const dv = Math.sqrt(body.mu * (2 / r - 1 / aT)) - vNow;
      if (dv <= 0) return null;
      const pred = predictTrajectory(v.bodyId, v.pos.x, v.pos.y, v.vel.x, v.vel.y, this.time, { time: t, bodyId: v.bodyId, prograde: dv, radial: 0 }, 2500);
      const seg = pred.segments.find((sg) => sg.bodyId === targetId);
      if (!seg || seg.pts.length < 4) return null;
      let minR = Infinity;
      for (let i = 0; i < seg.pts.length; i += 2) minR = Math.min(minR, Math.hypot(seg.pts[i], seg.pts[i + 1]));
      const pe = minR - target.radius;
      return { dv, pe, score: Math.abs(pe - desiredPe) + (pe < 20000 ? 1e7 : 0) };
    };
    const period = o.period;
    const coarse = Math.max(2, period / 220);
    let best: { t: number; dv: number; score: number } | null = null;
    const start = this.time + 90;
    for (let t = start; t < start + period * 1.02; t += coarse) {
      const e = evaluate(t);
      if (e && (!best || e.score < best.score)) best = { t, dv: e.dv, score: e.score };
    }
    if (!best) {
      this.toast(tm(msg("sim.noWindow")), "bad");
      return false;
    }
    const centre = best.t;
    for (let t = centre - coarse; t <= centre + coarse; t += coarse / 12) {
      if (t < this.time + 30) continue;
      const e = evaluate(t);
      if (e && e.score < best.score) best = { t, dv: e.dv, score: e.score };
    }
    this.node = { time: best.t, bodyId: v.bodyId, prograde: best.dv, radial: 0, burned: 0, dirAngle: null };
    this.toast(tm(msg("sim.nodePlaced", { dv: best.dv.toFixed(0) })), "good");
    return true;
  }

  private nodeDvTotal(): number {
    return this.node ? Math.hypot(this.node.prograde, this.node.radial) : 0;
  }

  /** Node as seen by the predictor: only the not-yet-burned part, never in the past. */
  effectiveNode(): PredNode | null {
    const n = this.node;
    if (!n) return null;
    const total = this.nodeDvTotal();
    if (total < 1e-6) return { time: n.time, bodyId: n.bodyId, prograde: 0, radial: 0 };
    const k = Math.max(0, total - n.burned) / total;
    return { time: Math.max(n.time, this.time), bodyId: n.bodyId, prograde: n.prograde * k, radial: n.radial * k };
  }

  private refreshNodeDirection(): void {
    const v = this.active;
    const n = this.node;
    if (!v || !n || v.bodyId !== n.bodyId) {
      if (v) v.nodeAngle = null;
      return;
    }
    if (n.burned > 0 && n.dirAngle !== null) {
      v.nodeAngle = n.dirAngle;
      return;
    }
    const body = BODIES[v.bodyId];
    const o = Orbit.fromState(v.pos.x, v.pos.y, v.vel.x, v.vel.y, body.mu, this.time);
    const s = o.stateAt(Math.max(n.time, this.time));
    const f = burnFrame(s.vx, s.vy, o.sgn);
    const dx = n.prograde * f.px + n.radial * f.rx;
    const dy = n.prograde * f.py + n.radial * f.ry;
    if (Math.hypot(dx, dy) < 1e-6) {
      v.nodeAngle = Math.atan2(s.vy, s.vx);
      return;
    }
    n.dirAngle = Math.atan2(dy, dx);
    v.nodeAngle = n.dirAngle;
  }

  private checkNodeDone(): void {
    const n = this.node;
    if (!n) return;
    const total = this.nodeDvTotal();
    if (n.burned > 0 && n.burned >= total - 0.3) {
      this.node = null;
      this.toast(tm(msg("sim.nodeDone")), "good");
    }
  }

  warpToNode(leadSeconds = 30): void {
    if (!this.node) return;
    const target = this.node.time - leadSeconds;
    if (target <= this.time + 1) return;
    this.warpTarget = target;
    this.warpIndex = WARP_LEVELS.length - 1;
  }

  // ------------------------------------------------------------------ prediction

  predict(): Prediction | null {
    const v = this.active;
    if (!v || v.landed) return null;
    return predictTrajectory(v.bodyId, v.pos.x, v.pos.y, v.vel.x, v.vel.y, this.time, this.effectiveNode());
  }

  // ------------------------------------------------------------------ telemetry

  telemetry(): Telemetry {
    const v = this.active;
    const base = {
      time: this.time,
      warp: this.effectiveWarp,
      warpIndex: this.warpIndex,
      warpNote: this.warpNoteMsg ? tm(this.warpNoteMsg) : "",
      speedSurface: this.speedSurface,
      lost: this.lost ? tm(this.lost) : null,
      vessels: this.vessels.map((x) => ({ id: x.id, name: vesselName(x.name), active: x.id === this.activeId, body: bodyName(x.bodyId), landed: x.landed })),
    };
    if (!v) {
      return {
        ...base,
        name: "—",
        bodyName: "—",
        bodyId: "earth",
        altitude: 0,
        speed: 0,
        orbitalSpeed: 0,
        verticalSpeed: 0,
        horizontalSpeed: 0,
        mass: 0,
        twr: 0,
        thrust: 0,
        throttle: 0,
        fuel: 0,
        fuelCap: 1,
        heat: 0,
        gForce: 0,
        dynQ: 0,
        density: 0,
        landed: false,
        sas: "off",
        rcs: false,
        orbit: null,
        dv: { stages: [], total: 0 },
        stages: [],
        node: null,
        hasVessel: false,
      };
    }
    const body = BODIES[v.bodyId];
    const r = vlen(v.pos);
    const ux = v.pos.x / r;
    const uy = v.pos.y / r;
    const sv = v.surfaceVel(body);
    const ref: Vec2 = this.speedSurface ? sv : v.vel;
    const vSpeed = ref.x * ux + ref.y * uy;
    const hSpeed = ref.x * -uy + ref.y * ux;
    const alt = v.altitude(body);
    const pr = pressureRatio(body, Math.max(0, r - body.radius));
    const savedThrottle = v.throttle;
    v.throttle = 1;
    const maxThrust = v.estimateThrust(pr);
    v.throttle = savedThrottle;
    const g = body.mu / (r * r);
    let orbit: Telemetry["orbit"] = null;
    if (!v.landed) {
      const o = Orbit.fromState(v.pos.x, v.pos.y, v.vel.x, v.vel.y, body.mu, this.time);
      const spin = body.omega !== 0 ? Math.sign(body.omega) : (body.orbit?.sgn ?? -1);
      orbit = {
        pe: o.periapsis - body.radius,
        ap: o.isHyperbolic ? Infinity : o.apoapsis - body.radius,
        e: o.e,
        period: o.period,
        incl: o.inclinationFor(spin),
        hyperbolic: o.isHyperbolic,
      };
    }
    let node: Telemetry["node"] = null;
    if (this.node && this.node.bodyId === v.bodyId) {
      const total = this.nodeDvTotal();
      const remaining = Math.max(0, total - this.node.burned);
      const burnTime = maxThrust > 0 ? remaining / (maxThrust / v.mass) : Infinity;
      node = { time: this.node.time, prograde: this.node.prograde, radial: this.node.radial, total, remaining, eta: this.node.time - this.time, burnTime };
    }
    return {
      ...base,
      name: vesselName(v.name),
      bodyName: bodyName(body.id),
      bodyId: body.id,
      altitude: alt,
      speed: vlen(ref),
      orbitalSpeed: vlen(v.vel),
      verticalSpeed: vSpeed,
      horizontalSpeed: hSpeed,
      mass: v.mass,
      twr: maxThrust / (v.mass * g),
      thrust: v.thrust,
      throttle: v.throttle,
      fuel: v.fuelMass,
      fuelCap: Math.max(1, v.fuelCapacity),
      heat: v.heat,
      gForce: v.gForce,
      dynQ: v.dynQ,
      density: v.density,
      landed: v.landed,
      sas: v.sas,
      rcs: v.rcsOn,
      orbit,
      dv: estimateDeltaV(v, G0),
      stages: v.stageGroups().map((gp) => ({ stage: gp.stage, names: gp.parts.map((p) => partName(p.def.id, p.def.name)) })),
      node,
      hasVessel: true,
    };
  }
}
