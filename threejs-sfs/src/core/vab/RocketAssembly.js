import { GridSnap } from "../parts/GridSnap.js";
import { Blueprint } from "./Blueprint.js";
import { AttachmentGraph } from "./AttachmentGraph.js";
import { MassProperties } from "./MassProperties.js";

const PORTS = ["top", "bottom", "left", "right"];
const OPPOSITE = { top: "bottom", bottom: "top", left: "right", right: "left" };
let nextId = 1;

export class RocketAssembly {
  constructor({ database, grid = new GridSnap({ cellSize: 0.5,
    bounds: { minX: -9, maxX: 9, minY: -11, maxY: 11 } }), parts = [] } = {}) {
    if (!database) throw new TypeError("RocketAssembly requires a part database.");
    this.database = database;
    this.grid = grid;
    this.parts = [];
    this.graph = new AttachmentGraph();
    for (const placement of parts) this.#restorePlacement(placement);
  }

  #restorePlacement(placement) {
    const part = this.database.get(placement.partId);
    if (!part) throw new Error(`Unknown part definition: ${placement.partId}`);
    const snapped = this.grid.snapPart(part, placement.position, placement.rotation ?? 0);
    if (!snapped.insideBounds) throw new RangeError("Part is outside build bounds.");
    if (this.#overlaps(snapped, null)) throw new Error("Part placement overlaps another part.");
    const item = { instanceId: placement.instanceId, partId: part.id,
      position: snapped.position, rotation: snapped.rotation,
      fuelMass: placement.fuelMass ?? part.fuelCapacity };
    this.parts.push(item);
    this.graph.addNode(item.instanceId);
  }

  #overlaps(candidate, ignoreId) {
    return this.parts.some(item => {
      if (item.instanceId === ignoreId) return false;
      const part = this.database.get(item.partId);
      const size = this.grid.getRotatedSize(part, item.rotation);
      const a = this.grid.getBounds(item.position, size), b = candidate.bounds;
      const overlapX = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
      const overlapY = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
      return overlapX > 1e-6 && overlapY > 1e-6;
    });
  }

  #findConnection(part, placement, maxDistance = 1.1) {
    let best = null;
    for (const existing of this.parts) {
      const existingDef = this.database.get(existing.partId);
      for (const aPort of PORTS) {
        if (!existingDef.attachment[aPort]) continue;
        const a = this.grid.getAttachmentPoint(existingDef, existing.position, existing.rotation, aPort);
        for (const bPort of PORTS) {
          if (!part.attachment[bPort] || OPPOSITE[aPort] !== bPort) continue;
          const b = this.grid.getAttachmentPoint(part, placement.position, placement.rotation, bPort);
          const distance = Math.hypot(a.x - b.x, a.y - b.y);
          if (distance <= maxDistance && (!best || distance < best.distance)) {
            best = { existing, aPort, bPort, a, b, distance };
          }
        }
      }
    }
    return best;
  }

  addPart(partId, position, rotation = 0) {
    const part = this.database.get(partId);
    if (!part) throw new Error(`Unknown part definition: ${partId}`);
    const placement = this.grid.snapPart(part, position, rotation);
    if (!placement.insideBounds) throw new RangeError("Part is outside build bounds.");
    const connection = this.#findConnection(part, placement);
    if (connection) {
      const alignedPosition = {
        x: placement.position.x + connection.a.x - connection.b.x,
        y: placement.position.y + connection.a.y - connection.b.y
      };
      const aligned = this.grid.snapPart(part, alignedPosition, placement.rotation);
      if (aligned.insideBounds) Object.assign(placement, aligned);
    }
    if (this.#overlaps(placement, null)) throw new Error("Part placement overlaps another part.");
    const item = { instanceId: `part-${nextId++}`, partId,
      position: placement.position, rotation: placement.rotation,
      fuelMass: part.fuelCapacity };
    this.parts.push(item);
    this.graph.addNode(item.instanceId);
    const attached = this.#findConnection(part, placement, 1e-5);
    if (attached) this.graph.connect(attached.existing.instanceId, item.instanceId,
      { aPort: attached.aPort, bPort: attached.bPort });
    return this.getPart(item.instanceId);
  }

  getPart(instanceId) {
    const item = this.parts.find(part => part.instanceId === instanceId);
    return item ? structuredClone(item) : null;
  }

  removePart(instanceId) {
    const index = this.parts.findIndex(part => part.instanceId === instanceId);
    if (index < 0) return false;
    this.parts.splice(index, 1);
    this.graph.removeNode(instanceId);
    return true;
  }

  rotatePart(instanceId, quarterTurns = 1) {
    const item = this.parts.find(part => part.instanceId === instanceId);
    if (!item) return false;
    const definition = this.database.get(item.partId);
    const rotation = this.grid.normalizeRotation(item.rotation + quarterTurns * Math.PI / 2);
    const placement = this.grid.snapPart(definition, item.position, rotation);
    if (!placement.insideBounds || this.#overlaps(placement, instanceId)) return false;
    const candidate = { ...item, position: placement.position, rotation };
    for (const edge of this.graph.edges.filter(edge => edge.a === instanceId || edge.b === instanceId)) {
      const aItem = edge.a === instanceId ? candidate : this.parts.find(part => part.instanceId === edge.a);
      const bItem = edge.b === instanceId ? candidate : this.parts.find(part => part.instanceId === edge.b);
      const aDef = this.database.get(aItem.partId), bDef = this.database.get(bItem.partId);
      if (!aDef.attachment[edge.aPort] || !bDef.attachment[edge.bPort]) return false;
      const aPoint = this.grid.getAttachmentPoint(aDef, aItem.position, aItem.rotation, edge.aPort);
      const bPoint = this.grid.getAttachmentPoint(bDef, bItem.position, bItem.rotation, edge.bPort);
      if (OPPOSITE[edge.aPort] !== edge.bPort || !GridSnap.areConnected(aPoint, bPoint, 1e-5)) return false;
    }
    item.rotation = rotation;
    return true;
  }

  getMassProperties() { return MassProperties.calculate(this.parts, this.database); }

  validate() {
    const graph = this.graph.validate();
    const hasCommandPod = this.parts.some(item => this.database.get(item.partId).type === "capsule");
    return { valid: graph.valid && hasCommandPod && this.parts.length > 0,
      errors: [...graph.errors, ...(!hasCommandPod ? ["Add a command pod before launch."] : [])] };
  }

  exportBlueprint() {
    return Blueprint.create(this.parts, this.graph.edges);
  }

  static fromBlueprint({ database, blueprint, grid } = {}) {
    const data = Blueprint.parse(blueprint);
    const assembly = new RocketAssembly({ database, grid, parts: data.parts });
    for (const edge of (data.connections ?? [])) {
      if (!assembly.graph.nodes.includes(edge.a) || !assembly.graph.nodes.includes(edge.b)) {
        throw new Error("Blueprint connection references an unknown part.");
      }
      assembly.graph.connect(edge.a, edge.b, edge);
    }
    return assembly;
  }
}
