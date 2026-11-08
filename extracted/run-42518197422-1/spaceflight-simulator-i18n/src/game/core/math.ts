// Core math helpers & global constants shared by every game module.

import { t as tr } from "../../i18n";

export interface Vec2 {
  x: number;
  y: number;
}

export const TAU = Math.PI * 2;
/** Standard gravity used for Isp -> exhaust velocity conversion (m/s^2). */
export const G0 = 9.80665;
/** Size of one VAB grid cell in metres. */
export const CELL = 0.25;

export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Wrap an angle to (-PI, PI]. */
export function wrapPi(a: number): number {
  let r = (a + Math.PI) % TAU;
  if (r < 0) r += TAU;
  return r - Math.PI;
}

/** Wrap an angle to [0, 2PI). */
export function wrap2Pi(a: number): number {
  let r = a % TAU;
  if (r < 0) r += TAU;
  return r;
}

export const vec = (x = 0, y = 0): Vec2 => ({ x, y });
export const vlen = (v: Vec2): number => Math.hypot(v.x, v.y);
export const vdot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const vcross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;

export function vnorm(v: Vec2): Vec2 {
  const l = Math.hypot(v.x, v.y);
  return l < 1e-12 ? { x: 1, y: 0 } : { x: v.x / l, y: v.y / l };
}

export function vrot(v: Vec2, a: number): Vec2 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

export function formatDistance(m: number): string {
  if (!isFinite(m)) return "∞";
  const a = Math.abs(m);
  if (a >= 1e9) return (m / 1e9).toFixed(2) + " Gm";
  if (a >= 1e6) return (m / 1e6).toFixed(2) + " Mm";
  if (a >= 1e4) return (m / 1e3).toFixed(1) + " km";
  if (a >= 1e3) return (m / 1e3).toFixed(2) + " km";
  return m.toFixed(1) + " m";
}

export function formatSpeed(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e4) return (v / 1e3).toFixed(2) + " km/s";
  return v.toFixed(1) + " m/s";
}

export function formatMass(kg: number): string {
  if (kg >= 1e4) return (kg / 1e3).toFixed(2) + " t";
  return kg.toFixed(0) + " kg";
}

export function formatTime(s: number): string {
  if (!isFinite(s)) return "—";
  const neg = s < 0;
  let t = Math.abs(s);
  const d = Math.floor(t / 86400);
  t -= d * 86400;
  const h = Math.floor(t / 3600);
  t -= h * 3600;
  const m = Math.floor(t / 60);
  const sec = Math.floor(t - m * 60);
  const parts: string[] = [];
  if (d > 0) parts.push(d + tr("unit.d"));
  if (d > 0 || h > 0) parts.push(h + tr("unit.h"));
  if (d > 0 || h > 0 || m > 0) parts.push(m + tr("unit.m"));
  parts.push(sec + tr("unit.s"));
  return (neg ? "-" : "") + parts.join(" ");
}
