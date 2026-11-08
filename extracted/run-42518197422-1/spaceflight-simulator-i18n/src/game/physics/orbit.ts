// Analytic 2D Keplerian orbit: elliptical and hyperbolic, either spin direction.

import { TAU, wrap2Pi, wrapPi } from "../core/math";

export interface StateOut {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export class Orbit {
  mu = 0;
  /** Semi-major axis (negative for hyperbolic). */
  a = 0;
  e = 0;
  /** Argument (angle) of periapsis. */
  w = 0;
  /** +1 counter-clockwise, -1 clockwise. */
  sgn = 1;
  M0 = 0;
  t0 = 0;
  n = 0;
  p = 0;

  static fromElements(mu: number, a: number, e: number, w: number, sgn: number, M0: number, t0: number): Orbit {
    const o = new Orbit();
    o.mu = mu;
    o.a = a;
    o.e = e;
    o.w = w;
    o.sgn = sgn;
    o.M0 = M0;
    o.t0 = t0;
    o.n = Math.sqrt(mu / Math.abs(a * a * a));
    o.p = a * (1 - e * e);
    return o;
  }

  static fromState(px: number, py: number, vx: number, vy: number, mu: number, t0: number): Orbit {
    const r = Math.hypot(px, py);
    const v2 = vx * vx + vy * vy;
    const h = px * vy - py * vx;
    const sgn = h >= 0 ? 1 : -1;
    let eps = v2 / 2 - mu / r;
    if (Math.abs(eps) < 1e-9 * mu / r) eps = eps < 0 ? -1e-9 * mu / r : 1e-9 * mu / r;
    const a = -mu / (2 * eps);
    const rv = px * vx + py * vy;
    const ex = ((v2 - mu / r) * px - rv * vx) / mu;
    const ey = ((v2 - mu / r) * py - rv * vy) / mu;
    let e = Math.hypot(ex, ey);
    let w: number;
    let nu: number;
    const posAng = Math.atan2(py, px);
    if (e < 1e-9) {
      e = 0;
      w = posAng;
      nu = 0;
    } else {
      w = Math.atan2(ey, ex);
      nu = wrapPi(sgn * (posAng - w));
    }
    let M0: number;
    if (a > 0) {
      const E = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2));
      M0 = E - e * Math.sin(E);
    } else {
      const tt = Math.sqrt((e - 1) / (e + 1)) * Math.tan(nu / 2);
      const H = 2 * Math.atanh(Math.max(-0.999999999, Math.min(0.999999999, tt)));
      M0 = e * Math.sinh(H) - H;
    }
    return Orbit.fromElements(mu, a, e, w, sgn, M0, t0);
  }

  get isHyperbolic(): boolean {
    return this.a < 0;
  }
  get periapsis(): number {
    return this.a * (1 - this.e);
  }
  get apoapsis(): number {
    return this.isHyperbolic ? Infinity : this.a * (1 + this.e);
  }
  get period(): number {
    return this.isHyperbolic ? Infinity : TAU / this.n;
  }

  meanAnomalyAt(t: number): number {
    return this.M0 + this.n * (t - this.t0);
  }

  /** Solve Kepler's equation and return the true anomaly + radius at time t. */
  private solve(t: number): { nu: number; r: number } {
    const e = this.e;
    let M = this.meanAnomalyAt(t);
    if (!this.isHyperbolic) {
      M = wrapPi(M);
      let E = e < 0.8 ? M : Math.PI * Math.sign(M || 1);
      for (let i = 0; i < 40; i++) {
        const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
        E -= d;
        if (Math.abs(d) < 1e-13) break;
      }
      const nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
      return { nu, r: this.a * (1 - e * Math.cos(E)) };
    }
    let H = Math.asinh(M / e);
    for (let i = 0; i < 60; i++) {
      const d = (e * Math.sinh(H) - H - M) / (e * Math.cosh(H) - 1);
      H -= d;
      if (Math.abs(d) < 1e-13) break;
    }
    const nu = 2 * Math.atan(Math.sqrt((e + 1) / (e - 1)) * Math.tanh(H / 2));
    return { nu, r: this.a * (1 - e * Math.cosh(H)) };
  }

  stateAt(t: number, out: StateOut = { x: 0, y: 0, vx: 0, vy: 0 }): StateOut {
    const { nu, r } = this.solve(t);
    const phi = this.w + this.sgn * nu;
    const c = Math.cos(phi);
    const s = Math.sin(phi);
    const k = Math.sqrt(this.mu / this.p);
    const vr = k * this.e * Math.sin(nu);
    const vt = k * (1 + this.e * Math.cos(nu));
    out.x = r * c;
    out.y = r * s;
    out.vx = vr * c + vt * this.sgn * -s;
    out.vy = vr * s + vt * this.sgn * c;
    return out;
  }

  /** Position of periapsis (relative to the body). */
  periapsisPos(): { x: number; y: number } {
    const rp = this.periapsis;
    return { x: rp * Math.cos(this.w), y: rp * Math.sin(this.w) };
  }
  apoapsisPos(): { x: number; y: number } {
    const ra = this.apoapsis;
    return { x: -ra * Math.cos(this.w), y: -ra * Math.sin(this.w) };
  }

  timeToPeriapsis(t: number): number | null {
    const M = this.meanAnomalyAt(t);
    if (this.isHyperbolic) return M < 0 ? -M / this.n : null;
    return wrap2Pi(-M) / this.n;
  }
  timeToApoapsis(t: number): number | null {
    if (this.isHyperbolic) return null;
    return wrap2Pi(Math.PI - this.meanAnomalyAt(t)) / this.n;
  }

  /** Time until the orbit next descends through radius `rt` (null if it never does). */
  timeToRadiusInbound(t: number, rt: number): number | null {
    if (this.e < 1e-9) return null;
    if (rt < this.periapsis) return null;
    if (!this.isHyperbolic && rt > this.apoapsis) return null;
    const c = (this.p / rt - 1) / this.e;
    if (c > 1 || c < -1) return null;
    const nu = -Math.acos(c);
    let Mt: number;
    if (!this.isHyperbolic) {
      const E = 2 * Math.atan2(Math.sqrt(1 - this.e) * Math.sin(nu / 2), Math.sqrt(1 + this.e) * Math.cos(nu / 2));
      Mt = E - this.e * Math.sin(E);
      return wrap2Pi(Mt - this.meanAnomalyAt(t)) / this.n;
    }
    const tt = Math.sqrt((this.e - 1) / (this.e + 1)) * Math.tan(nu / 2);
    const H = 2 * Math.atanh(Math.max(-0.999999999, Math.min(0.999999999, tt)));
    Mt = this.e * Math.sinh(H) - H;
    const M = this.meanAnomalyAt(t);
    return Mt > M ? (Mt - M) / this.n : null;
  }

  /** Sample the full conic as a polyline (relative to the body). */
  samplePoints(count: number, maxRadius = Infinity): number[] {
    const pts: number[] = [];
    let limit = Math.PI;
    if (this.isHyperbolic) {
      limit = Math.acos(-1 / this.e) * 0.995;
      if (isFinite(maxRadius)) {
        const c = (this.p / maxRadius - 1) / this.e;
        if (c > -1 && c < 1) limit = Math.min(limit, Math.acos(c));
      }
    }
    for (let i = 0; i <= count; i++) {
      const nu = -limit + (2 * limit * i) / count;
      const r = this.p / (1 + this.e * Math.cos(nu));
      const phi = this.w + this.sgn * nu;
      pts.push(r * Math.cos(phi), r * Math.sin(phi));
    }
    return pts;
  }

  /** Inclination in 2D: 0 deg when the orbit runs with the given spin direction, 180 otherwise. */
  inclinationFor(spinSign: number): number {
    return this.sgn === spinSign ? 0 : 180;
  }
}
