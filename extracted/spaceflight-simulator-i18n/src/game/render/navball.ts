// Navball renderer (2D canvas). The ball shows local horizon relative to the rocket plus
// prograde / retrograde / radial / maneuver markers. The rocket's nose always points to the top.

import { TAU } from "../core/math";

export interface NavData {
  /** Rocket nose heading, world angle (rad). */
  angle: number;
  /** World angle of local "up" (away from the planet). */
  upAngle: number;
  velAngle: number | null;
  nodeAngle: number | null;
  /** Label of velocity reference. */
  mode: string;
}

export function drawNavball(ctx: CanvasRenderingContext2D, size: number, d: NavData): void {
  const c = size / 2;
  const R = c - 8;
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.translate(c, c);
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, TAU);
  ctx.clip();
  const delta = d.upAngle - d.angle;
  ctx.rotate(-delta);
  const sky = ctx.createLinearGradient(0, -R, 0, 0);
  sky.addColorStop(0, "#1a5cab");
  sky.addColorStop(1, "#4ea1ea");
  ctx.fillStyle = sky;
  ctx.fillRect(-R, -R, 2 * R, R);
  const gr = ctx.createLinearGradient(0, 0, 0, R);
  gr.addColorStop(0, "#9a6a35");
  gr.addColorStop(1, "#4f3318");
  ctx.fillStyle = gr;
  ctx.fillRect(-R, 0, 2 * R, R);
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-R, 0);
  ctx.lineTo(R, 0);
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(255,255,255,0.45)";
  for (const k of [0.33, 0.66]) {
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(-R * (0.42 - k * 0.25), s * R * k);
      ctx.lineTo(R * (0.42 - k * 0.25), s * R * k);
      ctx.stroke();
    }
  }
  // heading ticks on the rim (rotate with the ball)
  ctx.strokeStyle = "rgba(255,255,255,0.7)";
  for (let a = 0; a < 360; a += 15) {
    const major = a % 45 === 0;
    const rad = (a * Math.PI) / 180;
    ctx.beginPath();
    ctx.moveTo(Math.sin(rad) * (R - (major ? 11 : 6)), -Math.cos(rad) * (R - (major ? 11 : 6)));
    ctx.lineTo(Math.sin(rad) * R, -Math.cos(rad) * R);
    ctx.stroke();
  }
  ctx.restore();

  // rim
  ctx.lineWidth = 6;
  ctx.strokeStyle = "#171b22";
  ctx.beginPath();
  ctx.arc(c, c, R + 1, 0, TAU);
  ctx.stroke();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "#3a4352";
  ctx.beginPath();
  ctx.arc(c, c, R + 4, 0, TAU);
  ctx.stroke();

  const marker = (ang: number | null, kind: "pro" | "retro" | "rOut" | "rIn" | "node") => {
    if (ang === null) return;
    const dlt = ang - d.angle;
    const rm = R * 0.64;
    const x = c - Math.sin(dlt) * rm;
    const y = c - Math.cos(dlt) * rm;
    ctx.save();
    ctx.translate(x, y);
    ctx.lineWidth = 2.2;
    const col = kind === "pro" || kind === "retro" ? "#a8ff4d" : kind === "node" ? "#4da3ff" : "#35d9ee";
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(0, 0, 7, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    if (kind === "pro") {
      ctx.moveTo(0, -7);
      ctx.lineTo(0, -13);
      ctx.moveTo(-7, 0);
      ctx.lineTo(-13, 0);
      ctx.moveTo(7, 0);
      ctx.lineTo(13, 0);
      ctx.fillRect(-1.5, -1.5, 3, 3);
    } else if (kind === "retro") {
      ctx.moveTo(-5, -5);
      ctx.lineTo(5, 5);
      ctx.moveTo(5, -5);
      ctx.lineTo(-5, 5);
      ctx.moveTo(0, -7);
      ctx.lineTo(0, -13);
      ctx.moveTo(-7, 0);
      ctx.lineTo(-13, 0);
      ctx.moveTo(7, 0);
      ctx.lineTo(13, 0);
    } else if (kind === "rOut") {
      ctx.moveTo(0, -4);
      ctx.lineTo(0, 4);
      ctx.moveTo(-4, 0);
      ctx.lineTo(4, 0);
    } else if (kind === "rIn") {
      ctx.moveTo(-4, 0);
      ctx.lineTo(4, 0);
    } else {
      ctx.fillRect(-3, -3, 6, 6);
    }
    ctx.stroke();
    ctx.restore();
  };
  marker(d.upAngle, "rOut");
  marker(d.upAngle + Math.PI, "rIn");
  if (d.velAngle !== null) {
    marker(d.velAngle + Math.PI, "retro");
    marker(d.velAngle, "pro");
  }
  marker(d.nodeAngle, "node");

  // fixed craft symbol
  ctx.strokeStyle = "#ff8a1f";
  ctx.fillStyle = "#ff8a1f";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(c - 26, c + 3);
  ctx.lineTo(c - 9, c + 3);
  ctx.lineTo(c, c - 7);
  ctx.lineTo(c + 9, c + 3);
  ctx.lineTo(c + 26, c + 3);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(c, c + 3, 2.5, 0, TAU);
  ctx.fill();
  // nose pointer
  ctx.beginPath();
  ctx.moveTo(c, 1);
  ctx.lineTo(c - 6, 11);
  ctx.lineTo(c + 6, 11);
  ctx.closePath();
  ctx.fill();
}
