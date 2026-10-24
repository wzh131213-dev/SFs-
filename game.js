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
const mk = o => { o.mu = o.mu || o.g * o.R * o.R; o.x = o.y = o.vx = o.vy = 0; o.type = o.type || 'rock'; return o; };
const AU = 1.5e9, pl = (a, b, sn, d1, d2) => [C(...a), C(...b), 0, 0, C(...sn), C(...d1), C(...d2)], gs = (a, b) => [C(...a), C(...b)];
const sun = mk({ name: '太阳', type: 'sun', R: 6.5e7, g: 0, mu: 1.215e17, H: 0, seed: 0, col: '#ffd23a' });
const mercury = mk({ name: '水星', R: 2.3e5, g: 3.7, H: 2500, seed: 7, col: '#b5a79a', orb: { p: sun, a: .39 * AU, ph: 2 }, pal: pl([150,140,130], [120,112,105], [200,195,190], [100,92,85], [80,74,70]) });
const venus = mk({ name: '金星', R: 5.7e5, g: 8.9, H: 3000, seed: 9, col: '#e8c070', orb: { p: sun, a: .72 * AU, ph: 4 }, pal: pl([210,170,90], [185,145,70], [240,225,190], [160,110,60], [130,90,50]), atm: { rho: 25, hs: 8000, top: 1e5, col: [240,190,100], sk: 12000, dim: 1 } });
// pal: 0草顶 1草 2水 3深水 4雪 5土1 6土2
const earth = mk({ name: '地球', R: 6e5, g: 9.8, H: 4000, seed: 1, water: 1, col: '#3a7be0', orb: { p: sun, a: AU, ph: 0 },
  pal: [C(96,200,72), C(60,150,60), C(40,100,210), C(30,70,170), C(240,245,255), C(120,80,50), C(98,64,40)], atm: { rho: 1.2, hs: 7000, top: 8e4, col: [110,180,250], sk: 9000, dim: 1 } });
const moon = mk({ name: '月球', R: 1.5e5, g: 1.6, H: 3000, seed: 5, col: '#cfd0d6', orb: { p: earth, a: 1.2e7, ph: .5 },
  pal: [C(196,196,202), C(160,160,168), 0, 0, C(210,210,215), C(112,112,120), C(92,92,100)] });
const mars = mk({ name: '火星', R: 3.2e5, g: 3.7, H: 5000, seed: 11, col: '#d8613a', orb: { p: sun, a: 1.52 * AU, ph: .77 }, pal: pl([190,100,60], [165,80,50], [240,230,225], [150,70,45], [120,55,38]), atm: { rho: .02, hs: 11000, top: 6e4, col: [210,150,110], sk: 14000, dim: .45 } });
const gas = (name, R, g, a, ph, col, c1, c2, ac) => mk({ name, type: 'gas', R, g, H: 0, seed: 3, col, orb: { p: sun, a: a * AU, ph }, pal: gs(c1, c2), atm: { rho: 1.5, hs: 40000, top: 4e5, col: ac, sk: 80000, dim: .7 } });
const jupiter = gas('木星', 6.7e6, 24.8, 5.2, 3.1, '#d9b38c', [214,180,140], [176,132,96], [230,200,160]);
const saturn = gas('土星', 5.7e6, 10.4, 9.58, 5, '#e6d29a', [230,210,160], [200,175,120], [235,215,170]);
const sat = (name, par, R, g, H, a, ph, col, pal, seed, atm) => mk({ name, R, g, H, seed, col, orb: { p: par, a, ph }, pal, atm });
const bodies = [sun, mercury, venus, earth, moon, mars, jupiter,
  sat('木卫一', jupiter, 1.7e5, 1.8, 1500, 4e7, .3, '#e8d36a', pl([230,205,90], [200,170,60], [250,240,200], [170,120,40], [140,95,35]), 21),
  sat('木卫二', jupiter, 1.47e5, 1.3, 800, 6.3e7, 2.1, '#d8e4f0', pl([225,235,245], [190,210,230], [255,255,255], [150,170,195], [120,140,170]), 22),
  sat('木卫三', jupiter, 2.5e5, 1.4, 2000, 1e8, 4, '#a89a8a', pl([160,150,140], [130,120,110], [210,205,200], [100,92,84], [80,74,68]), 23),
  sat('木卫四', jupiter, 2.3e5, 1.2, 2000, 1.8e8, 5.5, '#756a60', pl([110,104,98], [88,82,76], [170,165,160], [70,64,60], [56,52,48]), 24),
  saturn,
  sat('土卫二', saturn, 2.4e4, .11, 300, 2.2e7, 1, '#f4f8ff', pl([245,248,255], [220,230,245], [255,255,255], [190,200,220], [160,170,195]), 25),
  sat('土卫五', saturn, 7.2e4, .26, 1000, 5e7, 3.3, '#b8b4ae', pl([185,180,172], [155,150,142], [225,222,218], [120,116,110], [96,92,88]), 26),
  sat('土卫六', saturn, 2.4e5, 1.35, 1500, 1.15e8, 5, '#e0a050', pl([200,140,70], [170,115,55], [240,210,160], [140,95,45], [110,75,38]), 27,
    { rho: 5, hs: 15000, top: 2e5, col: [225,150,70], sk: 30000, dim: 1 }),
  gas('天王星', 2.4e6, 8.9, 19.2, 1.5, '#8fd8e0', [150,215,225], [120,190,205], [150,215,225]),
  gas('海王星', 2.3e6, 11.2, 30.1, 4.4, '#4a6fe0', [70,100,220], [50,75,180], [90,120,230])];
bodies.forEach(b => { if (b.orb) b.orb.w = Math.sqrt(b.orb.p.mu / b.orb.a ** 3); });
function railsAt(T) {                                         // 所有天体沿圆轨道运行(子天体叠加父天体速度)
  for (const b of bodies) {
    if (!b.orb) continue; const o = b.orb, a = o.ph + o.w * T, c = Math.cos(a), sn = Math.sin(a);
    b.x = o.p.x + o.a * c; b.y = o.p.y + o.a * sn; b.vx = o.p.vx - o.a * o.w * sn; b.vy = o.p.vy + o.a * o.w * c;
  }
}
let isW = 0;
function terr(b, t) {
  let d = Math.abs(t - PI / 2); if (d > PI) d = 2 * PI - d;
  const m = b === earth ? sm(.003, .03, d) : 1;           // 发射台附近保持平坦
  const v = Math.sin(t * 7 + b.seed) * .5 + Math.sin(t * 19 + b.seed * 2) * .3 + Math.sin(t * 53 + b.seed * 3) * .2;
  isW = b.water && v < 0 && m > .3 ? 1 : 0;
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
let S, D, P, T, mpp, camx, camy, wi, msgT, flags, mapMode = false, mf = 0, mm = 4e8, NAV = null, tgt = null, autoW = 0, node = null, NODE = null, alignOn = false;
const WARPS = [1, 2, 5, 10, 50, 100, 1000, 1e4, 1e5, 1e6];
const rows = () => { let r = CAP; for (let i = S.stages.length - 1; i >= 0; i--) r = r.concat(S.stages[i].rows); return r; };
const chutesN = () => S.stages.reduce((s, t) => s + t.chutes, 0);
const mass = () => CAPM + S.stages.reduce((s, t) => s + t.dry + t.fuel, 0);
function reset() {
  const stg = compile(design), hh = (CAP.length + stg.reduce((s, t) => s + t.rows.length, 0)) / 2;
  S = { x: 0, y: 0, vx: 0, vy: 0, a: 0, w: 0, thr: 0, sas: 1, rot: 0, dead: 0, flame: 0, chute: 0, land: earth, landT: PI / 2, stages: stg };
  D = []; P = []; T = 0; autoW = 0; node = null; NODE = null; alignOn = false; mpp = .4; wi = 0; flags = {}; railsAt(0); S.x = earth.x; S.y = earth.y + earth.R + hh + .1; S.vx = earth.vx; S.vy = earth.vy; msg('按 Shift 点火,空格分级,B 回组装', 4000);
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
  let done = 0; const adv = () => { if (!done) { done = 1; T += dt; railsAt(T); } };   // 天体与火箭同步推进到 T+dt
  for (let i = D.length - 1; i >= 0; i--) {
    const d = D[i], g = grav(d.x, d.y); d.vx += g[0] * dt; d.vy += g[1] * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.a += d.w * dt;
    for (const b of bodies) if (Math.hypot(d.x - b.x, d.y - b.y) < b.R) { boom(d.x, d.y, 15); D.splice(i, 1); break; }
  }
  if (S.dead) { adv(); return; }
  const hh = rows().length / 2, st = S.stages[0], m = mass();
  if (S.land) {
    const b = S.land;
    if (S.thr > 0 && st.fuel > 0 && st.F * S.thr / m > b.g) { S.land = null; S.vx = b.vx; S.vy = b.vy; }
    else {
      adv(); const gr = b.R + terr(b, S.landT) + hh + .1;
      S.x = b.x + gr * Math.cos(S.landT); S.y = b.y + gr * Math.sin(S.landT); S.vx = b.vx; S.vy = b.vy; S.w = 0; S.flame = 0; return;
    }
  }
  const g = grav(S.x, S.y); let ax = g[0], ay = g[1], th = 0;
  if (S.thr > 0 && st.fuel > 0) {
    th = st.F * S.thr; st.fuel = Math.max(0, st.fuel - th / (st.isp * G) * dt);
    ax -= th / m * Math.sin(S.a); ay += th / m * Math.cos(S.a);
    if (node && NODE) { const cs = -Math.sin(S.a) * NODE.dirx + Math.cos(S.a) * NODE.diry; if (cs > 0) node.burned += th / m * cs * dt; }
  }
  S.flame = th ? S.thr : 0;
  for (const b of bodies) if (b.atm) {                       // 各天体的大气阻力(相对该天体的速度)
    const al = Math.hypot(S.x - b.x, S.y - b.y) - b.R; if (al >= b.atm.top) continue;
    const rho = b.atm.rho * Math.exp(-Math.max(al, 0) / b.atm.hs), rx = S.vx - b.vx, ry = S.vy - b.vy, sp = Math.hypot(rx, ry), q = .5 * rho * sp * sp;
    if (q > 2.5e5) { crash(); msg('💥 气动载荷过大,箭体解体', 5000); adv(); return; }
    if (sp > 0) { const f = q * (3 + (S.chute ? 200 * chutesN() : 0)) / m; ax -= f * rx / sp; ay -= f * ry / sp; }
  }
  S.w += S.rot * .8 * dt; if (S.sas && !S.rot) S.w *= Math.exp(-3 * dt);
  const fx = ax - g[0], fy = ay - g[1];                      // 推力+阻力(本步视为常量)
  S.x += S.vx * dt + .5 * ax * dt * dt; S.y += S.vy * dt + .5 * ay * dt * dt; S.a += S.w * dt;
  adv(); const g1 = grav(S.x, S.y);                          // 速度 Verlet:用新位置的引力修正速度
  S.vx += (.5 * (g[0] + g1[0]) + fx) * dt; S.vy += (.5 * (g[1] + g1[1]) + fy) * dt;
  const bx = S.x + Math.sin(S.a) * hh, by = S.y - Math.cos(S.a) * hh;
  for (const b of bodies) {
    const dx = bx - b.x, dy = by - b.y, r = Math.sqrt(dx * dx + dy * dy);
    if (r > b.R + b.H + 5) continue;
    const t = Math.atan2(dy, dx);
    if (r <= b.R + terr(b, t)) {
      if (b.type !== 'rock') { crash(); msg(b.type === 'sun' ? '🔥 被太阳吞没!' : '坠入' + b.name + '深处', 6000); break; }
      const vr = Math.hypot(S.vx - b.vx, S.vy - b.vy), dot = -Math.sin(S.a) * Math.cos(t) + Math.cos(S.a) * Math.sin(t);
      if (vr < 15 && dot > .9) {
        S.land = b; S.landT = t; S.a = t - PI / 2; S.w = 0; S.chute = 0;
        msg('着陆成功 · ' + b.name);
        if (b !== earth && !flags['L' + b.name]) { flags['L' + b.name] = 1; msg('🚩 首次登陆' + b.name + '!', 6000); }
      } else crash();
      break;
    }
  }
}
function chute() {
  if (S.dead || S.land || S.chute) return;
  if (!chutesN()) { msg('没有降落伞(或已随分级丢失)'); return; }
  let ab = null, ea = 0;
  for (const b of bodies) if (b.atm && b.type === 'rock') { const al = Math.hypot(S.x - b.x, S.y - b.y) - b.R; if (al < b.atm.hs * 3.5) { ab = b; ea = al; } }
  if (!ab) { msg('高度太高或没有大气,伞无效'); return; }
  const rx = S.vx - ab.vx, ry = S.vy - ab.vy, q = .5 * ab.atm.rho * Math.exp(-Math.max(ea, 0) / ab.atm.hs) * (rx * rx + ry * ry);
  if (q > 9000) { S.stages.forEach(t => t.chutes = 0); boom(S.x, S.y + 8, 25); msg('降落伞被撕裂!开得太早/太快', 4000); return; }
  S.chute = 1; msg('降落伞展开');
}
function adt() {                                              // 自适应步长:离天体越近、相对速度越大,步长越小
  let d = 300;
  for (const b of bodies) { const r = Math.hypot(b.x - S.x, b.y - S.y), v = Math.hypot(S.vx - b.vx, S.vy - b.vy) + 1; d = Math.min(d, .015 * r / v); }
  return Math.max(d, .02);
}
const stC = z => z > 1e-6 ? (1 - Math.cos(Math.sqrt(z))) / z : z < -1e-6 ? (Math.cosh(Math.sqrt(-z)) - 1) / -z : .5 - z / 24;
const stS = z => z > 1e-6 ? (Math.sqrt(z) - Math.sin(Math.sqrt(z))) / z ** 1.5 : z < -1e-6 ? (Math.sinh(Math.sqrt(-z)) - Math.sqrt(-z)) / (-z) ** 1.5 : 1 / 6 - z / 120;
function kep(mu, r0, v0, dt) {                                // 通用变量开普勒传播(椭圆/双曲线都适用)
  const sq = Math.sqrt(mu), r = Math.hypot(r0[0], r0[1]), v2 = v0[0] ** 2 + v0[1] ** 2, vr = (r0[0] * v0[0] + r0[1] * v0[1]) / r, al = 2 / r - v2 / mu;
  if (al > 0) dt %= 2 * PI / (sq * al ** 1.5);
  let x = sq * Math.abs(al) * dt;
  for (let i = 0; i < 60; i++) {
    const z = al * x * x, C = stC(z), Sv = stS(z), F = r * vr / sq * x * x * C + (1 - al * r) * x ** 3 * Sv + r * x - sq * dt;
    const dF = r * vr / sq * x * (1 - z * Sv) + (1 - al * r) * x * x * C + r, d = F / dF; x -= d; if (Math.abs(d) < 1e-9 * Math.max(1, Math.abs(x))) break;
  }
  const z = al * x * x, C = stC(z), Sv = stS(z), f = 1 - x * x / r * C, g = dt - x ** 3 / sq * Sv;
  const R = [f * r0[0] + g * v0[0], f * r0[1] + g * v0[1]], rn = Math.hypot(R[0], R[1]), fd = sq / (rn * r) * (z * Sv - 1) * x, gd = 1 - x * x / rn * C;
  return [R, [fd * r0[0] + gd * v0[0], fd * r0[1] + gd * v0[1]]];
}
function tAnom(o, b, far) {                                   // 距下一次近点(far=0)/远点(far=1)的秒数
  const e = o.e, TP = 2 * PI; let nu = o.sg * (Math.atan2(S.y - b.y, S.x - b.x) - o.w); nu = ((nu + PI) % TP + TP) % TP - PI;
  if (e < 1) {
    const a = o.p / (1 - e * e), n = Math.sqrt(b.mu / a ** 3), E = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2)), M = E - e * Math.sin(E);
    let d = ((far ? PI : TP) - M) % TP; if (d < 0) d += TP; return d / n;
  }
  if (far) return NaN;
  const a = o.p / (e * e - 1), n = Math.sqrt(b.mu / a ** 3), F = 2 * Math.atanh(Math.sqrt((e - 1) / (e + 1)) * Math.tan(nu / 2)), M = e * Math.sinh(F) - F;
  return M < 0 ? -M / n : NaN;
}
const fmT = s => { s = Math.max(0, Math.abs(s)); return (s >= 86400 ? (s / 86400 | 0) + 'd' : '') + (s >= 3600 ? (s / 3600 % 24 | 0) + 'h' : '') + (s / 60 % 60 | 0) + 'm' + (s % 60 | 0) + 's'; };
function nodeCalc() {                                         // 节点处的位置/速度、Δv 向量、点火后轨道、燃烧时间
  const n = node, b = n.b, st = kep(b.mu, [S.x - b.x, S.y - b.y], [S.vx - b.vx, S.vy - b.vy], Math.max(0, n.t - T)), r = st[0], v = st[1];
  const vm = Math.hypot(v[0], v[1]) || 1, rm = Math.hypot(r[0], r[1]) || 1;
  const dvx = n.p * v[0] / vm + n.r * r[0] / rm, dvy = n.p * v[1] / vm + n.r * r[1] / rm, tot = Math.hypot(dvx, dvy);
  const rem = Math.max(0, tot - n.burned), k = tot ? rem / tot : 0, post = orbitFrom(b, r[0], r[1], v[0] + dvx * k, v[1] + dvy * k);
  const s0 = S.stages[0], ve = s0.isp * G, burn = s0.F ? mass() * ve / s0.F * (1 - Math.exp(-rem / ve)) : Infinity;
  return { b, dt: n.t - T, tot, rem, dirx: tot ? dvx / tot : 0, diry: tot ? dvy / tot : 0, post, burn, px: b.x + r[0], py: b.y + r[1] };
}
function nodeText() {
  if (!node || !NODE) return '';
  const N = NODE;
  return `\n✦ 节点 ${N.dt > 0 ? 'T-' + fmT(N.dt) : '执行中'}${alignOn ? ' · 对准中' : ''}\nΔv 剩余 ${N.rem.toFixed(0)}/${N.tot.toFixed(0)} m/s · 燃烧约 ${isFinite(N.burn) ? N.burn.toFixed(0) + ' s' : '—'}\n点火后:近点 ${f(N.post.pe)} 远点 ${f(N.post.ap)}`;
}
function toggleNode() {
  if (node) { node = null; NODE = null; alignOn = false; msg('已删除机动节点'); return; }
  if (S.land || S.dead) { msg('入轨后才能规划机动节点'); return; }
  const b = ref(), o = orbit(b), ta = o.e < 1 ? tAnom(o, b, 1) : NaN;
  node = { b, t: T + (isFinite(ta) ? ta : 300), p: 100, r: 0, burned: 0 }; msg('✦ 机动节点已创建(右上角面板调整)', 3500);
}
function drawNode() {                                         // 节点菱形标记 + 燃烧方向
  if (!node || !NODE) return; const s = 1 / mpp, N = NODE, sx = W / 2 + (N.px - camx) * s, sy = H / 2 - (N.py - camy) * s;
  ctx.font = '8px monospace'; ctx.fillStyle = '#ffe14a';
  if (sx > 4 && sx < W - 4 && sy > 12 && sy < H - 4) {
    for (let k = -2; k <= 2; k++) { const w = 5 - 2 * Math.abs(k); ctx.fillRect(sx - (w >> 1) | 0, sy + k | 0, w, 1); }
    ctx.fillText('节点 ' + (N.dt > 0 ? fmT(N.dt) : '执行中'), sx + 6 | 0, sy + 3 | 0);
  }
  if (!mapMode && mpp < 40 && N.rem > 0) { const cx = W / 2 + (S.x - camx) * s, cy = H / 2 - (S.y - camy) * s; for (let i = 14; i <= 30; i += 2) ctx.fillRect(cx + N.dirx * i | 0, cy - N.diry * i | 0, 2, 2); }
}
const anc = b => { const r = [b]; while (r[r.length - 1].orb) r.push(r[r.length - 1].orb.p); return r; };
function navInfo() {                                          // 目标距离 + 霍曼转移窗口
  if (!tgt) return null;
  const rb = ref(), rc = anc(rb), tc = anc(tgt), TP = 2 * PI, wrap = x => ((x % TP) + TP) % TP;
  const out = { dist: Math.hypot(tgt.x - S.x, tgt.y - S.y), rv: Math.hypot(tgt.vx - S.vx, tgt.vy - S.vy), win: null };
  const ib = tc.indexOf(rb); if (ib === 0) return out;
  let P = null, on = null, tn = null;                         // P=公共父天体, on=出发节点(null=火箭自己), tn=目标节点
  if (ib > 0) { P = rb; tn = tc[ib - 1]; }
  else for (let i = 1; i < rc.length; i++) { const j = tc.indexOf(rc[i]); if (j >= 0) { P = rc[i]; on = rc[i - 1]; tn = j > 0 ? tc[j - 1] : null; break; } }
  if (!P || !tn || tn === on) return out;
  const mu = P.mu; let r1, w1, th1;
  if (on) { r1 = on.orb.a; w1 = on.orb.w; th1 = Math.atan2(on.y - P.y, on.x - P.x); }
  else { r1 = Math.hypot(S.x - P.x, S.y - P.y); w1 = Math.sqrt(mu / r1 ** 3); th1 = Math.atan2(S.y - P.y, S.x - P.x); }
  const r2 = tn.orb.a, w2 = tn.orb.w, th2 = Math.atan2(tn.y - P.y, tn.x - P.x), aT = (r1 + r2) / 2, tT = PI * Math.sqrt(aT ** 3 / mu);
  const phi = PI - w2 * tT, d0 = th2 - th1, rate = w2 - w1;
  const tw = rate > 0 ? wrap(phi - d0) / rate : rate < 0 ? wrap(d0 - phi) / -rate : Infinity;
  const vinf = Math.abs(Math.sqrt(mu * (2 / r1 - 1 / aT)) - Math.sqrt(mu / r1));
  let dv = vinf; if (on) { const rp = Math.hypot(S.x - on.x, S.y - on.y); dv = Math.sqrt(vinf * vinf + 2 * on.mu / rp) - Math.sqrt(on.mu / rp); }
  const va = Math.abs(Math.sqrt(mu / r2) - Math.sqrt(mu * (2 / r2 - 1 / aT))), rcap = tn.R + (tn.atm ? tn.atm.top * 1.2 : 3e4);
  const dvA = Math.sqrt(va * va + 2 * tn.mu / rcap) - Math.sqrt(tn.mu / rcap);
  out.win = { P, on, tn, r1, r2, th1, w1, tT, tw, dv, dvA, cur: wrap(d0), need: wrap(phi), open: Math.abs(wrap(d0 - phi + PI) - PI) < .06 };
  return out;
}
function navText() {
  if (!tgt) return 'N 键选择目标(航点)';
  if (!NAV) return '';
  let t = `▶ ${tgt.name} · 距离 ${f(NAV.dist)} · 相对 ${NAV.rv.toFixed(0)} m/s`; const w = NAV.win; if (!w) return t;
  const d = x => (x / 86400).toFixed(1) + ' 天', dg = x => (x * 180 / PI).toFixed(0) + '°';
  t += `\n霍曼转移(绕${w.P.name}) · 飞行 ${d(w.tT)}\n相位 ${dg(w.cur)} / 需 ${dg(w.need)} · ` + (w.open ? '✔ 窗口开启' : isFinite(w.tw) ? '窗口 ' + d(w.tw) + ' 后(J 加速)' : '无窗口');
  t += `\n出发Δv≈${w.dv | 0} m/s · 捕获Δv≈${w.dvA | 0} m/s` + (w.tn !== tgt ? `\n(先飞往${w.tn.name},再去${tgt.name})` : '');
  return t;
}
function cycleTarget() {
  const l = bodies.filter(b => b !== sun), i = l.indexOf(tgt); tgt = i + 1 < l.length ? l[i + 1] : null;
  msg(tgt ? '🎯 目标:' + tgt.name : '已取消目标', 2500);
}
function drawTarget() {                                       // 目标标记:屏内画方括号,屏外画边缘箭头;地图里再连一条虚线
  if (!tgt) return;
  const s = 1 / mpp, sx = W / 2 + (tgt.x - camx) * s, sy = H / 2 - (tgt.y - camy) * s, rr = Math.max(tgt.R * s, 3) + 5;
  ctx.font = '8px monospace'; ctx.fillStyle = '#ffb35c';
  if (sx > 6 && sx < W - 6 && sy > 14 && sy < H - 6) {
    for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { ctx.fillRect(sx + a * rr - (a > 0 ? 3 : 0) | 0, sy + b * rr | 0, 4, 1); ctx.fillRect(sx + a * rr | 0, sy + b * rr - (b > 0 ? 3 : 0) | 0, 1, 4); }
  } else {
    const dx = sx - W / 2, dy = sy - H / 2, k = Math.min((W / 2 - 12) / Math.abs(dx || 1e-9), (H / 2 - 16) / Math.abs(dy || 1e-9)), ax = W / 2 + dx * k, ay = H / 2 + dy * k;
    ctx.fillRect(ax - 3 | 0, ay - 3 | 0, 7, 7);
    if (NAV) ctx.fillText(tgt.name + ' ' + f(NAV.dist), clamp(ax - 30, 2, W - 90) | 0, clamp(ay + 12, 12, H - 4) | 0);
  }
  if (mapMode) { const x0 = W / 2 + (S.x - camx) * s, y0 = H / 2 - (S.y - camy) * s, n = Math.hypot(sx - x0, sy - y0) / 6 | 0;
    for (let i = 1; i < Math.min(n, 120); i++) { const x = x0 + (sx - x0) * i / n, y = y0 + (sy - y0) * i / n; if (x >= 0 && x < W && y >= 0 && y < H) ctx.fillRect(x | 0, y | 0, 1, 1); } }
}
function drawTransfer() {                                     // 地图里画霍曼转移半椭圆 + 出发/到达点
  const w = NAV && NAV.win; if (!w) return; const s = 1 / mpp, P = w.P;
  const aT = (w.r1 + w.r2) / 2, e = Math.abs(w.r2 - w.r1) / (w.r1 + w.r2), p = aT * (1 - e * e), outw = w.r2 > w.r1;
  const th = w.th1 + (isFinite(w.tw) ? w.w1 * w.tw : 0), wp = outw ? th : th + PI, n0 = outw ? 0 : PI;
  const sc = (X, Y) => [W / 2 + (X - camx) * s, H / 2 - (Y - camy) * s];
  ctx.fillStyle = w.open ? '#7dff9a' : '#ffa84a';
  for (let i = 0; i <= 240; i += 2) {
    const nu = n0 + PI * i / 240, r = p / (1 + e * Math.cos(nu)), q = sc(P.x + r * Math.cos(wp + nu), P.y + r * Math.sin(wp + nu));
    if (q[0] >= 0 && q[0] < W && q[1] >= 0 && q[1] < H) ctx.fillRect(q[0] | 0, q[1] | 0, 1, 1);
  }
  const a = sc(P.x + w.r1 * Math.cos(th), P.y + w.r1 * Math.sin(th)), b = sc(P.x + w.r2 * Math.cos(th + PI), P.y + w.r2 * Math.sin(th + PI));
  ctx.fillRect(a[0] - 2 | 0, a[1] - 2 | 0, 4, 4); ctx.fillRect(b[0] - 2 | 0, b[1] - 2 | 0, 4, 4);
  ctx.fillText('出发', a[0] + 4 | 0, a[1] | 0); ctx.fillText('到达', b[0] + 4 | 0, b[1] | 0);
}
function fitMap() {                                           // 按聚焦对象自动取合适比例尺
  const b = mf < bodies.length ? bodies[mf] : null; let r;
  if (!b) { const rb = ref(); r = Math.max(Math.hypot(S.x - rb.x, S.y - rb.y) * 2, rb.R * 3); }
  else if (b === sun) r = 4.8e10; else { const ms = bodies.filter(x => x.orb && x.orb.p === b); r = ms.length ? Math.max(...ms.map(x => x.orb.a)) * 1.3 : b.R * 6; }
  mm = clamp(r / 120, 100, 1e9);
}
function toggleMap() { mapMode = !mapMode; if (mapMode) { fitMap(); msg('地图:Tab 切换聚焦 · 滚轮/±缩放 · M 返回', 3500); } }
function cycleMap() { if (!mapMode) return; mf = (mf + 1) % (bodies.length + 1); fitMap(); }
function ref() { let best = earth, bg = 0; for (const b of bodies) { const dx = b.x - S.x, dy = b.y - S.y, g = b.mu / (dx * dx + dy * dy); if (g > bg) { bg = g; best = b; } } return best; }
function orbit(b) { return orbitFrom(b, S.x - b.x, S.y - b.y, S.vx - b.vx, S.vy - b.vy); }
function orbitFrom(b, rx, ry, vx, vy) {
  const r = Math.hypot(rx, ry), v2 = vx * vx + vy * vy, mu = b.mu;
  const hz = rx * vy - ry * vx, rv = rx * vx + ry * vy, k = v2 - mu / r, ex = (k * rx - rv * vx) / mu, ey = (k * ry - rv * vy) / mu;
  const e = Math.hypot(ex, ey), eps = v2 / 2 - mu / r, a = -mu / (2 * eps), p = hz * hz / mu;
  return { e, p, w: Math.atan2(ey, ex), sg: hz >= 0 ? 1 : -1, ap: eps < 0 ? a * (1 + e) - b.R : Infinity, pe: (eps < 0 ? a * (1 - e) : p / (1 + e)) - b.R, r, vx, vy, rv };
}

// ---------- 渲染 ----------
function sky(b, alt, x, y) {
  const a = b.atm, q = Math.floor(Math.exp(-Math.max(alt, 0) / a.sk) * 8 * a.dim + BY[(x & 1) | ((y & 1) << 1)] * .99) / 8;
  return q > 0 ? C(a.col[0] * q | 0, a.col[1] * q | 0, a.col[2] * q | 0) : 0;
}
function glow(b, alt, x, y) { const q = Math.floor(Math.exp(-alt / (b.R * .06)) * 6 + BY[(x & 1) | ((y & 1) << 1)] * .99) / 6; return q > 0 ? C(255 * q | 0, 175 * q | 0, 40 * q | 0) : 0; }
function dirt(p, dp, x, y) { const k = (dp / 10 | 0) & 1; return (((x + y) & 1) && dp % 10 < 1.5 ? !k : k) ? p[5] : p[6]; }
function drawBody(b) {
  const s = 1 / mpp, cx = W / 2 + (b.x - camx) * s, cy = H / 2 - (b.y - camy) * s, rr = (b.R + b.H + (b.atm ? b.atm.top : 0) + (b.type === 'sun' ? b.R * .4 : 0)) * s;
  if (rr < 1.5) return;
  if (cx + rr < 0 || cx - rr > W || cy + rr < 0 || cy - rr > H) return;
  const x0 = Math.max(0, cx - rr | 0), x1 = Math.min(W - 1, Math.ceil(cx + rr)), y0 = Math.max(0, cy - rr | 0), y1 = Math.min(H - 1, Math.ceil(cy + rr)), p = b.pal;
  for (let y = y0; y <= y1; y++) {
    const dy = (H / 2 - y - .5) * mpp + camy - b.y;
    for (let x = x0; x <= x1; x++) {
      const dx = (x + .5 - W / 2) * mpp + camx - b.x, r = Math.sqrt(dx * dx + dy * dy), alt = r - b.R; let c = 0;
      if (b.type === 'sun') c = alt > 0 ? glow(b, alt, x, y) : r < b.R * .55 ? C(255, 240, 170) : r < b.R * .85 ? C(255, 200, 80) : C(245, 150, 50);
      else if (b.type === 'gas' && alt <= 0) c = (Math.floor(dy / b.R * 6 + Math.sin(dy / b.R * 17) * .8) & 1) ? p[0] : p[1];
      else if (alt > b.H) { if (b.atm && alt < b.atm.top) c = sky(b, alt, x, y); }
      else if (alt < -40 * mpp) c = dirt(p, -alt / mpp, x, y);
      else {
        const h = terr(b, Math.atan2(dy, dx)), d = h - alt;
        if (d < 0) { if (b.atm) c = sky(b, alt, x, y); }
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
function drawOrbit(b, o, col) {
  if (mpp < 6 || S.land) return;
  const s = 1 / mpp, n = 720, nm = o.e < 1 ? PI : Math.acos(-1 / o.e) * .98; ctx.fillStyle = col || '#7df';
  for (let i = 0; i <= n; i += 1) {
    if ((i >> 1) & 1) continue;
    const nu = -nm + 2 * nm * i / n, r = o.p / (1 + o.e * Math.cos(nu)), an = o.w + o.sg * nu;
    const sx = W / 2 + (b.x + r * Math.cos(an) - camx) * s, sy = H / 2 - (b.y + r * Math.sin(an) - camy) * s;
    if (sx >= 0 && sx < W && sy >= 0 && sy < H) ctx.fillRect(sx | 0, sy | 0, 1, 1);
  }
}
function markers() {
  const s = 1 / mpp; ctx.font = '8px monospace';
  ctx.fillStyle = '#2a3258';                                  // 轨道环(行星绕太阳、月球绕地球)
  for (const b of bodies) if (b.orb) {
    const q = b.orb.p, rpx = b.orb.a * s; if (rpx < 4 || rpx > 4000) continue;
    const n = clamp(rpx * 2 | 0, 90, 900);
    for (let i = 0; i < n; i++) {
      const an = i / n * 2 * PI, sx = W / 2 + (q.x + b.orb.a * Math.cos(an) - camx) * s, sy = H / 2 - (q.y + b.orb.a * Math.sin(an) - camy) * s;
      if (sx >= 0 && sx < W && sy >= 0 && sy < H) ctx.fillRect(sx | 0, sy | 0, 1, 1);
    }
  }
  for (const b of bodies) {
    const rr = b.R * s, sx = W / 2 + (b.x - camx) * s, sy = H / 2 - (b.y - camy) * s;
    if (b.orb && b.orb.p !== sun && b.orb.a * s < 14) continue;           // 卫星轨道太小时不画,避免挤在一起
    if (sx < -30 || sx > W + 30 || sy < -10 || sy > H + 10) continue;
    if (rr < 3) { ctx.fillStyle = b.col; ctx.fillRect(sx - 1 | 0, sy - 1 | 0, 3, 3); }
    if (rr < 3 || mpp > 2e3 || mapMode) { ctx.fillStyle = '#cfe8ff'; ctx.fillText(b.name, sx + 5 | 0, sy - 3 | 0); }
  }
}
function render(dt, rb, o) {
  buf.fill(0xFF000000);
  for (const s of stars) buf[s[1] * W + s[0]] = C(s[2], s[2], s[2]);
  for (const b of bodies) drawBody(b);
  ctx.putImageData(img, 0, 0); markers();
  drawOrbit(rb, o);
  if (node && NODE) drawOrbit(NODE.b, NODE.post, '#b7ff6a');
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
    } else {                                                  // 远景/地图:火箭画成闪烁十字
      const sx = W / 2 + (S.x - camx) / mpp, sy = H / 2 - (S.y - camy) / mpp, bl = (performance.now() / 350 | 0) & 1;
      ctx.fillStyle = bl ? '#fff' : '#f33'; ctx.fillRect(sx - 3 | 0, sy | 0, 7, 1); ctx.fillRect(sx | 0, sy - 3 | 0, 1, 7);
    }
  }
  for (let i = P.length - 1; i >= 0; i--) {
    const p = P[i]; p.x += p.vx * dt; p.y += p.vy * dt; p.l -= dt; if (p.l <= 0) { P.splice(i, 1); continue; }
    if (mpp < 80) px(p.x, p.y, 0, 0, 0, p.l > .6 ? '#ffe27a' : p.l > .3 ? '#ff8a2a' : '#8a3a1a');
  }
  drawTarget(); drawNode();
}

// ---------- HUD ----------
const f = m => m === Infinity ? '∞' : Math.abs(m) >= 1e8 ? (m / 1e9).toFixed(2) + ' Gm' : Math.abs(m) >= 1e7 ? (m / 1e6).toFixed(1) + ' Mm' : Math.abs(m) >= 1e4 ? (m / 1e3).toFixed(1) + ' km' : m.toFixed(0) + ' m';
function hud(rb, o, eff) {
  const st = S.stages[0], m = mass(), g = rb.mu / (o.r * o.r);
  $('rb').textContent = '参照:' + rb.name; $('alt').textContent = f(o.r - rb.R);
  $('spd').textContent = Math.hypot(o.vx, o.vy).toFixed(0) + ' m/s'; $('vs').textContent = (o.rv / o.r).toFixed(0) + ' m/s';
  $('ap').textContent = f(o.ap); $('pe').textContent = f(o.pe); $('twr').textContent = (st.F / (m * g)).toFixed(2);
  $('mass').textContent = (m / 1000).toFixed(1) + ' t'; $('warp').textContent = 'x' + eff + (eff < WARPS[wi] ? '(受限)' : '');
  $('tt').textContent = (T / 86400 | 0) + ' 天'; $('nav').textContent = navText() + nodeText(); $('node').classList.toggle('hide', !node); $('stg').textContent = S.stages.length; $('pch').textContent = chutesN() ? (S.chute ? '已展开' : '待命 x' + chutesN() + ' (P)') : '无'; $('sas').textContent = S.sas ? '开' : '关';
  $('thb').style.height = S.thr * 100 + '%'; $('fub').style.height = st.fuel / st.fuel0 * 100 + '%';
  const lim = rb.atm ? rb.atm.top : 3000;
  if (!S.land && o.e < 1 && o.pe > lim && !flags['o' + rb.name]) { flags['o' + rb.name] = 1; msg(rb === sun ? '☀ 已进入日心轨道!' : '🛰 已进入' + rb.name + '轨道!', 6000); }
}

// ---------- 输入 ----------
const K = {};
addEventListener('keydown', e => {
  if (['Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'ControlLeft', 'Tab'].includes(e.code)) e.preventDefault();
  if (e.code === 'KeyB' && !e.repeat) { openBuild(); return; }
  if (building || e.repeat) return; K[e.code] = 1;
  if (e.code === 'Space') stage();
  if (e.code === 'KeyP') chute();
  if (e.code === 'KeyM') toggleMap();
  if (e.code === 'KeyN') cycleTarget();
  if (e.code === 'KeyO') toggleNode();
  if (e.code === 'KeyV') { alignOn = !alignOn; msg(alignOn ? (node ? '自动对准节点方向' : '先按 O 创建节点') : '已取消自动对准'); }
  if (e.code === 'KeyK') { if (node && NODE) { autoW = Math.max(T + 1, node.t - (isFinite(NODE.burn) ? NODE.burn / 2 : 0) - 15); msg('⏩ 自动加速到节点…'); } else msg('先按 O 创建节点'); }
  if (e.code === 'KeyJ') { if (NAV && NAV.win && isFinite(NAV.win.tw) && !NAV.win.open) { autoW = T + NAV.win.tw; msg('⏩ 自动加速到转移窗口…'); } else msg(tgt ? '窗口已开启或不可用' : '先按 N 选择目标'); }
  if (e.code === 'Period' || e.code === 'Comma') autoW = 0;
  if (e.code === 'Tab') cycleMap();
  if (e.code === 'KeyH') document.body.classList.toggle('touch');
  if (e.code === 'KeyZ') S.thr = 1; if (e.code === 'KeyX') S.thr = 0;
  if (e.code === 'KeyT') S.sas ^= 1; if (e.code === 'KeyR') reset();
  if (e.code === 'Period') wi = Math.min(WARPS.length - 1, wi + 1); if (e.code === 'Comma') wi = Math.max(0, wi - 1);
});
addEventListener('keyup', e => K[e.code] = 0);
const zoom = k => { if (mapMode) mm = clamp(mm * k, 100, 1e9); else mpp = clamp(mpp * k, .2, 2e8); };
addEventListener('wheel', e => { zoom(e.deltaY > 0 ? 1.15 : 1 / 1.15); e.preventDefault(); }, { passive: false });
addEventListener('keydown', e => {
  if (e.code === 'Equal' || e.code === 'NumpadAdd') zoom(1 / 1.25); if (e.code === 'Minus' || e.code === 'NumpadSubtract') zoom(1.25); });

// ---------- 主循环 ----------
let last = performance.now(), hudT = 0;
reset();

// ---------- 组装界面 ----------
let building = true; document.body.classList.add('building');
// ---------- 触控:虚拟摇杆(左右=旋转,上下=推力) + 按钮(派发等价键盘事件) ----------
const JOY = { x: 0, y: 0 }, joy = $('joy'), knob = $('knob'); let jid = null;
if ('ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0) document.body.classList.add('tc', 'touch');
const jset = e => {
  const r = joy.getBoundingClientRect(), R = r.width / 2; let dx = e.clientX - (r.left + R), dy = e.clientY - (r.top + R); const d = Math.hypot(dx, dy);
  if (d > R) { dx *= R / d; dy *= R / d; } JOY.x = dx / R; JOY.y = dy / R; knob.style.transform = `translate(${dx}px,${dy}px)`;
};
const jend = e => { if (e.pointerId === jid) { jid = null; JOY.x = JOY.y = 0; knob.style.transform = ''; } };
joy.addEventListener('pointerdown', e => { jid = e.pointerId; try { joy.setPointerCapture(jid); } catch (x) {} jset(e); e.preventDefault(); });
joy.addEventListener('pointermove', e => { if (e.pointerId === jid) jset(e); });
joy.addEventListener('pointerup', jend); joy.addEventListener('pointercancel', jend);
document.querySelectorAll('[data-k]').forEach(b => {
  const k = b.dataset.k, fire = t => window.dispatchEvent(new KeyboardEvent(t, { code: k }));
  b.addEventListener('pointerdown', e => { e.preventDefault(); fire('keydown'); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(t => b.addEventListener(t, () => fire('keyup')));
});
(() => {                                                      // 机动节点面板
  const P = $('node'); P.innerHTML = '<b>✦ 机动节点</b>';
  const row = (label, items) => { const d = document.createElement('div'); d.append(label + ' '); P.appendChild(d); items.forEach(([t, fn]) => btn(d, t, fn)); };
  const tt = d => () => { if (node) node.t = Math.max(T + 3, node.t + d); };
  const an = far => () => { if (!node) return; const x = tAnom(orbit(node.b), node.b, far); if (isFinite(x)) node.t = T + Math.max(3, x); else msg(far ? '该轨道没有远点' : '已过近点'); };
  const dv = (k, d) => () => { if (node) node[k] += d; };
  row('时间', [['近点', an(0)], ['远点', an(1)], ['−1m', tt(-60)], ['−10s', tt(-10)], ['+10s', tt(10)], ['+1m', tt(60)]]);
  row('顺行', [-100, -10, -1, 1, 10, 100].map(d => [(d > 0 ? '+' : '−') + Math.abs(d), dv('p', d)]));
  row('径向', [-100, -10, -1, 1, 10, 100].map(d => [(d > 0 ? '+' : '−') + Math.abs(d), dv('r', d)]));
  row('', [['对准', () => { alignOn = !alignOn; }], ['到节点', () => dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyK' }))], ['清零', () => { if (node) { node.p = node.r = 0; } }], ['删除', toggleNode]]);
})();
$('tg').addEventListener('click', () => document.body.classList.toggle('touch'));
const pc = $('pv').getContext('2d');
function openBuild() { building = true; document.body.classList.add('building'); for (const k in K) K[k] = 0; $('build').classList.remove('hide'); bRefresh(); }
function bRefresh() {
  const stg = compile(design); let rs = CAP; for (let i = stg.length - 1; i >= 0; i--) rs = rs.concat(stg[i].rows);
  const cell = Math.max(1, Math.min(14, Math.floor(400 / rs.length))), ox = (200 - 13 * cell) / 2, ph = Math.max(420, rs.length * cell + 20);
  if ($('pv').height !== ph) $('pv').height = ph;
  pc.clearRect(0, 0, 200, ph);
  rs.forEach((r, y) => { for (let x = 0; x < 13; x++) if (r[x] !== '.') { pc.fillStyle = PC[r[x]]; pc.fillRect(ox + x * cell, 10 + y * cell, cell, cell); } });
  const tot = CAPM + stg.reduce((s, t) => s + t.dry + t.fuel, 0); let dvT = 0, html = '';
  for (let i = 0; i < stg.length; i++) {
    let m0 = CAPM; for (let j = i; j < stg.length; j++) m0 += stg[j].dry + stg[j].fuel;
    const s = stg[i], dv = s.F && s.fuel ? s.isp * G * Math.log(m0 / (m0 - s.fuel)) : 0; dvT += dv;
    html += `第${i + 1}级${i ? '' : '(底)'}:Δv <b>${dv | 0}</b> m/s · 推力 ${s.F / 1000 | 0} kN · 燃料 ${s.fuel | 0} kg<br>`;
  }
  const twr = stg[0].F / (tot * 9.8), cost = CAPCOST + stg.reduce((s, t) => s + t.cost, 0), ok = stg[0].F > 0 && twr > 1;
  html += `<hr>总 Δv <b>${dvT | 0}</b> m/s(入轨约需 3500~4000)<br>起飞质量 ${(tot / 1000).toFixed(1)} t · 高度 ${rs.length} m<br>起飞推重比 <b>${twr.toFixed(2)}</b><br>降落伞 ${stg.reduce((s, t) => s + t.chutes, 0)} 个 · 造价 <b>$${cost.toLocaleString()}</b>(不设预算上限)`;
  html += ok ? '' : '<br><em>' + (stg[0].F ? '推重比需大于 1 才能起飞' : '最底部一级需要引擎') + '</em>';
  $('stats').innerHTML = html; $('bgo').disabled = !ok;
}
function btn(parent, html, fn) { const b = document.createElement('button'); b.innerHTML = html; b.onclick = fn; parent.appendChild(b); return b; }
PARTS.forEach(p => btn($('plist'), `<b>${p.name}</b> · $${p.cost / 1000}k<small>${{ t: '燃料 ' + p.fuel + ' kg', e: '推力 ' + p.F / 1000 + ' kN · Isp ' + p.isp, b: '推力 ' + p.F / 1000 + ' kN · 燃料 ' + p.fuel + ' kg · 与本级共用燃料', p: '按 P 开伞(低于 25 km,速度别太快)', d: '到此分级' }[p.k]} · 干重 ${p.dry} kg</small>`,
  () => { if (design.length < 120) { design.push(p.id); bRefresh(); } }));
btn($('pre'), '撤销', () => { design.pop(); bRefresh(); });
btn($('pre'), '清空', () => { design = []; bRefresh(); });
PRESETS.forEach(p => btn($('pre'), p[0], () => { design = p[1].slice(); bRefresh(); }));
$('bgo').onclick = () => {
  try { localStorage.setItem('sfs_design', JSON.stringify(design)); } catch (e) {}
  building = false; document.body.classList.remove('building'); $('build').classList.add('hide'); reset(); last = performance.now();
};
bRefresh();

function frame(now) {
  if (building) { last = now; requestAnimationFrame(frame); return; }
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  S.rot = clamp((K.KeyA || K.ArrowLeft ? 1 : 0) - (K.KeyD || K.ArrowRight ? 1 : 0) - (Math.abs(JOY.x) > .15 ? JOY.x : 0), -1, 1);
  if (!S.dead) {
    if (K.ShiftLeft || K.ShiftRight || K.KeyW) S.thr = Math.min(1, S.thr + dt * .7);
    if (K.ControlLeft || K.KeyS) S.thr = Math.max(0, S.thr - dt * .7);
    if (Math.abs(JOY.y) > .2) S.thr = clamp(S.thr - JOY.y * dt * .8, 0, 1);
  }
  if (alignOn && NODE && NODE.rem > 0 && !S.land && !S.dead && S.rot === 0) {   // 自动对准:PD 控制器
    let err = Math.atan2(NODE.diry, NODE.dirx) - PI / 2 - S.a; err = ((err + PI) % (2 * PI) + 2 * PI) % (2 * PI) - PI;
    S.rot = clamp(1.5 * err - 2.5 * S.w, -1, 1);
  }
  if (node && NODE && node.burned > 0 && NODE.rem > 0 && S.stages[0].F) S.thr = Math.min(S.thr, Math.max(.05, NODE.rem / (S.stages[0].F / mass() * 1.5)));   // 接近目标 Δv 时自动收油门
  if (autoW) {                                                // 自动加速到转移窗口
    const rem = autoW - T;
    if (rem <= 1 || S.dead) { autoW = 0; wi = 0; if (rem <= 1) msg('✔ 已到转移窗口', 3000); }
    else { let k = 0; while (k + 1 < WARPS.length && WARPS[k + 1] * dt * 2 < rem) k++; wi = k; }
  }
  const thrusting = S.thr > 0 && S.stages[0].fuel > 0 && !S.dead, chuting = S.chute && chutesN() > 0;
  let lowAtm = false;
  if (!S.land && !chuting) for (const b of bodies) { if (b.type === 'sun') continue; if (Math.hypot(S.x - b.x, S.y - b.y) - b.R < (b.atm ? b.atm.top : 10000)) lowAtm = true; }
  const slow = thrusting || lowAtm, sim = dt * (slow ? 1 : Math.min(WARPS[wi], chuting ? 50 : 1e6));
  let rem = sim, cnt = 0;
  while (rem > 1e-9 && cnt++ < 400) { const h = Math.min(rem, slow ? .02 : adt()); step(h); rem -= h; }
  const eff = Math.max(1, Math.round((sim - rem) / dt));
  camx = S.x; camy = S.y;
  const rb = ref(), o = orbit(rb);
  NAV = navInfo();
  NODE = node ? nodeCalc() : null;
  if (node && NODE) {
    if (NODE.tot > 0 && node.burned >= NODE.tot - 1) { node = null; NODE = null; alignOn = false; msg('✔ 机动完成', 3000); }
    else if (NODE.dt < -120 && node.burned < 1) { node = null; NODE = null; alignOn = false; msg('节点已过期,已删除', 3000); }
  }
  if (mapMode) {                                              // 地图:临时把相机换成聚焦对象 + 地图比例尺
    const sv = [camx, camy, mpp], c = mf < bodies.length ? bodies[mf] : S;
    camx = c.x; camy = c.y; mpp = mm;
    render(dt, rb, o);
    ctx.font = '8px monospace'; ctx.fillStyle = '#ffd75e';
    ctx.fillText('地图 · 聚焦:' + (mf < bodies.length ? bodies[mf].name : '火箭') + ' · 1 像素 = ' + f(mm) + ' · Tab 换聚焦 · M 返回', 4, 10);
    drawTransfer();
    camx = sv[0]; camy = sv[1]; mpp = sv[2];
  } else render(dt, rb, o);
  if ((hudT += dt) > .1) { hudT = 0; hud(rb, o, eff); }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.SFS = { get S() { return S; }, bodies, get T() { return T; }, kep, orbitFrom, get node() { return node; }, get NODE() { return NODE; } };
})();
