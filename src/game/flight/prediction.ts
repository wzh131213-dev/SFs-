// Patched-conic trajectory prediction with SOI transitions and maneuver node support.

import { formatDistance } from "../core/math";
import { Orbit, type StateOut } from "../physics/orbit";
import { BODIES, CHILDREN, bodyRelState } from "../physics/solar";
import { msg, tm, type Msg } from "../../i18n/game";

export interface PredNode {
  time: number;
  bodyId: string;
  prograde: number;
  radial: number;
}

export interface PredSegment {
  bodyId: string;
  /** Time at which the segment's frame body position is used as the drawing anchor. */
  anchorT: number;
  pts: number[];
  post: boolean;
}

export interface PredMarker {
  kind: "pe" | "ap" | "enter" | "exit" | "impact" | "node";
  bodyId: string;
  anchorT: number;
  x: number;
  y: number;
  t: number;
  /** Translatable description; `label` renders it in the language that is active when read. */
  msg: Msg;
  readonly label: string;
}

function marker(kind: PredMarker["kind"], bodyId: string, anchorT: number, x: number, y: number, t: number, m: Msg): PredMarker {
  return {
    kind,
    bodyId,
    anchorT,
    x,
    y,
    t,
    msg: m,
    get label() {
      return tm(m);
    },
  };
}

export interface Prediction {
  segments: PredSegment[];
  markers: PredMarker[];
  orbit: Orbit;
  encounter: string | null;
}

/** Prograde / radial-out unit vectors for an orbit state. */
export function burnFrame(vx: number, vy: number, sgn: number) {
  const l = Math.hypot(vx, vy) || 1;
  const px = vx / l;
  const py = vy / l;
  return { px, py, rx: sgn * py, ry: -sgn * px };
}

export function predictTrajectory(
  bodyId: string,
  px: number,
  py: number,
  vx: number,
  vy: number,
  t0: number,
  node: PredNode | null,
  maxSteps = 5000,
): Prediction {
  const segments: PredSegment[] = [];
  const markers: PredMarker[] = [];
  let body = BODIES[bodyId];
  let x = px;
  let y = py;
  let ux = vx;
  let uy = vy;
  let t = t0;
  let nodePending = !!node && node.bodyId === bodyId;
  let post = false;
  let first: Orbit | null = null;
  let encounter: string | null = null;
  let steps = 0;
  const st: StateOut = { x: 0, y: 0, vx: 0, vy: 0 };
  const cs: StateOut = { x: 0, y: 0, vx: 0, vy: 0 };

  for (let segIndex = 0; segIndex < 6 && steps < maxSteps; segIndex++) {
    const orbit = Orbit.fromState(x, y, ux, uy, body.mu, t);
    if (!first) first = orbit;
    const segBody = body;
    const ts = t;
    const anchorT = segIndex === 0 ? t0 : t;
    const period = orbit.period;
    const closed = isFinite(period);
    const horizon = closed ? ts + period * 3 : ts + 1e13;
    const recordUntil = closed ? ts + period : Infinity;
    const pts: number[] = [];

    const tpe = orbit.timeToPeriapsis(ts);
    if (tpe !== null && orbit.periapsis > segBody.radius) {
      const pp = orbit.periapsisPos();
      markers.push(marker("pe", segBody.id, anchorT, pp.x, pp.y, ts + tpe, msg("mk.pe", { d: formatDistance(orbit.periapsis - segBody.radius) })));
    }
    const tap = orbit.timeToApoapsis(ts);
    if (tap !== null) {
      const ap = orbit.apoapsisPos();
      markers.push(marker("ap", segBody.id, anchorT, ap.x, ap.y, ts + tap, msg("mk.ap", { d: formatDistance(orbit.apoapsis - segBody.radius) })));
    }

    let finished = false;
    while (steps < maxSteps) {
      orbit.stateAt(t, st);
      const r = Math.hypot(st.x, st.y);
      if (t <= recordUntil) pts.push(st.x, st.y);

      if (r <= segBody.radius) {
        markers.push(marker("impact", segBody.id, anchorT, st.x, st.y, t, msg("mk.impact", { bodyB: segBody.id })));
        finished = true;
        break;
      }
      if (segBody.parent && r > segBody.soi) {
        const rel = bodyRelState(segBody.id, t, cs);
        const parent = BODIES[segBody.parent];
        markers.push(marker("exit", segBody.id, anchorT, st.x, st.y, t, msg("mk.escape", { bodyB: segBody.id })));
        x = st.x + rel.x;
        y = st.y + rel.y;
        ux = st.vx + rel.vx;
        uy = st.vy + rel.vy;
        body = parent;
        break;
      }
      let entered = false;
      for (const c of CHILDREN[segBody.id]) {
        bodyRelState(c.id, t, cs);
        if (Math.hypot(st.x - cs.x, st.y - cs.y) < c.soi) {
          x = st.x - cs.x;
          y = st.y - cs.y;
          ux = st.vx - cs.vx;
          uy = st.vy - cs.vy;
          markers.push(marker("enter", segBody.id, anchorT, st.x, st.y, t, msg("mk.encounter", { bodyB: c.id })));
          if (!encounter) encounter = c.name;
          body = c;
          entered = true;
          break;
        }
      }
      if (entered) break;
      if (nodePending && node && t >= node.time - 1e-6) {
        const f = burnFrame(st.vx, st.vy, orbit.sgn);
        x = st.x;
        y = st.y;
        ux = st.vx + node.prograde * f.px + node.radial * f.rx;
        uy = st.vy + node.prograde * f.py + node.radial * f.ry;
        nodePending = false;
        post = true;
        markers.push(marker("node", segBody.id, anchorT, st.x, st.y, t, msg("mk.node")));
        break;
      }
      if (t >= horizon) {
        finished = true;
        break;
      }
      const speed = Math.hypot(st.vx, st.vy);
      let dt = (0.03 * r) / Math.max(speed, 1);
      if (closed) dt = Math.min(dt, period / 60);
      for (const c of CHILDREN[segBody.id]) {
        bodyRelState(c.id, t, cs);
        const rs = Math.max(Math.hypot(st.vx - cs.vx, st.vy - cs.vy), 1);
        const dist = Math.hypot(st.x - cs.x, st.y - cs.y);
        dt = Math.min(dt, Math.max((dist - c.soi) / (2 * rs), c.soi / (8 * rs)));
      }
      if (nodePending && node) {
        const dn = node.time - t;
        if (dn > 1e-6) dt = Math.min(dt, dn);
      }
      t += Math.max(dt, 1e-3);
      steps++;
    }
    segments.push({ bodyId: segBody.id, anchorT, pts, post });
    if (finished) break;
  }
  return { segments, markers, orbit: first!, encounter };
}
