import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PartDatabase } from "../src/core/parts/PartDatabase.js";
import { Blueprint } from "../src/core/vab/Blueprint.js";
import { AttachmentGraph } from "../src/core/vab/AttachmentGraph.js";
import { MassProperties } from "../src/core/vab/MassProperties.js";
import { RocketAssembly } from "../src/core/vab/RocketAssembly.js";

const catalog = JSON.parse(await readFile(new URL("../src/core/parts/part-catalog.json", import.meta.url), "utf8"));
const database = new PartDatabase();
database.registerMany(catalog.parts);

test("blueprint round-trips and rejects unsupported versions or malformed placements", () => {
  const data = Blueprint.create([{ instanceId: "p1", partId: "command-pod-01", position: { x: 0, y: 1 }, rotation: 0 }]);
  assert.deepEqual(Blueprint.parse(Blueprint.stringify(data)), data);
  assert.throws(() => Blueprint.parse(JSON.stringify({ version: 99, parts: [] })), /version/i);
  assert.throws(() => Blueprint.create([{ partId: "../bad", position: { x: 0, y: 0 }, rotation: 0 }]), /partId/i);
});

test("attachment graph reports disconnected parts and validates reciprocal edges", () => {
  const graph = new AttachmentGraph();
  graph.addNode("a"); graph.addNode("b"); graph.addNode("c");
  assert.equal(graph.isConnected(), false);
  graph.connect("a", "b", { aPort: "top", bPort: "bottom" });
  assert.equal(graph.isConnected(), false);
  graph.connect("b", "c", { aPort: "top", bPort: "bottom" });
  assert.equal(graph.isConnected(), true);
  assert.equal(graph.validate().valid, true);
  assert.throws(() => graph.connect("a", "missing", {}), /node/i);
});

test("mass properties include dry mass, propellant and weighted center of mass", () => {
  const result = MassProperties.calculate([
    { instanceId: "tank", partId: "fuel-tank-01", position: { x: 0, y: 2 }, rotation: 0, fuelMass: 4 },
    { instanceId: "pod", partId: "command-pod-01", position: { x: 0, y: 5 }, rotation: 0, fuelMass: 0 }
  ], database);
  assert.equal(result.dryMass, 2);
  assert.equal(result.propellantMass, 4);
  assert.equal(result.totalMass, 6);
  assert.ok(Math.abs(result.centerOfMass.y - 2.6) < 1e-9);
  assert.throws(() => MassProperties.calculate([{ partId: "unknown", position: { x: 0, y: 0 } }], database), /unknown/i);
});

test("rocket assembly snaps, auto-connects compatible ports and rejects overlap", () => {
  const assembly = new RocketAssembly({ database });
  const pod = assembly.addPart("command-pod-01", { x: 0, y: 4 });
  const tank = assembly.addPart("fuel-tank-01", { x: 0, y: 1 });
  assert.equal(assembly.parts.length, 2);
  assert.equal(assembly.graph.isConnected(), true);
  assert.equal(tank.position.x, 0);
  assert.ok(pod.instanceId);
  assert.throws(() => assembly.addPart("command-pod-01", { x: 0, y: 4 }), /overlap/i);
  assert.equal(assembly.removePart(tank.instanceId), true);
  assert.equal(assembly.parts.length, 1);
});

test("assembly exports and restores a validated blueprint", () => {
  const assembly = new RocketAssembly({ database });
  assembly.addPart("command-pod-01", { x: 0, y: 4 });
  assembly.addPart("fuel-tank-01", { x: 0, y: 1 });
  const restored = RocketAssembly.fromBlueprint({ database, blueprint: assembly.exportBlueprint() });
  assert.equal(restored.parts.length, 2);
  assert.equal(restored.graph.isConnected(), true);
  assert.equal(restored.getMassProperties().totalMass, assembly.getMassProperties().totalMass);
});
