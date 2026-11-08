const DIRECTIONS = Object.freeze({
  top: Object.freeze({ x: 0, y: 1 }),
  bottom: Object.freeze({ x: 0, y: -1 }),
  left: Object.freeze({ x: -1, y: 0 }),
  right: Object.freeze({ x: 1, y: 0 })
});
const EPSILON = 1e-9;

const rotateQuarterTurns = (vector, turns) => {
  switch (((turns % 4) + 4) % 4) {
    case 0: return { x: vector.x, y: vector.y };
    case 1: return { x: -vector.y, y: vector.x };
    case 2: return { x: -vector.x, y: -vector.y };
    default: return { x: vector.y, y: -vector.x };
  }
};

export class GridSnap {
  constructor({ cellSize = 0.5, origin = { x: 0, y: 0 }, bounds = null } = {}) {
    if (!Number.isFinite(cellSize) || cellSize <= 0) {
      throw new RangeError("Grid cellSize must be a finite positive number.");
    }
    if (!origin || !Number.isFinite(origin.x) || !Number.isFinite(origin.y)) {
      throw new TypeError("Grid origin must contain finite x and y coordinates.");
    }
    this.cellSize = cellSize;
    this.origin = Object.freeze({ x: origin.x, y: origin.y });
    this.bounds = bounds ? Object.freeze({ ...bounds }) : null;
    if (this.bounds && !["minX", "maxX", "minY", "maxY"].every(k => Number.isFinite(this.bounds[k]))) {
      throw new TypeError("All grid bounds must be finite.");
    }
    if (this.bounds && (this.bounds.minX > this.bounds.maxX || this.bounds.minY > this.bounds.maxY)) {
      throw new RangeError("Grid bounds are inverted.");
    }
  }

  snapValue(value, origin = 0) {
    if (!Number.isFinite(value)) throw new TypeError("Grid coordinate must be finite.");
    return origin + Math.round((value - origin) / this.cellSize) * this.cellSize;
  }

  snapPosition(position) {
    if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) {
      throw new TypeError("Position must contain finite x and y coordinates.");
    }
    return {
      x: this.snapValue(position.x, this.origin.x),
      y: this.snapValue(position.y, this.origin.y)
    };
  }

  normalizeRotation(rotation = 0) {
    if (!Number.isFinite(rotation)) throw new TypeError("Rotation must be finite.");
    const quarter = Math.PI / 2;
    return ((Math.round(rotation / quarter) % 4) + 4) % 4 * quarter;
  }

  getRotatedSize(part, rotation = 0) {
    const turns = Math.round(this.normalizeRotation(rotation) / (Math.PI / 2));
    const swap = turns % 2 === 1;
    return swap
      ? { width: part.size.height, height: part.size.width }
      : { width: part.size.width, height: part.size.height };
  }

  getBounds(position, size) {
    const halfWidth = size.width / 2;
    const halfHeight = size.height / 2;
    return {
      minX: position.x - halfWidth, maxX: position.x + halfWidth,
      minY: position.y - halfHeight, maxY: position.y + halfHeight
    };
  }

  snapPart(part, position, rotation = 0) {
    const snapped = this.snapPosition(position);
    const normalizedRotation = this.normalizeRotation(rotation);
    const size = this.getRotatedSize(part, normalizedRotation);
    return {
      partId: part.id,
      position: snapped,
      rotation: normalizedRotation,
      size,
      bounds: this.getBounds(snapped, size),
      insideBounds: this.isInsideBounds(snapped, size)
    };
  }

  getAttachmentPoint(part, position, rotation = 0, direction = "top") {
    const localDirection = DIRECTIONS[direction];
    if (!localDirection) throw new TypeError(`Unknown attachment direction: ${direction}`);
    if (!part.attachment[direction]) {
      throw new Error(`Part ${part.id} has no ${direction} attachment port.`);
    }
    const turns = Math.round(this.normalizeRotation(rotation) / (Math.PI / 2));
    const worldDirection = rotateQuarterTurns(localDirection, turns);
    const localOffset = {
      x: localDirection.x * part.size.width / 2,
      y: localDirection.y * part.size.height / 2
    };
    const worldOffset = rotateQuarterTurns(localOffset, turns);
    return {
      x: position.x + worldOffset.x,
      y: position.y + worldOffset.y,
      direction: Object.keys(DIRECTIONS).find(key =>
        DIRECTIONS[key].x === worldDirection.x && DIRECTIONS[key].y === worldDirection.y
      )
    };
  }

  isInsideBounds(position, size) {
    if (!this.bounds) return true;
    const rect = this.getBounds(position, size);
    return rect.minX >= this.bounds.minX - EPSILON &&
      rect.maxX <= this.bounds.maxX + EPSILON &&
      rect.minY >= this.bounds.minY - EPSILON &&
      rect.maxY <= this.bounds.maxY + EPSILON;
  }

  getOccupiedCells(position, size) {
    const rect = this.getBounds(position, size);
    const minX = Math.floor((rect.minX - this.origin.x + EPSILON) / this.cellSize);
    const maxX = Math.ceil((rect.maxX - this.origin.x - EPSILON) / this.cellSize) - 1;
    const minY = Math.floor((rect.minY - this.origin.y + EPSILON) / this.cellSize);
    const maxY = Math.ceil((rect.maxY - this.origin.y - EPSILON) / this.cellSize) - 1;
    const cells = [];
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) cells.push({ x, y });
    }
    return cells;
  }

  static areConnected(pointA, pointB, tolerance = 1e-6) {
    if (!pointA || !pointB || !Number.isFinite(tolerance) || tolerance < 0) return false;
    return Math.hypot(pointA.x - pointB.x, pointA.y - pointB.y) <= tolerance;
  }
}