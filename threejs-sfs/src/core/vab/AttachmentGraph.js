export class AttachmentGraph {
  #nodes = new Set();
  #edges = [];

  addNode(id) {
    if (typeof id !== "string" || !id) throw new TypeError("Graph node id is required.");
    if (this.#nodes.has(id)) throw new Error(`Duplicate graph node: ${id}`);
    this.#nodes.add(id);
    return this;
  }

  removeNode(id) {
    if (!this.#nodes.delete(id)) return false;
    this.#edges = this.#edges.filter(edge => edge.a !== id && edge.b !== id);
    return true;
  }

  connect(a, b, ports = {}) {
    if (!this.#nodes.has(a) || !this.#nodes.has(b)) throw new Error("Attachment graph node does not exist.");
    if (a === b) throw new Error("A part cannot attach to itself.");
    if (this.#edges.some(edge => (edge.a === a && edge.b === b) || (edge.a === b && edge.b === a))) {
      throw new Error("Parts are already connected.");
    }
    const edge = { a, b, aPort: ports.aPort ?? null, bPort: ports.bPort ?? null };
    this.#edges.push(Object.freeze(edge));
    return edge;
  }

  get nodes() { return [...this.#nodes]; }
  get edges() { return this.#edges.map(edge => ({ ...edge })); }

  isConnected() {
    if (this.#nodes.size <= 1) return true;
    const first = this.#nodes.values().next().value;
    const visited = new Set([first]);
    const queue = [first];
    while (queue.length) {
      const current = queue.shift();
      for (const edge of this.#edges) {
        const next = edge.a === current ? edge.b : edge.b === current ? edge.a : null;
        if (next && !visited.has(next)) { visited.add(next); queue.push(next); }
      }
    }
    return visited.size === this.#nodes.size;
  }

  validate() {
    const valid = this.isConnected();
    return { valid, nodeCount: this.#nodes.size, edgeCount: this.#edges.length,
      errors: valid ? [] : ["Rocket contains detached parts."] };
  }
}
