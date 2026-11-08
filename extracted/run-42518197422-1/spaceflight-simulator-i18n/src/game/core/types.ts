// Data schema for parts (the "ScriptableObject" equivalent) and blueprints (JSON).

export type PartCategory =
  | "command"
  | "tank"
  | "engine"
  | "separator"
  | "recovery"
  | "structure"
  | "control"
  | "aero";

/** A flat-shaded polygon. Coordinates are normalised to the part rect (0..1, y up). */
export interface Poly {
  pts: [number, number][];
  fill: string;
}

export interface EngineSpec {
  /** Vacuum thrust in newtons at 100 % throttle. */
  thrust: number;
  ispVac: number;
  ispSl: number;
  /** Max gimbal deflection in degrees. */
  gimbal: number;
  /** Solid motors cannot be throttled or shut down; fuel is internal. */
  solid?: boolean;
}

export interface PartDef {
  id: string;
  name: string;
  category: PartCategory;
  description: string;
  /** Size in grid cells. */
  w: number;
  h: number;
  /** Dry mass, kg. */
  mass: number;
  /** Fuel capacity, kg (tanks and solid motors). */
  fuel?: number;
  /** Radial parts only attach through the left / right edge of stack parts. */
  radial?: boolean;
  engine?: EngineSpec;
  separator?: { impulse: number };
  parachute?: { dragArea: number; deploySeconds: number };
  leg?: { tolerance: number };
  rcs?: { thrust: number; isp: number };
  /** Reaction-wheel torque, N*m. */
  torque?: number;
  heatShield?: boolean;
  aero: { cdTop: number; cdBottom: number; sideArea?: number; lift?: number };
  visual: Poly[];
}

/** A part placed on the VAB grid. (gx, gy) is the bottom-left cell. */
export interface PartInstance {
  id: number;
  defId: string;
  gx: number;
  gy: number;
  /** Staging index. 0 fires first; -1 means "not staged". */
  stage: number;
}

export interface Blueprint {
  version: 1;
  name: string;
  parts: PartInstance[];
  /** When true the staging order was edited by hand and is not auto-generated. */
  manualStaging?: boolean;
}

export interface BodyDef {
  id: string;
  name: string;
  parent: string | null;
  radius: number;
  mu: number;
  /** Sphere of influence radius (Infinity for the root body). */
  soi: number;
  atmo: { rho0: number; scaleH: number; height: number } | null;
  /** Signed rotation rate, rad/s (negative = clockwise). */
  omega: number;
  orbit: { a: number; e: number; w: number; M0: number; sgn: number } | null;
  color: string;
  colorAlt: string;
  sky: string;
  glow: string;
}
