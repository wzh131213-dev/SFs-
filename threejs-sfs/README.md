# Spaceflight Simulator — Three.js

This is an isolated Three.js implementation under `threejs-sfs/`. The existing root-level pixel simulator is intentionally preserved.

## Requirements

- Node.js 20.19+ or 22.12+
- npm

## Run locally

```bash
cd threejs-sfs
npm install
npm run dev
```

Open the Vite URL printed in the terminal. Build with `npm run build`; run core tests with `npm test`.

## Module 1

- Validated part definitions with explicit SI-style units.
- Indexed part database with atomic catalog loading.
- Grid snapping, quarter-turn rotation, attachment-port transforms, build bounds and occupied-cell calculation.
- Starter catalog: capsule, fuel tank, engine, decoupler, fairing, parachute, RCS, reaction wheel and landing leg.

Fuel capacity is represented as propellant mass in kg; part `mass` is dry mass in kg. Engine thrust is in newtons and Isp is in seconds.

## Deployment

The app is currently a Vite source project. It needs a production build and a Pages workflow/base-path configuration before it can be published as a GitHub Pages subpath.