'use strict';
(() => {
const W = 480, H = 270, G = 9.81, PI = Math.PI, $ = id => document.getElementById(id);
const cv = $('c'), ctx = cv.getContext('2d');
cv.width = W; cv.height = H; ctx.imageSmoothingEnabled = false;
const img = ctx.createImageData(W, H), buf = new Uint32Array(img.data.buffer);
const C = (r, g, b) => (255 << 24) | (b << 16) | (g << 8) | r;
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const sm = (a, b, x) => { x = clamp((x - a) / (b - a), 0, 1); return x * x * (3 - 2 * x); };

// ---------- 天体(物理单位:米 / 秒) ----------
const mk = o => { o.mu = o.g * o.R * o.R; o.x = o.y = o.vx = o.vy = 0; return o; };
// pal: 0草顶 1草 2水 3深水 4雪 5土1 6土2
const earth = mk({ name: '地球', R: 6e5, g: 9.8, H: 4000, atm: 1, seed: 1,
  pal: [C(96,200,72), C(60,150,60), C(40,100,210), C(30,70,170), C(240,245,255), C(120,80,50), C(98,64,40)] });
const moon = mk({ name: '月球', R: 1.5e5, g: 1.6, H: 3000, atm: 0, seed: 5,
  pal: [C(196,196,202), C(160,160,168), 0, 0, C(210,210,215), C(112,112,120), C(92,92,100)] });
const bodies = [earth, moon], MD = 1.2e7, MW = Math.sqrt(earth.mu / MD ** 3);
function moonAt(T) {
  const a = .5 + MW * T;
  moon.x = MD * Math.cos(a); moon.y = MD * Math.sin(a);
  moon.vx = -MD * MW * Math.sin(a); moon.vy = MD * MW * Math.cos(a);
}
let isW = 0;
function terr(b, t) {
  let d = Math.abs(t - PI / 2); if (d > PI) d = 2 * PI - d;
  const m = b === earth ? sm(.003, .03, d) : 1;           // 发射台附近保持平坦
  const v = Math.sin(t * 7 + b.seed) * .5 + Math.sin(t * 19 + b.seed * 2) * .3 + Math.sin(t * 53 + b.seed * 3) * .2;
  isW = b.atm && v < 0 && m > .3 ? 1 : 0;
  return v > 0 ? v * m * b.H : 0;
}
function grav(x, y) {
  let gx = 0, gy = 0;
  for (const b of bodies) {
    const dx = b.x - x, dy = b.y - y, r2 = dx * dx + dy * dy, r = Math.sqrt(r2), a = b.mu / r2;
    gx += a * dx / r; gy += a * dy / r;
  }
  return [gx, gy];
}

// ---------- 像素贴图(字符画) ----------
const PC = { w: '#f4f4f4', b: '#4aa8ff', r: '#d83a3a', g: '#b8bcc8', G: '#7c8296', d: '#464a58', Y: '#e8c23a', o: '#e07b30', O: '#a8541c' };
const pad = r => '..' + r + '..';                          // 所有行统一 13 格宽,两侧留给侧挂助推器
const CAP = ['....w....', '...www...', '..wwbww..', '..wwwww..', '..rrrrr..'].map(pad), CAPM = 500, CAPCOST = 20000, BUDGET = 300000;
const body = (w, h, c, e) => { const pd = '.'.repeat((9 - w) / 2), hf = (w - 1) / 2, r = [];
  for (let i = 0; i < h; i++) r.push(pd + (i === 0 || i === h - 1 ? e.repeat(w) : c.repeat(hf + 1) + 'G' + c.repeat(hf - 1)) + pd); return r; };
const PARTS = [
  { id: 'ts', name: '小燃料箱', k: 't', rows: body(5, 4, 'w', 'r'), fuel: 2500, dry: 300, cost: 8000 },
  { id: 'tm', name: '中燃料箱', k: 't', rows: body(7, 7, 'g', 'r'), fuel: 5500, dry: 650, cost: 18000 },
  { id: 'tl', name: '大燃料箱', k: 't', rows: body(9, 11, 'o', 'O'), fuel: 10000, dry: 1100, cost: 35000 },
  { id: 'es', name: '小引擎(真空)', k: 'e', rows: ['...ddd...', '..d...d..'], dry: 180, F: 6e4, isp: 330, cost: 25000 },
  { id: 'em', name: '中引擎', k: 'e', rows: ['..GdddG..', '...ddd...', '.dd...dd.'], dry: 600, F: 2.2e5, isp: 300, cost: 50000 },
  { id: 'el', name: '大引擎', k: 'e', rows: ['..GGGGG..', '..GdddG..', '...ddd...', '.dd...dd.', '.d.....d.'], dry: 1300, F: 4.8e5, isp: 285, cost: 110000 },
  { id: 'sb', name: '侧挂助推器(一对)', k: 'b', rows: [], fuel: 6000, dry: 700, F: 2.4e5, isp: 240, cost: 35000 },
  { id: 'pc', name: '降落伞', k: 'p', rows: ['...rwr...'], dry: 120, cost: 4000 },
  { id: 'dc', name: '分离器', k: 'd', rows: ['.YYYYYYY.'], dry: 50, cost: 5000 }];
const PART = {}; PARTS.forEach(p => PART[p.id] = p);
const PRESETS = [['入门两级', ['tm', 'es', 'dc', 'tl', 'em']], ['单级试飞', ['ts', 'em']], ['三级重型', ['ts', 'es', 'dc', 'tm', 'em', 'dc', 'tl', 'el']],
  ['助推+回收', ['pc', 'pc', 'tm', 'es', 'dc', 'tl', 'sb', 'em']]];
const BL = ['.w', 'ww', 'wG', 'ww', 'wG', 'ww', 'wG', '.d'], BR = BL.map(r => [...r].reverse().join(''));
function overlay(rows, n) {                                  // 把 n 对助推器画在本级两侧(自下而上叠放)
  rows = rows.slice();
  for (let k = 0; k < n; k++) for (let i = 0; i < 8; i++) {
    const y = rows.length - 1 - (7 - i) - k * 8; if (y < 0) continue;
    const r = [...rows[y]]; r[0] = BL[i][0]; r[1] = BL[i][1]; r[11] = BR[i][0]; r[12] = BR[i][1]; rows[y] = r.join('');
  }
  return rows;
}
// 设计从上到下;分离器属于它下方的那一级。返回的级从下到上
function compile(dz) {
  const gs = [[]];
  for (const id of dz) { const p = PART[id]; if (p.k === 'd') gs.push([]); gs[gs.length - 1].push(p); }
  return gs.map(g => { let dry = 0, fuel = 0, F = 0, fe = 0, rows = [], nb = 0, ch = 0, cost = 0;
    for (const p of g) { dry += p.dry; cost += p.cost; fuel += p.fuel || 0; if (p.F) { F += p.F; fe += p.F / p.isp; } if (p.k === 'b') nb++; if (p.k === 'p') ch++; rows = rows.concat(p.rows.map(pad)); }
    return { dry, fuel, fuel0: fuel, F, isp: F ? F / fe : 300, rows: overlay(rows, nb), chutes: ch, cost }; }).reverse();
}
let design; try { design = JSON.parse(localStorage.getItem('sfs_design')); } catch (e) {}
if (!Array.isArray(design) || design.some(id => !PART[id])) design = PRESETS[0][1].slice();
const stars = []; for (let i = 0; i < 150; i++) stars.push([Math.random() * W | 0, Math.random() * H | 0, 80 + Math.random() * 175 | 0]);
const BY = [0, .5, .75, .25];

// ---------- 状态 ----------
let S, D, P, T, mpp, camx, camy, wi, msgT, flags;
const WARPS = [1, 2, 5, 10, 50, 100, 1000];
const rows = () => { let r = CAP; for (let i = S.stages.length - 1; i >= 0; i--) r = r.concat(S.stages[i].rows); return r; };
const chutesN = () => S.stages.reduce((s, t) => s + t.chutes, 0);
const mass = () => CAPM + S.stages.reduce((s, t) => s + t.dry + t.fuel, 0);
function reset() {
  const stg = compile(design), hh = (CAP.length + stg.reduce((s, t) => s + t.rows.length, 0)) / 2;
  S = { x: 0, y: earth.R + hh + .1, vx: 0, vy: 0, a: 0, w: 0, thr: 0, sas: 1, rot: 0, dead: 0, flame: 0, chute: 0, land: earth, landT: PI / 2, stages: stg };
  D = []; P = []; T = 0; mpp = .4; wi = 0; flags = {}; moonAt(0); msg('按 Shift 点火,空格分级,B 回组装', 4000);
}
function msg(t, ms) { $('msg').textContent = t; clearTimeout(msgT); msgT = setTimeout(() => $('msg').textContent = '', ms || 3000); }
function boom(x, y, n) { for (let i = 0; i < n; i++) { const a = Math.random() * 2 * PI, s = 5 + Math.random() * 30; P.push({ x, y, vx: Math.cos(a) * s + S.vx * .2, vy: Math.sin(a) * s + S.vy * .2, l: .6 + Math.random() }); } }
function crash() { S.dead = 1; S.thr = 0; boom(S.x, S.y, 60); msg('💥 坠毁!按 R 重来 · B 组装', 6000); }
function stage() {
  if (S.land || S.stages.length < 2 || S.dead) return;
  const ux = -Math.sin(S.a), uy = Math.cos(S.a), old = rows().length, st = S.stages[0], Lh = st.rows.length;
  D.push({ rows: st.rows, x: S.x - ux * (old - Lh) / 2, y: S.y - uy * (old - Lh) / 2, vx: S.vx - ux * 1.5, vy: S.vy - uy * 1.5, a: S.a, w: S.w + (Math.random() - .5) * .1 });
  S.x += ux * Lh / 2; S.y += uy * Lh / 2; S.stages.shift(); msg('分级!');
}

// ---------- 物理 ----------
function step(dt) {
  T += dt; moonAt(T);
  for (let i = D.length - 1; i >= 0; i--) {
    const d = D[i], g = grav(d.x, d.y); d.vx += g[0] * dt; d.vy += g[1] * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.a += d.w * dt;
    for (const b of bodies) if (Math.hypot(d.x - b.x, d.y - b.y) < b.R) { boom(d.x, d.y, 15); D.splice(i, 1); break; }
  }
  if (S.dead) return;
  const hh = rows().length / 2, st = S.stages[0], m = mass();
  if (S.land) {
    const b = S.land;
    if (S.thr > 0 && st.fuel > 0 && st.F * S.thr / m > b.g) { S.land = null; S.vx = b.vx; S.vy = b.vy; }
    else {
      const gr = b.R + terr(b, S.landT) + hh + .1;
      S.x = b.x + gr * Math.cos(S.landT); S.y = b.y + gr * Math.sin(S.landT); S.vx = b.vx; S.vy = b.vy; S.w = 0; S.flame = 0; return;
    }
  }
  const g = grav(S.x, S.y); let ax = g[0], ay = g[1], th = 0;
  if (S.thr > 0 && st.fuel > 0) {
    th = st.F * S.thr; st.fuel = Math.max(0, st.fuel - th / (st.isp * G) * dt);
    ax -= th / m * Math.sin(S.a); ay += th / m * Math.cos(S.a);
  }
  S.flame = th ? S.thr : 0;
  const ea = Math.hypot(S.x, S.y) - earth.R;
  if (ea < 8e4) {                                           // 大气阻力
    const rho = 1.2 * Math.exp(-Math.max(ea, 0) / 7000), sp = Math.hypot(S.vx, S.vy);
    if (sp > 0) { const f = .5 * rho * sp * sp * (3 + (S.chute ? 200 * chutesN() : 0)) / m; ax -= f * S.vx / sp; ay -= f * S.vy / sp; }
  }
  S.w += S.rot * .8 * dt; if (S.sas && !S.rot) S.w *= Math.exp(-3 * dt);
  S.vx += ax * dt; S.vy += ay * dt; S.x += S.vx * dt; S.y += S.vy * dt; S.a += S.w * dt;
  const bx = S.x + Math.sin(S.a) * hh, by = S.y - Math.cos(S.a) * hh;
  for (const b of bodies) {
    const dx = bx - b.x, dy = by - b.y, r = Math.sqrt(dx * dx + dy * dy);
    if (r > b.R + b.H + 5) continue;
    const t = Math.atan2(dy, dx);
    if (r <= b.R + terr(b, t)) {
      const vr = Math.hypot(S.vx - b.vx, S.vy - b.vy), dot = -Math.sin(S.a) * Math.cos(t) + Math.cos(S.a) * Math.sin(t);
      if (vr < 15 && dot > .9) {
        S.land = b; S.landT = t; S.a = t - PI / 2; S.w = 0; S.chute = 0;
        msg('着陆成功 · ' + b.name);
        if (b === moon && !flags.ml) { flags.ml = 1; msg('🌙 月球着陆成功!', 6000); }
      } else crash();
      break;
    }
  }
}
function chute() {
  if (S.dead || S.land || S.chute) return;
  if (!chutesN()) { msg('没有降落伞(或已随分级丢失)'); return; }
  const ea = Math.hypot(S.x, S.y) - earth.R;
  if (ea > 25000) { msg('高度太高,低于 25 km 再开伞'); return; }
  const q = .5 * 1.2 * Math.exp(-Math.max(ea, 0) / 7000) * (S.vx * S.vx + S.vy * S.vy);
  if (q > 9000) { S.stages.forEach(t => t.chutes = 0); boom(S.x, S.y + 8, 25); msg('降落伞被撕裂!开得太早/太快', 4000); return; }
  S.chute = 1; msg('降落伞展开');
}
function ref() { let best = earth, bg = 0; for (const b of bodies) { const dx = b.x - S.x, dy = b.y - S.y, g = b.mu / (dx * dx + dy * dy); if (g > bg) { bg = g; best = b; } } return best; }
function orbit(b) {
  const rx = S.x - b.x, ry = S.y - b.y, vx = S.vx - b.vx, vy = S.vy - b.vy, r = Math.hypot(rx, ry), v2 = vx * vx + vy * vy, mu = b.mu;
  const hz = rx * vy - ry * vx, rv = rx * vx + ry * vy, k = v2 - mu / r, ex = (k * rx - rv * vx) / mu, ey = (k * ry - rv * vy) / mu;
  const e = Math.hypot(ex, ey), eps = v2 / 2 - mu / r, a = -mu / (2 * eps), p = hz * hz / mu;
  return { e, p, w: Math.atan2(ey, ex), sg: hz >= 0 ? 1 : -1, ap: eps < 0 ? a * (1 + e) - b.R : Infinity, pe: (eps < 0 ? a * (1 - e) : p / (1 + e)) - b.R, r, vx, vy, rv };
}

// ---------- 渲染 ----------
function sky(alt, x, y) {
  const q = Math.floor(Math.exp(-Math.max(alt, 0) / 9000) * 8 + BY[(x & 1) | ((y & 1) << 1)] * .99) / 8;
  return q > 0 ? C(110 * q | 0, 180 * q | 0, 250 * q | 0) : 0;
}
function dirt(p, dp, x, y) { const k = (dp / 10 | 0) & 1; return (((x + y) & 1) && dp % 10 < 1.5 ? !k : k) ? p[5] : p[6]; }
function drawBody(b) {
  const s = 1 / mpp, cx = W / 2 + (b.x - camx) * s, cy = H / 2 - (b.y - camy) * s, rr = (b.R + b.H + (b.atm ? 8e4 : 0)) * s;
  if (cx + rr < 0 || cx - rr > W || cy + rr < 0 || cy - rr > H) return;
  const x0 = Math.max(0, cx - rr | 0), x1 = Math.min(W - 1, Math.ceil(cx + rr)), y0 = Math.max(0, cy - rr | 0), y1 = Math.min(H - 1, Math.ceil(cy + rr)), p = b.pal;
  for (let y = y0; y <= y1; y++) {
    const dy = (H / 2 - y - .5) * mpp + camy - b.y;
    for (let x = x0; x <= x1; x++) {
      const dx = (x + .5 - W / 2) * mpp + camx - b.x, r = Math.sqrt(dx * dx + dy * dy), alt = r - b.R; let c = 0;
      if (alt > b.H) { if (b.atm && alt < 8e4) c = sky(alt, x, y); }
      else if (alt < -40 * mpp) c = dirt(p, -alt / mpp, x, y);
      else {
        const h = terr(b, Math.atan2(dy, dx)), d = h - alt;
        if (d < 0) { if (b.atm) c = sky(alt, x, y); }
        else {
          const dp = d / mpp, snow = h > b.H * .6 && dp < 8, ch = (x + y) & 1;
          if (dp > 40) c = dirt(p, dp, x, y);
          else if (isW) c = dp < 2 ? p[2] : ch ? p[2] : p[3];
          else c = snow ? p[4] : dp < 2 ? p[0] : (ch && dp > 5 ? p[1] : p[0]);
        }
      }
      if (c) buf[y * W + x] = c;
    }
  }
}
function px(wx, wy, a, lx, ly, col) {
  const s = 1 / mpp, z = Math.max(1, Math.ceil(s)), ca = Math.cos(a), sa = Math.sin(a);
  const X = wx + lx * ca - ly * sa, Y = wy + lx * sa + ly * ca;
  ctx.fillStyle = col; ctx.fillRect(Math.round(W / 2 + (X - camx) * s - z / 2), Math.round(H / 2 - (Y - camy) * s - z / 2), z, z);
}
function drawRows(rs, wx, wy, a) {
  if (!rs.length) return;
  const h = rs.length, w = rs[0].length;
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) { const ch = rs[r][c]; if (ch !== '.') px(wx, wy, a, c - (w - 1) / 2, (h - 1) / 2 - r, PC[ch]); }
}
function drawChute(hh) {
  for (let x = -7; x <= 7; x++) { const dy = Math.round(Math.sqrt(49 - x * x) * .7); for (let k = 0; k <= dy; k++) px(S.x, S.y, S.a, x, hh + 12 + k, ((x + 8) >> 1) & 1 ? '#f4f4f4' : '#d83a3a'); }
  for (let t = 0; t <= 12; t++) for (const sg of [-1, 1]) px(S.x, S.y, S.a, sg * 7 * (1 - t / 12), hh + 12 * (t / 12) + 0.01, '#cfd3e0');
}
function drawOrbit(b, o) {
  if (mpp < 6 || S.land) return;
  const s = 1 / mpp, n = 720, nm = o.e < 1 ? PI : Math.acos(-1 / o.e) * .98; ctx.fillStyle = '#7df';
  for (let i = 0; i <= n; i += 1) {
    if ((i >> 1) & 1) continue;
    const nu = -nm + 2 * nm * i / n, r = o.p / (1 + o.e * Math.cos(nu)), an = o.w + o.sg * nu;
    const sx = W / 2 + (b.x + r * Math.cos(an) - camx) * s, sy = H / 2 - (b.y + r * Math.sin(an) - camy) * s;
    if (sx >= 0 && sx < W && sy >= 0 && sy < H) ctx.fillRect(sx | 0, sy | 0, 1, 1);
  }
}
function render(dt, rb, o) {
  buf.fill(0xFF000000);
  for (const s of stars) buf[s[1] * W + s[0]] = C(s[2], s[2], s[2]);
  for (const b of bodies) drawBody(b);
  ctx.putImageData(img, 0, 0);
  drawOrbit(rb, o);
  for (const d of D) if (mpp < 40) drawRows(d.rows, d.x, d.y, d.a);
  if (!S.dead) {
    const rs = rows(), hh = rs.length / 2;
    if (mpp < 40) {
      if (S.flame) {                                         // 像素火焰
        const F = S.stages[0].F, bw = F > 3e5 ? 5 : F > 1e5 ? 3 : 2, len = 4 + S.flame * (5 + F / 8e4);
        for (let i = 0; i < len; i++) {
          const t = i / len, wd = t < .35 ? bw : t < .7 ? Math.max(1, bw - 1) : 1, col = t < .35 ? '#fff3a0' : t < .7 ? '#ffb02e' : '#e8531f';
          for (let k = 0; k < wd; k++) if (Math.random() > .15) px(S.x, S.y, S.a, k - (wd - 1) / 2, -hh - 1 - i, col);
        }
      }
      drawRows(rs, S.x, S.y, S.a);
      if (S.chute && chutesN()) drawChute(hh);
    } else { const s = 1 / mpp; ctx.fillStyle = '#fff'; ctx.fillRect(W / 2 - 2, H / 2 - 2, 4, 4); ctx.fillStyle = '#f33'; ctx.fillRect(W / 2 - 1, H / 2 - 1, 2, 2); }
  }
  for (let i = P.length - 1; i >= 0; i--) {
    const p = P[i]; p.x += p.vx * dt; p.y += p.vy * dt; p.l -= dt; if (p.l <= 0) { P.splice(i, 1); continue; }
    if (mpp < 80) px(p.x, p.y, 0, 0, 0, p.l > .6 ? '#ffe27a' : p.l > .3 ? '#ff8a2a' : '#8a3a1a');
  }
}

// ---------- HUD ----------
const f = m => m === Infinity ? '∞' : Math.abs(m) >= 1e4 ? (m / 1e3).toFixed(1) + ' km' : m.toFixed(0) + ' m';
function hud(rb, o, eff) {
  const st = S.stages[0], m = mass(), g = rb.mu / (o.r * o.r);
  $('rb').textContent = '参照:' + rb.name; $('alt').textContent = f(o.r - rb.R);
  $('spd').textContent = Math.hypot(o.vx, o.vy).toFixed(0) + ' m/s'; $('vs').textContent = (o.rv / o.r).toFixed(0) + ' m/s';
  $('ap').textContent = f(o.ap); $('pe').textContent = f(o.pe); $('twr').textContent = (st.F / (m * g)).toFixed(2);
  $('mass').textContent = (m / 1000).toFixed(1) + ' t'; $('warp').textContent = 'x' + eff + (eff < WARPS[wi] ? '(受限)' : '');
  $('stg').textContent = S.stages.length; $('pch').textContent = chutesN() ? (S.chute ? '已展开' : '待命 x' + chutesN() + ' (P)') : '无'; $('sas').textContent = S.sas ? '开' : '关';
  $('thb').style.height = S.thr * 100 + '%'; $('fub').style.height = st.fuel / st.fuel0 * 100 + '%';
  if (!flags.orb && !S.land && rb === earth && o.pe > 75000 && o.e < 1) { flags.orb = 1; msg('🛰 已进入地球轨道!去月球看看?', 6000); }
}

// ---------- 输入 ----------
const K = {};
addEventListener('keydown', e => {
  if (['Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'ControlLeft'].includes(e.code)) e.preventDefault();
  if (e.code === 'KeyB' && !e.repeat) { openBuild(); return; }
  if (building || e.repeat) return; K[e.code] = 1;
  if (e.code === 'Space') stage();
  if (e.code === 'KeyP') chute();
  if (e.code === 'KeyZ') S.thr = 1; if (e.code === 'KeyX') S.thr = 0;
  if (e.code === 'KeyT') S.sas ^= 1; if (e.code === 'KeyR') reset();
  if (e.code === 'Period') wi = Math.min(WARPS.length - 1, wi + 1); if (e.code === 'Comma') wi = Math.max(0, wi - 1);
});
addEventListener('keyup', e => K[e.code] = 0);
const zoom = k => mpp = clamp(mpp * k, .2, 1e5);
addEventListener('wheel', e => { zoom(e.deltaY > 0 ? 1.15 : 1 / 1.15); e.preventDefault(); }, { passive: false });
addEventListener('keydown', e => { if (e.code === 'Equal' || e.code === 'NumpadAdd') zoom(1 / 1.25); if (e.code === 'Minus' || e.code === 'NumpadSubtract') zoom(1.25); });

// ---------- 主循环 ----------
let last = performance.now(), hudT = 0;
reset();

// ---------- 组装界面 ----------
let building = true;
const pc = $('pv').getContext('2d');
function openBuild() { building = true; for (const k in K) K[k] = 0; $('build').classList.remove('hide'); bRefresh(); }
function bRefresh() {
  const stg = compile(design); let rs = CAP; for (let i = stg.length - 1; i >= 0; i--) rs = rs.concat(stg[i].rows);
  const cell = Math.max(3, Math.min(14, Math.floor(400 / rs.length))), ox = (200 - 13 * cell) / 2;
  pc.clearRect(0, 0, 200, 420);
  rs.forEach((r, y) => { for (let x = 0; x < 13; x++) if (r[x] !== '.') { pc.fillStyle = PC[r[x]]; pc.fillRect(ox + x * cell, 10 + y * cell, cell, cell); } });
  const tot = CAPM + stg.reduce((s, t) => s + t.dry + t.fuel, 0); let dvT = 0, html = '';
  for (let i = 0; i < stg.length; i++) {
    let m0 = CAPM; for (let j = i; j < stg.length; j++) m0 += stg[j].dry + stg[j].fuel;
    const s = stg[i], dv = s.F && s.fuel ? s.isp * G * Math.log(m0 / (m0 - s.fuel)) : 0; dvT += dv;
    html += `第${i + 1}级${i ? '' : '(底)'}:Δv <b>${dv | 0}</b> m/s · 推力 ${s.F / 1000 | 0} kN · 燃料 ${s.fuel | 0} kg<br>`;
  }
  const twr = stg[0].F / (tot * 9.8), cost = CAPCOST + stg.reduce((s, t) => s + t.cost, 0), ok = stg[0].F > 0 && twr > 1 && cost <= BUDGET;
  html += `<hr>总 Δv <b>${dvT | 0}</b> m/s(入轨约需 3500~4000)<br>起飞质量 ${(tot / 1000).toFixed(1)} t · 高度 ${rs.length} m<br>起飞推重比 <b>${twr.toFixed(2)}</b><br>降落伞 ${stg.reduce((s, t) => s + t.chutes, 0)} 个 · 造价 <b>$${cost.toLocaleString()}</b> / 预算 $${BUDGET.toLocaleString()}`;
  html += ok ? '' : '<br><em>' + (cost > BUDGET ? '超出预算' : stg[0].F ? '推重比需大于 1 才能起飞' : '最底部一级需要引擎') + '</em>';
  $('stats').innerHTML = html; $('bgo').disabled = !ok;
}
function btn(parent, html, fn) { const b = document.createElement('button'); b.innerHTML = html; b.onclick = fn; parent.appendChild(b); return b; }
PARTS.forEach(p => btn($('plist'), `<b>${p.name}</b> · $${p.cost / 1000}k<small>${{ t: '燃料 ' + p.fuel + ' kg', e: '推力 ' + p.F / 1000 + ' kN · Isp ' + p.isp, b: '推力 ' + p.F / 1000 + ' kN · 燃料 ' + p.fuel + ' kg · 与本级共用燃料', p: '按 P 开伞(低于 25 km,速度别太快)', d: '到此分级' }[p.k]} · 干重 ${p.dry} kg</small>`,
  () => { if (design.length < 24) { design.push(p.id); bRefresh(); } }));
btn($('pre'), '撤销', () => { design.pop(); bRefresh(); });
btn($('pre'), '清空', () => { design = []; bRefresh(); });
PRESETS.forEach(p => btn($('pre'), p[0], () => { design = p[1].slice(); bRefresh(); }));
$('bgo').onclick = () => {
  try { localStorage.setItem('sfs_design', JSON.stringify(design)); } catch (e) {}
  building = false; $('build').classList.add('hide'); reset(); last = performance.now();
};
bRefresh();

function frame(now) {
  if (building) { last = now; requestAnimationFrame(frame); return; }
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  S.rot = (K.KeyA || K.ArrowLeft ? 1 : 0) - (K.KeyD || K.ArrowRight ? 1 : 0);
  if (!S.dead) {
    if (K.ShiftLeft || K.ShiftRight || K.KeyW) S.thr = Math.min(1, S.thr + dt * .7);
    if (K.ControlLeft || K.KeyS) S.thr = Math.max(0, S.thr - dt * .7);
  }
  const thrusting = S.thr > 0 && S.stages[0].fuel > 0 && !S.dead, chuting = S.chute && chutesN() > 0, lowAtm = !S.land && !chuting && Math.hypot(S.x, S.y) - earth.R < 7e4;
  const eff = thrusting || lowAtm ? 1 : Math.min(WARPS[wi], chuting ? 50 : 1e3), slow = thrusting || lowAtm, n = Math.ceil(dt * eff / (slow ? .02 : .25));
  for (let i = 0; i < n; i++) step(dt * eff / n);
  camx = S.x; camy = S.y;
  const rb = ref(), o = orbit(rb);
  render(dt, rb, o);
  if ((hudT += dt) > .1) { hudT = 0; hud(rb, o, eff); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.SFS = { get S() { return S; } };
})();
