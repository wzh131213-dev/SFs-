# Spaceflight Simulator — Three.js

This is an isolated Three.js implementation under `threejs-sfs/`. The existing root-level pixel simulator is intentionally preserved; Module 2 is developed on `feature/threejs-sfs-module-1` and is not merged into `main`.

## Requirements

- Node.js 20.19+ or 22.12+
- npm

## Run locally

```bash
cd threejs-sfs
npm install
npm run dev
```

Open the Vite URL printed in the terminal. Build with `npm run build`; run core and VAB tests with `npm test`.

## Module 1 — Part foundation

- Validated part definitions with explicit SI-style units.
- Indexed part database with atomic catalog loading.
- Grid snapping, quarter-turn rotation, attachment-port transforms, build bounds and occupied-cell calculation.
- Starter catalog: capsule, fuel tank, engine, decoupler, fairing, parachute, RCS, reaction wheel and landing leg.

Fuel capacity is represented as propellant mass in kg; part `mass` is dry mass in kg. Engine thrust is in newtons and Isp is in seconds.

## Module 2 — Vehicle Assembly Building

- Responsive Three.js VAB workspace with a nine-part palette.
- Pointer/touch drag-and-drop from the parts tray and tap-to-place controls.
- 0.5 m grid snapping, compatible opposite-port auto-alignment and overlap/build-bound checks.
- Select, rotate and remove placed parts. A rotation that would detach a connected port is rejected.
- Attachment graph connectivity validation and command-pod requirement.
- Live dry mass, propellant mass, total mass and center-of-mass calculation.
- Versioned blueprint JSON export/import with structural validation.
- Node test coverage for blueprint validation, graph connectivity, mass properties, snapping, auto-attachment, overlap rejection and safe rotation.

## Deployment

The app is a Vite source project. It still needs a production build and a GitHub Pages base-path/deployment workflow before it can be published as a Pages subpath.
