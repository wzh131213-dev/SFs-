export class MassProperties {
  static calculate(placements, database) {
    if (!Array.isArray(placements) || !database) throw new TypeError("Placements and part database are required.");
    let dryMass = 0, propellantMass = 0, weightedX = 0, weightedY = 0;
    for (const placement of placements) {
      const part = database.get(placement.partId);
      if (!part) throw new Error(`Unknown part definition: ${placement.partId}`);
      const fuelMass = placement.fuelMass ?? part.fuelCapacity;
      if (!Number.isFinite(fuelMass) || fuelMass < 0 || fuelMass > part.fuelCapacity) {
        throw new RangeError(`Invalid propellant mass for ${placement.partId}.`);
      }
      dryMass += part.dryMass;
      propellantMass += fuelMass;
      const mass = part.dryMass + fuelMass;
      weightedX += placement.position.x * mass;
      weightedY += placement.position.y * mass;
    }
    const totalMass = dryMass + propellantMass;
    return Object.freeze({
      dryMass, propellantMass, totalMass,
      centerOfMass: Object.freeze({
        x: totalMass ? weightedX / totalMass : 0,
        y: totalMass ? weightedY / totalMass : 0
      })
    });
  }
}
