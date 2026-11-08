import { Simulation } from "../src/game/flight/simulation";
import { PRESETS } from "../src/game/vab/blueprint";
import { blueprintStats } from "../src/game/flight/vessel";
import { Orbit } from "../src/game/physics/orbit";
import { BODIES } from "../src/game/physics/solar";

for (const bp of PRESETS) {
  const s = blueprintStats(bp)!;
  console.log(bp.name, "mass", s.mass.toFixed(0), "dv", s.dv.total.toFixed(0), "twr", s.twr.toFixed(2), "stable", s.stable, s.dv.stages.map(x=>x.dv.toFixed(0)+"/"+x.twr.toFixed(2)).join(" "));
}
const sim = new Simulation(PRESETS[1]);
const v = sim.active!;
v.throttle = 1;
sim.activateStage();
let t = 0;
const earth = BODIES.earth;
let phase = "ascent";
while (t < 1200 && sim.active) {
  const a = sim.active!;
  const r = Math.hypot(a.pos.x, a.pos.y);
  const alt = r - earth.radius;
  const up = Math.atan2(a.pos.y, a.pos.x);
  const sv = a.surfaceVel(earth);
  const spd = Math.hypot(sv.x, sv.y);
  const o = Orbit.fromState(a.pos.x, a.pos.y, a.vel.x, a.vel.y, earth.mu, sim.time);
  if (phase === "ascent") {
    const p = alt < 500 ? 0 : Math.min(1.5, 1.5 * Math.pow((alt - 500) / 70000, 0.5));
    a.sas = "stability"; a.sasHold = up - p;
    if (t > 3 && a.thrust < 1 && a.throttle > 0) { sim.activateStage(); }
    if (o.apoapsis - earth.radius > 110000) { a.throttle = 0; phase = "coast"; }
  } else if (phase === "coast") {
    a.sas = "stability"; a.sasHold = Math.atan2(a.vel.y,a.vel.x);
    const tap = o.timeToApoapsis(sim.time) ?? 1e9;
    if (alt > 69000 && tap < 25) { a.throttle = 1; phase = "circ"; }
    if (tap < 1e9 && alt < 69000 && a.throttle===0) { a.throttle = 0.0; }
  } else if (phase === "circ") {
    a.sas = "prograde";
    if (o.periapsis - earth.radius > 100000) { a.throttle = 0; phase = "done"; }
    if (a.thrust < 1 && t > 3) { sim.activateStage(); }
  }
  sim.update(0.05);
  t += 0.05;
  if (Math.round(t * 20) % 400 === 0) console.log(t.toFixed(0), phase, "alt", (alt/1000).toFixed(1), "spd", spd.toFixed(0), "ap", ((o.apoapsis-earth.radius)/1000).toFixed(0), "pe", ((o.periapsis-earth.radius)/1000).toFixed(0), "mass", a.mass.toFixed(0), "heat", a.heat.toFixed(2), "g", a.gForce.toFixed(1));
  if (phase === "done") break;
}
const a = sim.active;
console.log("end", phase, a ? "alive" : "lost:" + sim.lost, "vessels", sim.vessels.length);
if (a) {
  // Rails warp test: orbit period stability
  const o0 = Orbit.fromState(a.pos.x, a.pos.y, a.vel.x, a.vel.y, earth.mu, sim.time);
  sim.setWarpIndex(7);
  const t0 = sim.time;
  for (let i = 0; i < 600; i++) sim.update(1/60);
  const a2 = sim.active!;
  const o1 = Orbit.fromState(a2.pos.x, a2.pos.y, a2.vel.x, a2.vel.y, earth.mu, sim.time);
  console.log("warp dt", (sim.time - t0).toFixed(0), "pe", ((o0.periapsis-earth.radius)/1000).toFixed(3), "->", ((o1.periapsis-earth.radius)/1000).toFixed(3), "ap", ((o0.apoapsis-earth.radius)/1000).toFixed(3), "->", ((o1.apoapsis-earth.radius)/1000).toFixed(3));
}
