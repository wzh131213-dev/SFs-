const CURRENT_VERSION = 1;

export class Blueprint {
  static create(parts = [], connections = []) {
    const blueprint = { version: CURRENT_VERSION, parts: structuredClone(parts), connections: structuredClone(connections) };
    Blueprint.validate(blueprint);
    return blueprint;
  }

  static validate(data) {
    if (!data || typeof data !== "object" || data.version !== CURRENT_VERSION) {
      throw new TypeError("Unsupported blueprint version.");
    }
    if (!Array.isArray(data.parts) || !Array.isArray(data.connections ?? [])) {
      throw new TypeError("Blueprint parts and connections must be arrays.");
    }
    const ids = new Set();
    for (const part of data.parts) {
      if (!part || typeof part.instanceId !== "string" || !part.instanceId ||
          typeof part.partId !== "string" || !/^[a-z0-9_-]+$/.test(part.partId)) {
        throw new TypeError("Blueprint part instanceId and partId are required.");
      }
      if (ids.has(part.instanceId)) throw new Error(`Duplicate blueprint instance: ${part.instanceId}`);
      ids.add(part.instanceId);
      if (!part.position || !Number.isFinite(part.position.x) || !Number.isFinite(part.position.y) ||
          !Number.isFinite(part.rotation)) throw new TypeError("Blueprint placement coordinates must be finite.");
      if (part.fuelMass !== undefined && (!Number.isFinite(part.fuelMass) || part.fuelMass < 0)) {
        throw new RangeError("Blueprint fuel mass must be non-negative.");
      }
    }
    for (const edge of data.connections ?? []) {
      if (!ids.has(edge.a) || !ids.has(edge.b) || edge.a === edge.b) {
        throw new Error("Blueprint connection references an unknown or identical part.");
      }
    }
    return true;
  }

  static stringify(data) {
    Blueprint.validate(data);
    return JSON.stringify(data, null, 2);
  }

  static parse(json) {
    let data;
    try { data = typeof json === "string" ? JSON.parse(json) : structuredClone(json); }
    catch { throw new SyntaxError("Blueprint JSON is invalid."); }
    Blueprint.validate(data);
    return data;
  }
}
