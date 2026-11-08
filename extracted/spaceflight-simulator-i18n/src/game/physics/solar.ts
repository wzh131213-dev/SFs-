// Celestial body database + analytic ("on rails") body ephemerides.

import type { BodyDef } from "../core/types";
import { Orbit, type StateOut } from "./orbit";

const MU_SUN = 1.28e18;
const MU_EARTH = 3.528e12; // g = 9.8 m/s^2 at R = 600 km
const MU_MOON = 4.15e10; // g = 1.62 m/s^2 at R = 160 km
const MU_MARS = 4.29e11; // g = 3.71 m/s^2 at R = 340 km

const A_EARTH = 2.0e10;
const A_MARS = 3.0e10;
const A_MOON = 3.0e7;

const soi = (a: number, mu: number, muParent: number) => a * Math.pow(mu / muParent, 0.4);

export const BODIES: Record<string, BodyDef> = {
  sun: {
    id: "sun",
    name: "Sun",
    parent: null,
    radius: 1.2e8,
    mu: MU_SUN,
    soi: Infinity,
    atmo: null,
    omega: 0,
    orbit: null,
    color: "#ffcb3d",
    colorAlt: "#ffb62e",
    sky: "#000000",
    glow: "255,200,80",
  },
  earth: {
    id: "earth",
    name: "Earth",
    parent: "sun",
    radius: 6.0e5,
    mu: MU_EARTH,
    soi: soi(A_EARTH, MU_EARTH, MU_SUN),
    atmo: { rho0: 1.225, scaleH: 7000, height: 70000 },
    omega: (-2 * Math.PI) / 43200,
    orbit: { a: A_EARTH, e: 0, w: 0, M0: 0, sgn: -1 },
    color: "#3f9b59",
    colorAlt: "#388c50",
    sky: "#5aa9f0",
    glow: "110,180,255",
  },
  moon: {
    id: "moon",
    name: "Moon",
    parent: "earth",
    radius: 1.6e5,
    mu: MU_MOON,
    soi: soi(A_MOON, MU_MOON, MU_EARTH),
    atmo: null,
    omega: 0,
    orbit: { a: A_MOON, e: 0, w: 0, M0: 1.7, sgn: -1 },
    color: "#a3a5ab",
    colorAlt: "#989aa1",
    sky: "#000000",
    glow: "200,200,210",
  },
  mars: {
    id: "mars",
    name: "Mars",
    parent: "sun",
    radius: 3.4e5,
    mu: MU_MARS,
    soi: soi(A_MARS, MU_MARS, MU_SUN),
    atmo: { rho0: 0.02, scaleH: 11000, height: 70000 },
    omega: (-2 * Math.PI) / 88000,
    // Phased ~42 degrees ahead of Earth so a Hohmann window is open right away.
    orbit: { a: A_MARS, e: 0, w: 0, M0: -0.74, sgn: -1 },
    color: "#c4623f",
    colorAlt: "#b9573a",
    sky: "#c9966f",
    glow: "230,170,120",
  },
};

export const BODY_LIST: BodyDef[] = Object.values(BODIES);

export const CHILDREN: Record<string, BodyDef[]> = {};
for (const b of BODY_LIST) CHILDREN[b.id] = [];
for (const b of BODY_LIST) if (b.parent) CHILDREN[b.parent].push(b);

const ORBITS: Record<string, Orbit> = {};
for (const b of BODY_LIST) {
  if (b.orbit && b.parent) {
    const parent = BODIES[b.parent];
    ORBITS[b.id] = Orbit.fromElements(parent.mu, b.orbit.a, b.orbit.e, b.orbit.w, b.orbit.sgn, b.orbit.M0, 0);
  }
}

export function bodyOrbit(id: string): Orbit | null {
  return ORBITS[id] ?? null;
}

const _tmp: StateOut = { x: 0, y: 0, vx: 0, vy: 0 };

/** State of body `id` relative to its parent at universal time t. */
export function bodyRelState(id: string, t: number, out: StateOut = { x: 0, y: 0, vx: 0, vy: 0 }): StateOut {
  const o = ORBITS[id];
  if (!o) {
    out.x = out.y = out.vx = out.vy = 0;
    return out;
  }
  return o.stateAt(t, out);
}

/** Absolute (root-frame) position of a body. */
export function bodyAbsPos(id: string, t: number): { x: number; y: number } {
  let x = 0;
  let y = 0;
  let cur: BodyDef | undefined = BODIES[id];
  while (cur && cur.parent) {
    bodyRelState(cur.id, t, _tmp);
    x += _tmp.x;
    y += _tmp.y;
    cur = BODIES[cur.parent];
  }
  return { x, y };
}

/** Absolute velocity of a body. */
export function bodyAbsVel(id: string, t: number): { x: number; y: number } {
  let x = 0;
  let y = 0;
  let cur: BodyDef | undefined = BODIES[id];
  while (cur && cur.parent) {
    bodyRelState(cur.id, t, _tmp);
    x += _tmp.vx;
    y += _tmp.vy;
    cur = BODIES[cur.parent];
  }
  return { x, y };
}

/** Atmospheric density (kg/m^3) at an altitude above the body's surface. */
export function atmosphereDensity(body: BodyDef, altitude: number): number {
  const a = body.atmo;
  if (!a || altitude >= a.height) return 0;
  return a.rho0 * Math.exp(-Math.max(altitude, 0) / a.scaleH);
}

/** Sea-level-normalised pressure ratio (used to blend Isp). */
export function pressureRatio(body: BodyDef, altitude: number): number {
  const a = body.atmo;
  if (!a) return 0;
  return atmosphereDensity(body, altitude) / a.rho0;
}
