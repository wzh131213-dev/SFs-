import { PartDefinition } from "./PartDefinition.js";

export class PartDatabase {
  #parts = new Map();
  #typeIndex = new Map();
  #version = 0;

  constructor() {
    for (const type of [
      "capsule", "fuel_tank", "engine", "decoupler", "fairing",
      "parachute", "landing_leg", "rcs", "reaction_wheel"
    ]) this.#typeIndex.set(type, new Set());
  }

  register(data) {
    const part = data instanceof PartDefinition ? data : new PartDefinition(data);
    if (this.#parts.has(part.id)) throw new Error(`Duplicate part id: ${part.id}`);
    this.#parts.set(part.id, part);
    this.#typeIndex.get(part.type).add(part.id);
    this.#version++;
    return part;
  }

  registerMany(items) {
    if (!Array.isArray(items)) throw new TypeError("Part catalog must be an array.");
    const staged = items.map(item => new PartDefinition(item));
    const ids = new Set(this.#parts.keys());
    for (const part of staged) {
      if (ids.has(part.id)) throw new Error(`Duplicate part id: ${part.id}`);
      ids.add(part.id);
    }
    for (const part of staged) this.register(part);
    return staged.length;
  }

  async load(url, fetchImpl = globalThis.fetch) {
    if (typeof fetchImpl !== "function") throw new Error("Fetch API is unavailable.");
    const response = await fetchImpl(url);
    if (!response.ok) throw new Error(`Part catalog request failed: HTTP ${response.status}`);
    const payload = await response.json();
    if (!payload || !Array.isArray(payload.parts)) {
      throw new TypeError("Invalid catalog: expected an object with a parts array.");
    }
    const staged = new PartDatabase();
    staged.registerMany(payload.parts);
    this.#parts = staged.#parts;
    this.#typeIndex = staged.#typeIndex;
    this.#version++;
    return this;
  }

  get(id) { return this.#parts.get(id) ?? null; }
  has(id) { return this.#parts.has(id); }
  get size() { return this.#parts.size; }
  get version() { return this.#version; }
  getAll() { return [...this.#parts.values()]; }

  getByType(type) {
    const ids = this.#typeIndex.get(type);
    return ids ? [...ids].map(id => this.#parts.get(id)) : [];
  }

  unregister(id) {
    const part = this.#parts.get(id);
    if (!part) return false;
    this.#parts.delete(id);
    this.#typeIndex.get(part.type).delete(id);
    this.#version++;
    return true;
  }

  search(query) {
    const term = String(query ?? "").trim().toLocaleLowerCase();
    if (!term) return [];
    return this.getAll().filter(part =>
      [part.id, part.name, part.type].some(value => value.toLocaleLowerCase().includes(term))
    );
  }

  exportJSON() {
    return { version: this.#version, parts: this.getAll().map(part => part.toJSON()) };
  }
}