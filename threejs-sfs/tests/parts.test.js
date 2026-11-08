import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PartDefinition } from "../src/core/parts/PartDefinition.js";
import { PartDatabase } from "../src/core/parts/PartDatabase.js";
import { GridSnap } from "../src/core/parts/GridSnap.js";

const catalog = JSON.parse(await readFile(
  new URL("../src/core/parts/part-catalog.json", import.meta.url), "utf8"
));
const db = new PartDatabase();
db.registerMany(catalog.parts);

test("catalog loads all nine unique part definitions", () => {
  assert.equal(db.size, 9);
  assert.equal(new Set(db.getAll().map(part => part.id)).size, 9);
});

test("part definitions expose dry mass and propellant capacity separately", () => {
  const tank = db.get("fuel-tank-01");
  assert.equal(tank.dryMass, 0.8);
  assert.equal(tank.fuelCapacity, 8);
  assert.equal(tank.totalInitialMass, 8.8);
});

test("engine data uses thrust in newtons and Isp in seconds", () => {
  const engine = db.get("engine-01");
  assert.equal(engine.engine.thrust, 120000);
  assert.equal(engine.engine.isp, 260);
  assert.equal(engine.hasEngine, true);
});

test("invalid and duplicate part definitions are rejected", () => {
  assert.throws(() => new PartDefinition({}), /id/);
  assert.throws(() => db.register(catalog.parts[0]), /Duplicate part id/);
});

test("registerMany is atomic when one item is invalid", () => {
  const isolated = new PartDatabase();
  assert.throws(() => isolated.registerMany([catalog.parts[0], { id: "bad" }]));
  assert.equal(isolated.size, 0);
});

test("type indexes and search return matching definitions", () => {
  assert.equal(db.getByType("engine").length, 1);
  assert.equal(db.search("燃料").length, 1);
  assert.equal(db.get("missing"), null);
});

test("exported catalog can be loaded through fetch-compatible API", async () => {
  const target = new PartDatabase();
  const payload = JSON.stringify(catalog);
  await target.load("/catalog.json", async () => ({
    ok: true, json: async () => JSON.parse(payload)
  }));
  assert.equal(target.size, 9);
});

test("grid snaps relative to a non-zero origin", () => {
  const grid = new GridSnap({ cellSize: 0.5, origin: { x: 1, y: -1 } });
  assert.deepEqual(grid.snapPosition({ x: 1.26, y: -1.26 }), { x: 1.5, y: -1.5 });
});

test("rotated part dimensions swap at 90 degrees", () => {
  const grid = new GridSnap();
  const tank = db.get("fuel-tank-01");
  assert.deepEqual(grid.getRotatedSize(tank, Math.PI / 2), { width: 4, height: 2 });
});

test("rotation transforms attachment direction and offset", () => {
  const grid = new GridSnap();
  const tank = db.get("fuel-tank-01");
  const point = grid.getAttachmentPoint(tank, { x: 0, y: 0 }, Math.PI / 2, "top");
  assert.equal(point.direction, "left");
  assert.equal(point.x, -2);
  assert.equal(point.y, 0);
});

test("placement reports bounds and occupied grid cells", () => {
  const grid = new GridSnap({
    cellSize: 0.5,
    bounds: { minX: -2, maxX: 2, minY: -3, maxY: 3 }
  });
  const tank = db.get("fuel-tank-01");
  const placement = grid.snapPart(tank, { x: 0, y: 0 });
  assert.equal(placement.insideBounds, true);
  assert.equal(grid.getOccupiedCells(placement.position, placement.size).length, 32);
  assert.equal(grid.isInsideBounds({ x: 2, y: 0 }, { width: 2, height: 2 }), false);
});

test("attachment connection uses a configurable tolerance", () => {
  assert.equal(GridSnap.areConnected({ x: 0, y: 0 }, { x: 0.0001, y: 0 }, 0.001), true);
  assert.equal(GridSnap.areConnected({ x: 0, y: 0 }, { x: 0.1, y: 0 }, 0.001), false);
});