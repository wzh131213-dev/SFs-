export const PART_TYPES = Object.freeze([
  "capsule", "fuel_tank", "engine", "decoupler", "fairing",
  "parachute", "landing_leg", "rcs", "reaction_wheel"
]);

const finitePositive = value => Number.isFinite(value) && value > 0;
const deepFreeze = value => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
};

export class PartDefinition {
  constructor(data) {
    PartDefinition.validate(data);
    this.id = data.id;
    this.name = data.name;
    this.type = data.type;
    this.mass = data.mass;
    this.size = deepFreeze({ width: data.size.width, height: data.size.height });
    this.attachment = deepFreeze({
      top: data.attachment.top,
      bottom: data.attachment.bottom,
      left: data.attachment.left ?? false,
      right: data.attachment.right ?? false
    });
    this.cost = data.cost;
    this.fuel = data.fuel ? deepFreeze({ ...data.fuel }) : null;
    this.engine = data.engine ? deepFreeze({ ...data.engine }) : null;
    this.maxTemperature = data.maxTemperature ?? 1200;
    this.dragCoefficient = data.dragCoefficient ?? 0.3;
    this.color = data.color ?? "#8995a5";
    Object.freeze(this);
  }

  static validate(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new TypeError("Part definition must be an object.");
    }
    if (typeof data.id !== "string" || !/^[a-z0-9_-]+$/.test(data.id)) {
      throw new TypeError("Part id must contain lowercase letters, digits, _ or -.");
    }
    if (typeof data.name !== "string" || !data.name.trim()) {
      throw new TypeError("Part name is required.");
    }
    if (!PART_TYPES.includes(data.type)) throw new TypeError(`Unsupported part type: ${data.type}`);
    if (!finitePositive(data.mass)) throw new RangeError("Part dry mass must be greater than zero.");
    if (!data.size || !finitePositive(data.size.width) || !finitePositive(data.size.height)) {
      throw new RangeError("Part width and height must be finite positive numbers.");
    }
    if (!data.attachment || typeof data.attachment.top !== "boolean" ||
        typeof data.attachment.bottom !== "boolean") {
      throw new TypeError("Attachment top and bottom flags are required booleans.");
    }
    for (const side of ["left", "right"]) {
      if (data.attachment[side] !== undefined && typeof data.attachment[side] !== "boolean") {
        throw new TypeError(`Attachment ${side} must be a boolean.`);
      }
    }
    if (!Number.isSafeInteger(data.cost) || data.cost < 0) {
      throw new RangeError("Part cost must be a non-negative safe integer.");
    }
    if (data.type === "fuel_tank" && !data.fuel) {
      throw new TypeError("Fuel tanks require a fuel configuration.");
    }
    if (data.fuel && (!Number.isFinite(data.fuel.capacity) || data.fuel.capacity < 0 ||
        typeof data.fuel.type !== "string" || !data.fuel.type.trim())) {
      throw new RangeError("Invalid fuel configuration; capacity is propellant mass in kg.");
    }
    if (data.type === "engine" && !data.engine) {
      throw new TypeError("Engines require an engine configuration.");
    }
    if (data.engine) {
      const { thrust, isp, gimbal } = data.engine;
      if (!Number.isFinite(thrust) || thrust < 0 ||
          !finitePositive(isp) || !Number.isFinite(gimbal) || gimbal < 0) {
        throw new RangeError("Engine thrust, Isp or gimbal value is invalid.");
      }
    }
    if (data.maxTemperature !== undefined && !finitePositive(data.maxTemperature)) {
      throw new RangeError("Maximum temperature must be positive.");
    }
    if (data.dragCoefficient !== undefined &&
        (!Number.isFinite(data.dragCoefficient) || data.dragCoefficient < 0)) {
      throw new RangeError("Drag coefficient cannot be negative.");
    }
    return true;
  }

  get dryMass() { return this.mass; }
  get fuelCapacity() { return this.fuel?.capacity ?? 0; }
  get totalInitialMass() { return this.mass + this.fuelCapacity; }
  get hasEngine() { return this.type === "engine" && this.engine !== null; }
  get footprint() { return { width: this.size.width, height: this.size.height }; }

  toJSON() {
    return {
      id: this.id, name: this.name, type: this.type, mass: this.mass,
      size: { ...this.size }, attachment: { ...this.attachment }, cost: this.cost,
      fuel: this.fuel ? { ...this.fuel } : null,
      engine: this.engine ? { ...this.engine } : null,
      maxTemperature: this.maxTemperature,
      dragCoefficient: this.dragCoefficient, color: this.color
    };
  }
}