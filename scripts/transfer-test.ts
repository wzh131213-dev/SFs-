import { Simulation } from "../src/game/flight/simulation";
import { PRESETS } from "../src/game/vab/blueprint";
import { BODIES } from "../src/game/physics/solar";

const sim = new Simulation(PRESETS[2]);
const v = sim.active!;
const earth = BODIES.earth;
// teleport into a 120 km circular orbit
const r = earth.radius + 120000;
v.landed = false;
v.pos = { x: r, y: 0 };
const vc = Math.sqrt(earth.mu / r);
v.vel = { x: 0, y: -vc };
let t0 = Date.now();
const ok = sim.planTransfer("moon");
console.log("planned", ok, "ms", Date.now() - t0, sim.node);
const pred = sim.predict()!;
console.log(pred.segments.map((s) => s.bodyId + ":" + s.pts.length / 2).join(" "), pred.markers.filter((m) => m.kind !== "pe" && m.kind !== "ap").map((m) => m.label).join(" | "));
console.log(pred.markers.filter(m => m.bodyId === "moon").map(m => m.label).join(" | "));
