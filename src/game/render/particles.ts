// Pooled particle system (ring buffer, zero per-frame allocation) for exhaust, smoke & explosions.

import * as THREE from "three";

const CAP = 3500;

export class ParticlePool {
  readonly points: THREE.Points;
  // simulation state (body-fixed frame, metres relative to the body centre)
  px = new Float64Array(CAP);
  py = new Float64Array(CAP);
  vx = new Float64Array(CAP);
  vy = new Float64Array(CAP);
  life = new Float32Array(CAP);
  maxLife = new Float32Array(CAP);
  size = new Float32Array(CAP);
  grow = new Float32Array(CAP);
  hot = new Float32Array(CAP); // 1 = fire, 0 = smoke
  body = new Int16Array(CAP).fill(-1);
  private head = 0;

  private posBuf = new Float32Array(CAP * 3);
  private colBuf = new Float32Array(CAP * 4);
  private sizeBuf = new Float32Array(CAP);
  private geo = new THREE.BufferGeometry();

  constructor() {
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.posBuf, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("aColor", new THREE.BufferAttribute(this.colBuf, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("aSize", new THREE.BufferAttribute(this.sizeBuf, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      vertexShader: `
        attribute float aSize; attribute vec4 aColor; varying vec4 vColor;
        void main(){ vColor = aColor; gl_PointSize = aSize; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        varying vec4 vColor;
        void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c); if (d > 0.5) discard; gl_FragColor = vec4(vColor.rgb, vColor.a * (1.0 - d * 2.0)); }`,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 7;
  }

  spawn(bodyIdx: number, x: number, y: number, vx: number, vy: number, life: number, size: number, grow: number, hot: number): void {
    const i = this.head;
    this.head = (this.head + 1) % CAP;
    this.px[i] = x;
    this.py[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size[i] = size;
    this.grow[i] = grow;
    this.hot[i] = hot;
    this.body[i] = bodyIdx;
  }

  update(dt: number): void {
    const drag = Math.exp(-0.6 * dt);
    for (let i = 0; i < CAP; i++) {
      if (this.body[i] < 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.body[i] = -1;
        continue;
      }
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.vx[i] *= drag;
      this.vy[i] *= drag;
    }
  }

  /**
   * Write GPU buffers. `toView(bodyIdx, px, py, out)` converts a body-fixed particle position
   * into camera-relative world coordinates (and applies the view rotation done by the caller).
   */
  write(toView: (bodyIdx: number, px: number, py: number, out: [number, number]) => boolean, mpp: number, pixelRatio: number): void {
    const out: [number, number] = [0, 0];
    let n = 0;
    for (let i = 0; i < CAP; i++) {
      const b = this.body[i];
      if (b < 0) continue;
      if (!toView(b, this.px[i], this.py[i], out)) continue;
      const f = 1 - this.life[i] / this.maxLife[i];
      const o3 = n * 3;
      this.posBuf[o3] = out[0];
      this.posBuf[o3 + 1] = out[1];
      this.posBuf[o3 + 2] = 0;
      const hot = this.hot[i];
      const fire = Math.max(0, 1 - f * 3.2) * hot;
      const c4 = n * 4;
      this.colBuf[c4] = 0.55 + 0.45 * fire;
      this.colBuf[c4 + 1] = 0.55 + 0.35 * fire - 0.25 * fire * f;
      this.colBuf[c4 + 2] = 0.58 - 0.4 * fire;
      this.colBuf[c4 + 3] = (hot > 0.5 ? 0.8 : 0.45) * (1 - f) * (1 - f * 0.4);
      const sizeM = this.size[i] * (1 + this.grow[i] * f);
      this.sizeBuf[n] = Math.max(1.5, (sizeM / mpp) * pixelRatio);
      n++;
    }
    this.geo.setDrawRange(0, n);
    (this.geo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute("aColor") as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute("aSize") as THREE.BufferAttribute).needsUpdate = true;
  }

  clear(): void {
    this.body.fill(-1);
  }
}
