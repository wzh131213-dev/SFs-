// Runtime vessel: parts graph, mass properties, engines, fuel flow, aerodynamics,
// attitude control, ground contact and stage separation.

import type { Blueprint, BodyDef, PartDef } from "../core/types";
import { CELL, G0, clamp, lerp, wrapPi, type Vec2 } from "../core/math";
import { getDef } from "../data/parts";
import { analyze } from "../vab/grid";
import { Orbit } from "../physics/orbit";
import { atmosphereDensity, pressureRatio } from "../physics/solar";
import { msg, tm, type Msg } from "../../i18n/game";

export type SasMode = "off" | "stability" | "prograde" | "retrograde" | "radialOut" | "radialIn" | "maneuver";

export interface SimEvent {
  type: "explosion" | "message" | "landed" | "separation" | "stage" | "chuteCut";
  bodyId: string;
  x: number;
  y: number;
  text?: string;
}

export interface StepHooks {
  emit(e: SimEvent): void;
}

export interface PartRT {
  uid: number;
  def: PartDef;
  gx: number;
  gy: number;
  /** Centre of the part in the vessel frame, metres (y up). */
  cx: number;
  cy: number;
  flip: boolean;
  fuel: number;
  stage: number;
  parent: PartRT | null;
  children: PartRT[];
  nbrs: Set<PartRT>;
  fired: boolean;
  ignited: boolean;
  thrustFrac: number;
  gimbal: number;
  chuteDeployed: boolean;
  chuteT: number;
  expTop: number;
  expBot: number;
  owner: Vessel;
}

export const sideAreaOf = (d: PartDef): number => d.aero.sideArea ?? d.w * d.h * CELL * CELL * 0.8;

const MAX_ANG_VEL = 6;
const HEAT_CAPACITY = 2.2e6;
const HEAT_COOLING = 0.03;

export class Vessel {
  id: number;
  name: string;
  bodyId: string;
  pos: Vec2 = { x: 0, y: 0 };
  vel: Vec2 = { x: 0, y: 0 };
  angle = Math.PI / 2;
  angVel = 0;
  parts: PartRT[] = [];
  version = 0;

  mass = 1;
  com: Vec2 = { x: 0, y: 0 };
  inertia = 1;
  minY = 0;
  maxY = 0;
  private massInit = false;

  throttle = 0;
  steerInput = 0;
  sas: SasMode = "stability";
  sasHold = Math.PI / 2;
  sasSurface = true;
  nodeAngle: number | null = null;
  rcsOn = false;
  rcsX = 0;
  rcsY = 0;

  landed = false;
  heat = 0;
  destroyed = false;
  destroyReason: Msg | null = null;
  railOrbit: Orbit | null = null;

  engines: PartRT[] = [];
  tanks: PartRT[] = [];
  chutes: PartRT[] = [];
  rcsParts: PartRT[] = [];
  legCount = 0;
  hasShield = false;
  torqueTotal = 0;
  feeders = new Map<number, PartRT[]>();

  // Outputs from the last physics step (for HUD / renderer)
  thrust = 0;
  gForce = 0;
  dynQ = 0;
  density = 0;
  private chuteBreak: PartRT[] = [];

  constructor(id: number, name: string, bodyId: string) {
    this.id = id;
    this.name = name;
    this.bodyId = bodyId;
  }

  static fromBlueprint(bp: Blueprint, id: number, bodyId: string): Vessel {
    const a = analyze(bp);
    const v = new Vessel(id, bp.name, bodyId);
    const byId = new Map<number, PartRT>();
    for (const p of bp.parts) {
      const def = getDef(p.defId);
      const cx = (p.gx + def.w / 2) * CELL;
      const cy = (p.gy + def.h / 2) * CELL;
      byId.set(p.id, {
        uid: p.id,
        def,
        gx: p.gx,
        gy: p.gy,
        cx,
        cy,
        flip: !!def.radial && cx < 0,
        fuel: def.fuel ?? 0,
        stage: p.stage,
        parent: null,
        children: [],
        nbrs: new Set(),
        fired: false,
        ignited: false,
        thrustFrac: 0,
        gimbal: 0,
        chuteDeployed: false,
        chuteT: 0,
        expTop: 1,
        expBot: 1,
        owner: v,
      });
    }
    for (const p of bp.parts) {
      const rt = byId.get(p.id)!;
      const par = a.parent.get(p.id);
      if (par !== null && par !== undefined) {
        rt.parent = byId.get(par)!;
        rt.parent.children.push(rt);
      }
      for (const n of a.adj.get(p.id) ?? []) rt.nbrs.add(byId.get(n)!);
      v.parts.push(rt);
    }
    v.rebuild();
    v.recomputeMass();
    return v;
  }

  /** Recompute caches after any structural change. */
  rebuild(): void {
    this.engines = this.parts.filter((p) => p.def.engine);
    this.tanks = this.parts.filter((p) => p.def.category === "tank");
    this.chutes = this.parts.filter((p) => p.def.parachute);
    this.rcsParts = this.parts.filter((p) => p.def.rcs);
    this.legCount = this.parts.filter((p) => p.def.leg).length;
    this.hasShield = this.parts.some((p) => p.def.heatShield);
    this.torqueTotal = this.parts.reduce((s, p) => s + (p.def.torque ?? 0), 0);
    this.feeders.clear();
    for (const p of [...this.engines, ...this.rcsParts]) {
      if (p.def.engine?.solid) continue;
      const order: PartRT[] = [];
      const seen = new Set<PartRT>([p]);
      const queue: PartRT[] = [p];
      while (queue.length) {
        const cur = queue.shift()!;
        if (cur.def.separator) continue; // separators block propellant crossfeed
        for (const n of cur.nbrs) {
          if (seen.has(n)) continue;
          seen.add(n);
          queue.push(n);
          if (n.def.category === "tank") order.push(n);
        }
      }
      this.feeders.set(p.uid, order);
    }
    // aerodynamic exposure of the top / bottom face of every part
    for (const p of this.parts) {
      p.expTop = 1 - this.coverage(p, true);
      p.expBot = 1 - this.coverage(p, false);
    }
    this.version++;
  }

  private coverage(p: PartRT, above: boolean): number {
    const iv: [number, number][] = [];
    for (const q of this.parts) {
      if (q === p) continue;
      const ok = above ? q.gy >= p.gy + p.def.h : q.gy + q.def.h <= p.gy;
      if (!ok) continue;
      const x0 = Math.max(p.gx, q.gx);
      const x1 = Math.min(p.gx + p.def.w, q.gx + q.def.w);
      if (x1 > x0) iv.push([x0, x1]);
    }
    iv.sort((a, b) => a[0] - b[0]);
    let covered = 0;
    let curEnd = -Infinity;
    for (const [a, b] of iv) {
      const s = Math.max(a, curEnd);
      if (b > s) covered += b - s;
      curEnd = Math.max(curEnd, b);
    }
    return clamp(covered / p.def.w, 0, 1);
  }

  get hasCommand(): boolean {
    return this.parts.some((p) => p.def.category === "command");
  }

  get fuelMass(): number {
    let f = 0;
    for (const p of this.parts) f += p.fuel;
    return f;
  }

  get fuelCapacity(): number {
    let f = 0;
    for (const p of this.parts) f += p.def.fuel ?? 0;
    return f;
  }

  /** Recompute mass, centre of mass, inertia. Keeps the physical body fixed in space. */
  recomputeMass(): void {
    let m = 0;
    let sx = 0;
    let sy = 0;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of this.parts) {
      const pm = p.def.mass + p.fuel;
      m += pm;
      sx += pm * p.cx;
      sy += pm * p.cy;
      minY = Math.min(minY, p.cy - (p.def.h * CELL) / 2);
      maxY = Math.max(maxY, p.cy + (p.def.h * CELL) / 2);
    }
    if (m <= 0) return;
    const nx = sx / m;
    const ny = sy / m;
    if (this.massInit) {
      const dx = nx - this.com.x;
      const dy = ny - this.com.y;
      if (dx !== 0 || dy !== 0) {
        const c = Math.cos(this.angle - Math.PI / 2);
        const s = Math.sin(this.angle - Math.PI / 2);
        this.pos.x += dx * c - dy * s;
        this.pos.y += dx * s + dy * c;
      }
    }
    this.massInit = true;
    this.com.x = nx;
    this.com.y = ny;
    this.mass = m;
    let I = 0;
    for (const p of this.parts) {
      const pm = p.def.mass + p.fuel;
      const rx = p.cx - nx;
      const ry = p.cy - ny;
      const w = p.def.w * CELL;
      const h = p.def.h * CELL;
      I += pm * (rx * rx + ry * ry + (w * w + h * h) / 12);
    }
    this.inertia = Math.max(I, 1);
    this.minY = minY;
    this.maxY = maxY;
  }

  /** Height of the CoM above the lowest point when standing upright. */
  get comHeight(): number {
    return this.com.y - this.minY;
  }

  altitude(body: BodyDef): number {
    return Math.hypot(this.pos.x, this.pos.y) - body.radius - this.comHeight;
  }

  private hasFuelFor(p: PartRT): boolean {
    if (p.def.engine?.solid) return p.fuel > 0;
    const list = this.feeders.get(p.uid);
    if (!list) return false;
    for (const t of list) if (t.fuel > 0) return true;
    return false;
  }

  private drawFuel(p: PartRT, amount: number): number {
    if (amount <= 0) return 0;
    if (p.def.engine?.solid) {
      const g = Math.min(p.fuel, amount);
      p.fuel -= g;
      return g;
    }
    const list = this.feeders.get(p.uid);
    if (!list) return 0;
    let need = amount;
    for (const t of list) {
      if (t.fuel <= 0) continue;
      const g = Math.min(t.fuel, need);
      t.fuel -= g;
      need -= g;
      if (need <= 1e-12) break;
    }
    return amount - need;
  }

  /** Thrust (N) the ignited engines could produce right now at the given pressure ratio. */
  estimateThrust(pr: number): number {
    let T = 0;
    for (const p of this.engines) {
      const e = p.def.engine!;
      if (!p.ignited || !this.hasFuelFor(p)) continue;
      const thr = e.solid ? 1 : this.throttle;
      T += thr * (e.thrust / (e.ispVac * G0)) * lerp(e.ispVac, e.ispSl, pr) * G0;
    }
    return T;
  }

  /** Unfired stageable parts grouped by stage index (ascending). */
  stageGroups(): { stage: number; parts: PartRT[] }[] {
    const map = new Map<number, PartRT[]>();
    for (const p of this.parts) {
      if (p.stage < 0 || p.fired) continue;
      if (!(p.def.engine || p.def.separator || p.def.parachute)) continue;
      if (!map.has(p.stage)) map.set(p.stage, []);
      map.get(p.stage)!.push(p);
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([stage, parts]) => ({ stage, parts }));
  }

  // ---------------------------------------------------------------- control

  private sasTarget(): number {
    const vrel: Vec2 = this.sasSurface ? this.surfaceVel(null) : this.vel;
    const sp = Math.hypot(vrel.x, vrel.y);
    switch (this.sas) {
      case "prograde":
        return sp > 0.5 ? Math.atan2(vrel.y, vrel.x) : this.sasHold;
      case "retrograde":
        return sp > 0.5 ? Math.atan2(vrel.y, vrel.x) + Math.PI : this.sasHold;
      case "radialOut":
        return Math.atan2(this.pos.y, this.pos.x);
      case "radialIn":
        return Math.atan2(this.pos.y, this.pos.x) + Math.PI;
      case "maneuver":
        return this.nodeAngle ?? this.sasHold;
      default:
        return this.sasHold;
    }
  }

  private bodyOmega = 0;

  surfaceVel(body: BodyDef | null): Vec2 {
    const om = body ? body.omega : this.bodyOmega;
    return { x: this.vel.x + om * this.pos.y, y: this.vel.y - om * this.pos.x };
  }

  /** Target attitude angle for the current SAS mode (used by on-rails time warp). */
  sasAngle(): number {
    return this.sasTarget();
  }

  // ---------------------------------------------------------------- stepping

  step(dt: number, body: BodyDef, hooks: StepHooks): void {
    if (this.destroyed) return;
    this.bodyOmega = body.omega;
    this.recomputeMass();

    const r = Math.hypot(this.pos.x, this.pos.y);
    const ux = this.pos.x / r;
    const uy = this.pos.y / r;
    const surfAlt = r - body.radius;
    const rho = atmosphereDensity(body, surfAlt);
    const pr = pressureRatio(body, surfAlt);
    const gLocal = body.mu / (r * r);
    this.density = rho;

    if (this.landed) {
      const thrustEst = this.estimateThrust(pr);
      if (thrustEst / this.mass > gLocal * 1.02) {
        this.landed = false;
      } else {
        // burn fuel but stay put; ride the rotating surface
        this.computeThrust(dt, pr, 0, true);
        const ang = Math.atan2(this.pos.y, this.pos.x) + body.omega * dt;
        const rr = body.radius + this.comHeight;
        this.pos.x = Math.cos(ang) * rr;
        this.pos.y = Math.sin(ang) * rr;
        this.vel.x = -body.omega * this.pos.y;
        this.vel.y = body.omega * this.pos.x;
        this.angle = ang;
        this.angVel = body.omega;
        this.sasHold = ang;
        this.thrust = 0;
        this.gForce = 1;
        this.dynQ = 0;
        return;
      }
    }

    // ---- attitude command (SAS + manual)
    const rcsTorqueMax = this.rcsOn ? this.rcsParts.reduce((s, p) => s + p.def.rcs!.thrust * 1.5, 0) : 0;
    let gimbalAuth = 0;
    for (const p of this.engines) {
      const e = p.def.engine!;
      if (!p.ignited || e.solid || e.gimbal <= 0 || this.throttle <= 0 || !this.hasFuelFor(p)) continue;
      const T = this.throttle * (e.thrust / (e.ispVac * G0)) * lerp(e.ispVac, e.ispSl, pr) * G0;
      gimbalAuth += T * Math.sin((e.gimbal * Math.PI) / 180) * Math.abs(p.cy - (p.def.h * CELL) / 2 - this.com.y);
    }
    const alphaMax = (this.torqueTotal + rcsTorqueMax + gimbalAuth) / this.inertia;
    let steer = this.steerInput;
    if (this.sas !== "off") {
      if (Math.abs(this.steerInput) > 0.01) {
        this.sasHold = this.angle;
      } else if (alphaMax > 1e-6) {
        const err = wrapPi(this.sasTarget() - this.angle);
        const wn = Math.min(3, Math.sqrt(0.5 * alphaMax));
        steer = clamp((wn * wn * err - 2 * wn * this.angVel) / alphaMax, -1, 1);
      }
    }

    // ---- thrust
    const th = this.computeThrust(dt, pr, steer, true);
    let fbx = th.fx;
    let fby = th.fy;
    let torque = th.torque;
    this.thrust = th.total;

    // ---- control torque (reaction wheels + RCS)
    torque += steer * (this.torqueTotal + rcsTorqueMax * th.rcsFrac);

    // ---- relative air velocity
    const sv = { x: this.vel.x + body.omega * this.pos.y, y: this.vel.y - body.omega * this.pos.x };
    const speed = Math.hypot(sv.x, sv.y);
    const ca = Math.cos(this.angle - Math.PI / 2);
    const sa = Math.sin(this.angle - Math.PI / 2);
    let wfx = 0;
    let wfy = 0;
    this.dynQ = 0.5 * rho * speed * speed;

    if (rho > 1e-7 && speed > 0.01) {
      // body-frame velocity of the vessel relative to the air at its CoM
      const ubx = sv.x * ca + sv.y * sa;
      const uby = -sv.x * sa + sv.y * ca;
      for (const p of this.parts) {
        const rx = p.cx - this.com.x;
        const ry = p.cy - this.com.y;
        const ux2 = ubx - this.angVel * ry;
        const uy2 = uby + this.angVel * rx;
        const area = sideAreaOf(p.def);
        const lift = p.def.aero.lift ?? 0;
        const wm = p.def.w * CELL;
        const circ = Math.PI * (wm / 2) * (wm / 2);
        const exp = uy2 > 0 ? p.expTop : p.expBot;
        const cd = uy2 > 0 ? p.def.aero.cdTop : p.def.aero.cdBottom;
        const axialArea = exp * circ * cd + 0.03 * area;
        const fy = -0.5 * rho * Math.abs(uy2) * uy2 * axialArea;
        const um = Math.hypot(ux2, uy2);
        let fx = -0.5 * rho * Math.abs(ux2) * ux2 * 1.1 * area;
        if (lift > 0) fx += -0.5 * rho * um * ux2 * lift * area;
        fbx += fx;
        fby += fy;
        torque += rx * fy - ry * fx;
      }
    }

    // ---- parachutes
    this.chuteBreak.length = 0;
    if (rho > 1e-7) {
      for (const p of this.chutes) {
        if (!p.chuteDeployed) continue;
        p.chuteT += dt;
        const frac = clamp(p.chuteT / p.def.parachute!.deploySeconds, 0, 1);
        const q = this.dynQ;
        if (q > 20000 && frac > 0.05) {
          this.chuteBreak.push(p);
          continue;
        }
        const k = -0.5 * rho * speed * p.def.parachute!.dragArea * frac * frac;
        wfx += k * sv.x;
        wfy += k * sv.y;
      }
    } else {
      for (const p of this.chutes) if (p.chuteDeployed) p.chuteT += dt;
    }

    // ---- heating
    let flux = 0;
    if (rho > 1e-7) {
      flux = 1.74e-4 * Math.sqrt(rho) * speed * speed * speed;
      const ubx = sv.x * ca + sv.y * sa;
      const uby = -sv.x * sa + sv.y * ca;
      if (this.hasShield && uby < 0 && Math.abs(ubx) < 0.5 * Math.abs(uby)) flux *= 0.15;
    }
    this.heat = Math.max(0, this.heat + (flux / HEAT_CAPACITY - HEAT_COOLING * this.heat) * dt);

    // ---- assemble world acceleration (non-gravitational)
    const fwx = fbx * ca - fby * sa + wfx;
    const fwy = fbx * sa + fby * ca + wfy;
    const m = this.mass;
    const ax = fwx / m;
    const ay = fwy / m;
    this.gForce = Math.hypot(ax, ay) / G0;

    // RK4 with gravity; external accel held constant over the step
    const mu = body.mu;
    const grav = (x: number, y: number, out: Vec2) => {
      const rr2 = x * x + y * y;
      const k = -mu / (rr2 * Math.sqrt(rr2));
      out.x = k * x + ax;
      out.y = k * y + ay;
    };
    const a1: Vec2 = { x: 0, y: 0 };
    const a2: Vec2 = { x: 0, y: 0 };
    const a3: Vec2 = { x: 0, y: 0 };
    const a4: Vec2 = { x: 0, y: 0 };
    const px = this.pos.x;
    const py = this.pos.y;
    const vx = this.vel.x;
    const vy = this.vel.y;
    grav(px, py, a1);
    const p2x = px + vx * dt * 0.5;
    const p2y = py + vy * dt * 0.5;
    const v2x = vx + a1.x * dt * 0.5;
    const v2y = vy + a1.y * dt * 0.5;
    grav(p2x, p2y, a2);
    const p3x = px + v2x * dt * 0.5;
    const p3y = py + v2y * dt * 0.5;
    const v3x = vx + a2.x * dt * 0.5;
    const v3y = vy + a2.y * dt * 0.5;
    grav(p3x, p3y, a3);
    const p4x = px + v3x * dt;
    const p4y = py + v3y * dt;
    const v4x = vx + a3.x * dt;
    const v4y = vy + a3.y * dt;
    grav(p4x, p4y, a4);
    this.pos.x = px + (dt / 6) * (vx + 2 * v2x + 2 * v3x + v4x);
    this.pos.y = py + (dt / 6) * (vy + 2 * v2y + 2 * v3y + v4y);
    this.vel.x = vx + (dt / 6) * (a1.x + 2 * a2.x + 2 * a3.x + a4.x);
    this.vel.y = vy + (dt / 6) * (a1.y + 2 * a2.y + 2 * a3.y + a4.y);

    // ---- rotation
    this.angVel = clamp(this.angVel + (torque / this.inertia) * dt, -MAX_ANG_VEL, MAX_ANG_VEL);
    this.angle = wrapPi(this.angle + this.angVel * dt);

    // ---- parachute tear-off
    if (this.chuteBreak.length) {
      for (const p of this.chuteBreak) {
        hooks.emit({ type: "chuteCut", bodyId: this.bodyId, x: this.pos.x, y: this.pos.y, text: tm(msg("ev.chuteCut")) });
        this.removePart(p);
      }
      this.chuteBreak.length = 0;
    }

    // ---- destruction by heat
    if (this.heat >= 1) {
      this.destroy(msg("lost.reentry"), hooks);
      return;
    }

    // ---- ground contact
    this.contact(body, hooks, ux, uy);
    void uy;
  }

  private computeThrust(dt: number, pr: number, steer: number, consume: boolean) {
    let fx = 0;
    let fy = 0;
    let torque = 0;
    let total = 0;
    for (const p of this.engines) {
      const e = p.def.engine!;
      p.thrustFrac = 0;
      if (!p.ignited) continue;
      const thr = e.solid ? 1 : this.throttle;
      if (thr <= 0 || !this.hasFuelFor(p)) {
        p.gimbal = 0;
        continue;
      }
      const mdot = (e.thrust / (e.ispVac * G0)) * thr;
      let frac = 1;
      if (consume) {
        const need = mdot * dt;
        frac = need > 0 ? this.drawFuel(p, need) / need : 0;
      }
      const T = mdot * frac * lerp(e.ispVac, e.ispSl, pr) * G0;
      p.thrustFrac = frac * thr;
      const gim = e.solid ? 0 : steer * ((e.gimbal * Math.PI) / 180);
      p.gimbal = gim;
      const Fx = T * Math.sin(gim);
      const Fy = T * Math.cos(gim);
      const rx = p.cx - this.com.x;
      const ry = p.cy - (p.def.h * CELL) / 2 - this.com.y;
      fx += Fx;
      fy += Fy;
      torque += rx * Fy - ry * Fx;
      total += T;
    }
    // RCS
    let rcsFrac = 0;
    if (this.rcsOn && this.rcsParts.length) {
      const use = Math.min(1, 0.5 * Math.abs(this.rcsX) + 0.5 * Math.abs(this.rcsY) + 0.5 * Math.abs(steer));
      if (use > 0.01) {
        let tot = 0;
        let got = 0;
        for (const p of this.rcsParts) {
          const rc = p.def.rcs!;
          const need = ((rc.thrust * use) / (rc.isp * G0)) * dt;
          const g = consume ? this.drawFuel(p, need) : need;
          tot += rc.thrust;
          got += need > 0 ? (g / need) * rc.thrust : 0;
        }
        rcsFrac = tot > 0 ? got / tot : 0;
        const tt = tot * 0.5 * rcsFrac;
        fx += this.rcsX * tt;
        fy += this.rcsY * tt;
      }
    }
    return { fx, fy, torque, total, rcsFrac };
  }

  private contact(body: BodyDef, hooks: StepHooks, ux: number, uy: number): void {
    const r = Math.hypot(this.pos.x, this.pos.y);
    if (r - body.radius > 120) return;
    const upx = this.pos.x / r;
    const upy = this.pos.y / r;
    void ux;
    void uy;
    const c = Math.cos(this.angle - Math.PI / 2);
    const s = Math.sin(this.angle - Math.PI / 2);
    let minDot = Infinity;
    for (const p of this.parts) {
      const hw = (p.def.w * CELL) / 2;
      const hh = (p.def.h * CELL) / 2;
      for (let i = 0; i < 4; i++) {
        const dx = p.cx + (i & 1 ? hw : -hw) - this.com.x;
        const dy = p.cy + (i & 2 ? hh : -hh) - this.com.y;
        const ox = dx * c - dy * s;
        const oy = dx * s + dy * c;
        const d = ox * upx + oy * upy;
        if (d < minDot) minDot = d;
      }
    }
    const gap = r + minDot - body.radius;
    if (gap > 0) return;
    const sv = this.surfaceVel(body);
    const vr = sv.x * upx + sv.y * upy;
    if (vr >= 0) return;
    const speed = Math.hypot(sv.x, sv.y);
    const tilt = Math.abs(wrapPi(this.angle - Math.atan2(upy, upx)));
    const tol = 8 + (this.legCount >= 2 ? 6 : 0) + (this.parts.some((p) => p.def.leg) ? 0 : 0);
    if (speed > tol || (tilt > 0.6 && speed > 2.5)) {
      this.destroy(speed > tol ? msg("lost.crashed", { v: speed.toFixed(1) }) : msg("lost.tipped"), hooks);
      return;
    }
    // soft touchdown
    const ang = Math.atan2(upy, upx);
    const rr = body.radius + this.comHeight;
    this.landed = true;
    this.pos.x = Math.cos(ang) * rr;
    this.pos.y = Math.sin(ang) * rr;
    this.vel.x = -body.omega * this.pos.y;
    this.vel.y = body.omega * this.pos.x;
    this.angle = ang;
    this.angVel = body.omega;
    this.sasHold = ang;
    this.throttle = this.hasCommand ? this.throttle : 0;
    this.railOrbit = null;
    hooks.emit({ type: "landed", bodyId: this.bodyId, x: this.pos.x, y: this.pos.y, text: tm(msg("ev.landed", { bodyB: body.id, v: speed.toFixed(1) })) });
  }

  destroy(reason: Msg, hooks: StepHooks): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.destroyReason = reason;
    hooks.emit({ type: "explosion", bodyId: this.bodyId, x: this.pos.x, y: this.pos.y, text: tm(msg("ev.explosion", { vesselV: this.name, reasonM: reason })) });
  }

  removePart(p: PartRT): void {
    this.parts = this.parts.filter((q) => q !== p);
    for (const n of p.nbrs) n.nbrs.delete(p);
    if (p.parent) p.parent.children = p.parent.children.filter((c) => c !== p);
    this.rebuild();
    this.recomputeMass();
  }

  // ---------------------------------------------------------------- staging

  /** Detach the subtree rooted at `sep` into a new vessel. */
  split(sep: PartRT, newId: number): Vessel | null {
    if (!sep.parent) return null;
    const sub = new Set<PartRT>();
    const stack: PartRT[] = [sep];
    while (stack.length) {
      const cur = stack.pop()!;
      sub.add(cur);
      for (const c of cur.children) stack.push(c);
    }
    sep.parent.children = sep.parent.children.filter((c) => c !== sep);
    sep.parent = null;
    for (const p of sub) {
      for (const n of [...p.nbrs]) {
        if (!sub.has(n)) {
          p.nbrs.delete(n);
          n.nbrs.delete(p);
        }
      }
    }
    this.recomputeMass();
    const oldPos = { x: this.pos.x, y: this.pos.y };
    const vel0 = { x: this.vel.x, y: this.vel.y };

    this.parts = this.parts.filter((p) => !sub.has(p));
    const nv = new Vessel(newId, "Debris", this.bodyId);
    nv.parts = [...sub];
    for (const p of nv.parts) p.owner = this;
    for (const p of nv.parts) p.owner = nv;
    nv.pos = { ...oldPos };
    nv.vel = { ...vel0 };
    nv.angle = this.angle;
    nv.angVel = this.angVel;
    nv.com = { ...this.com };
    nv.massInit = true;
    nv.sas = "off";
    nv.sasHold = this.angle;
    nv.heat = this.heat;
    nv.landed = false;
    this.landed = false;
    this.railOrbit = null;
    nv.rebuild();
    this.rebuild();
    this.recomputeMass();
    nv.recomputeMass();

    for (const w of [this, nv]) {
      const ox = w.pos.x - oldPos.x;
      const oy = w.pos.y - oldPos.y;
      w.vel.x = vel0.x - this.angVel * oy;
      w.vel.y = vel0.y + this.angVel * ox;
    }
    const dx = nv.pos.x - this.pos.x;
    const dy = nv.pos.y - this.pos.y;
    let dl = Math.hypot(dx, dy);
    let dirx = dx / (dl || 1);
    let diry = dy / (dl || 1);
    if (dl < 1e-6) {
      dirx = -Math.cos(this.angle);
      diry = -Math.sin(this.angle);
      dl = 1;
    }
    const imp = sep.def.separator?.impulse ?? 2;
    const mk = this.mass;
    const md = nv.mass;
    this.vel.x -= (dirx * imp * md) / (mk + md);
    this.vel.y -= (diry * imp * md) / (mk + md);
    nv.vel.x += (dirx * imp * mk) / (mk + md);
    nv.vel.y += (diry * imp * mk) / (mk + md);
    if (nv.hasCommand && !this.hasCommand) nv.name = this.name;
    else nv.name = nv.hasCommand ? this.name + " B" : "Debris";
    nv.sas = nv.hasCommand ? "stability" : "off";
    return nv;
  }
}

// ======================================================================= Δv

export interface StageDv {
  stage: number;
  dv: number;
  twr: number;
  burnTime: number;
  startMass: number;
}

/** Non-destructive staging simulation producing per-stage Δv (vacuum) and initial TWR. */
export function estimateDeltaV(v: Vessel, surfaceG = 9.8): { stages: StageDv[]; total: number } {
  const alive = new Set<PartRT>(v.parts);
  const fuel = new Map<PartRT, number>();
  for (const p of v.parts) fuel.set(p, p.fuel);
  const ignited = new Set<PartRT>(v.parts.filter((p) => p.ignited));
  const stages: StageDv[] = [];

  const burn = (label: number) => {
    const usableTanks = new Set<PartRT>();
    const active: PartRT[] = [];
    for (const e of ignited) {
      if (!alive.has(e)) continue;
      if (e.def.engine!.solid) {
        if ((fuel.get(e) ?? 0) > 0) active.push(e);
        continue;
      }
      const seen = new Set<PartRT>([e]);
      const queue: PartRT[] = [e];
      let found = false;
      while (queue.length) {
        const cur = queue.shift()!;
        if (cur.def.separator) continue;
        for (const n of cur.nbrs) {
          if (!alive.has(n) || seen.has(n)) continue;
          seen.add(n);
          queue.push(n);
          if (n.def.category === "tank" && (fuel.get(n) ?? 0) > 0) {
            usableTanks.add(n);
            found = true;
          }
        }
      }
      if (found) active.push(e);
    }
    if (!active.length) return;
    let F = 0;
    for (const t of usableTanks) F += fuel.get(t)!;
    let thrust = 0;
    let mdot = 0;
    for (const e of active) {
      const s = e.def.engine!;
      thrust += s.thrust;
      mdot += s.thrust / (s.ispVac * G0);
      if (s.solid) F += fuel.get(e)!;
    }
    let m0 = 0;
    for (const p of alive) m0 += p.def.mass + (fuel.get(p) ?? 0);
    if (F <= 0 || mdot <= 0 || m0 <= F) return;
    const ve = thrust / mdot;
    stages.push({ stage: label, dv: ve * Math.log(m0 / (m0 - F)), twr: thrust / (m0 * surfaceG), burnTime: F / mdot, startMass: m0 });
    for (const t of usableTanks) fuel.set(t, 0);
    for (const e of active) if (e.def.engine!.solid) fuel.set(e, 0);
  };

  burn(-1);
  const stageIds = [...new Set(v.parts.filter((p) => p.stage >= 0 && !p.fired && (p.def.engine || p.def.separator)).map((p) => p.stage))].sort((a, b) => a - b);
  for (const s of stageIds) {
    for (const p of v.parts) {
      if (p.stage !== s || p.fired || !alive.has(p)) continue;
      if (p.def.separator) {
        const stack: PartRT[] = [p];
        while (stack.length) {
          const cur = stack.pop()!;
          alive.delete(cur);
          for (const c of cur.children) stack.push(c);
        }
      } else if (p.def.engine) ignited.add(p);
    }
    burn(s);
  }
  return { stages, total: stages.reduce((a, b) => a + b.dv, 0) };
}

export interface BlueprintStats {
  mass: number;
  fuel: number;
  dryMass: number;
  com: Vec2;
  cop: Vec2;
  stable: boolean;
  parts: number;
  height: number;
  width: number;
  dv: { stages: StageDv[]; total: number };
  twr: number;
  hasCommand: boolean;
}

/** Statistics shown in the VAB; coordinates of com / cop are in grid cells. */
export function blueprintStats(bp: Blueprint): BlueprintStats | null {
  if (!bp.parts.length) return null;
  const v = Vessel.fromBlueprint(bp, 0, "earth");
  const dv = estimateDeltaV(v);
  let wsum = 0;
  let cy = 0;
  for (const p of v.parts) {
    const w = sideAreaOf(p.def) * (1 + (p.def.aero.lift ?? 0));
    wsum += w;
    cy += w * p.cy;
  }
  const copY = wsum > 0 ? cy / wsum : v.com.y;
  let minX = Infinity;
  let maxX = -Infinity;
  for (const p of v.parts) {
    minX = Math.min(minX, p.cx - (p.def.w * CELL) / 2);
    maxX = Math.max(maxX, p.cx + (p.def.w * CELL) / 2);
  }
  const fuel = v.fuelMass;
  return {
    mass: v.mass,
    fuel,
    dryMass: v.mass - fuel,
    com: { x: v.com.x / CELL, y: v.com.y / CELL },
    cop: { x: 0, y: copY / CELL },
    stable: copY < v.com.y,
    parts: v.parts.length,
    height: v.maxY - v.minY,
    width: maxX - minX,
    dv,
    twr: dv.stages.length ? dv.stages[0].twr : 0,
    hasCommand: v.hasCommand,
  };
}
