// Infinite procedural highway. The centreline is grown one 4 m step at a
// time, steering toward low ground (so it threads valleys and hugs
// contours) while drifting along a slowly-wandering heading. A smoothed,
// grade-limited profile is then fitted to the terrain; where the hill is
// far above the road we bore a tunnel, where the ground falls away we
// build a bridge.
import { baseHeight, SEA_LEVEL } from './world.js';
import { noise2, clamp, smoothstep } from './noise.js';

export const STEP = 4;
export const HALF_W = 4.8;      // edge-line half width
export const ROAD_EDGE = 5.6;   // paved half width incl. shoulder
export const INFL = 52;         // terrain influence radius
export const TUBE_HALF = 6.6;   // tunnel inner half width
export const FLAG_ROAD = 0, FLAG_TUNNEL = 1, FLAG_BRIDGE = 2;

const CELL = 64;
const W_AVG = 15;      // profile smoothing radius (samples)
const W_FINE = 8;      // second smoothing radius
const MAX_GRADE = 0.12;
const TR1 = 5, TR2 = 6;  // tunnel closing / opening radii
const BR1 = 4, BR2 = 2;  // bridge closing / opening radii
const MORPH = 2 * Math.max(TR1 + TR2, BR1 + BR2);

const ckey = (cx, cz) => cx * 1048576 + cz;

export class Road {
  constructor(sx, sz, heading) {
    this.px = []; this.pz = []; this.hd = []; this.h0 = [];
    this.cum = [0];            // prefix sums of clamped h0
    this.yG = [];              // grade-limited profile
    this.y = [];               // final road height
    this.rawT = []; this.rawB = [];
    this.dT = []; this.cT = []; this.eT = []; this.oT = [];
    this.dB = []; this.cB = []; this.eB = []; this.oB = [];
    this.flag = []; this.portal = []; this.railL = []; this.railR = [];
    this.nFinal = 0;
    this.grid = new Map();
    this.listeners = [];
    this.st = { x: sx, z: sz, th: heading, k: 0, href: Math.max(baseHeight(sx, sz), SEA_LEVEL + 4), phi0: heading };
    this.q = { d: 0, side: 0, i: 0, t: 0, y: 0, flag: 0, portal: 0, s: 0, hx: 0, hz: 0, railL: 0, railR: 0 };
  }

  onFinalize(fn) { this.listeners.push(fn); }

  // ---- centreline -------------------------------------------------------
  _growRaw() {
    const st = this.st;
    const i = this.px.length;
    if (i > 0) {
      const s = i * STEP;
      const phi = st.phi0 + 0.55 * noise2(s * 0.00008, 3.7) + 0.25 * noise2(s * 0.0003, 9.1);
      // how much the "surveyor" cares about grades; low values punch tunnels
      const wE = 0.7 + 3.2 * smoothstep(-0.6, 0.6, noise2(s * 0.00028, 1.3));
      let best = 0, bestC = Infinity;
      for (let c = -4; c <= 4; c++) {
        const d = c * 0.11;
        const th = st.th + d;
        const cs = Math.cos(th), sn = Math.sin(th);
        let ce = 0;
        for (let L = 30; L <= 390; L += 90) {
          const hb = baseHeight(st.x + cs * L, st.z + sn * L);
          const h = Math.max(hb, SEA_LEVEL + 2);
          const g = Math.abs(h - st.href) / L;
          ce += g + 3 * g * g + (hb < SEA_LEVEL + 1 ? 0.25 : 0);
          if (this._nearOld(st.x + cs * L, st.z + sn * L, i)) ce += 3;
        }
        let da = th - phi;
        da = Math.atan2(Math.sin(da), Math.cos(da));
        const cost = ce * wE + da * da * 1.3 + Math.max(0, Math.abs(da) - 0.55) * 5 + d * d * 1.5;
        if (cost < bestC) { bestC = cost; best = d; }
      }
      const tk = clamp(best * 0.2, -0.042, 0.042);
      st.k += (tk - st.k) * 0.14;
      st.th += st.k;
      st.x += Math.cos(st.th) * STEP;
      st.z += Math.sin(st.th) * STEP;
    }
    const h = baseHeight(st.x, st.z);
    st.href += (Math.max(h, SEA_LEVEL + 4) - st.href) * 0.06;
    this.px.push(st.x); this.pz.push(st.z); this.hd.push(st.th); this.h0.push(h);
    this.cum.push(this.cum[this.cum.length - 1] + Math.max(h, SEA_LEVEL + 4.5));
  }

  _nearOld(x, z, i) {
    const l = this.grid.get(ckey(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!l) return false;
    for (let k = 0; k < l.length; k++) {
      const j = l[k];
      if (i - j > 150 && Math.abs(this.px[j] - x) < 90 && Math.abs(this.pz[j] - z) < 90) return true;
    }
    return false;
  }

  // ---- vertical profile + structure flags ------------------------------
  _advance() {
    const n = this.px.length;
    // grade-limited coarse profile
    while (this.yG.length < n - W_AVG) {
      const i = this.yG.length;
      const a = Math.max(0, i - W_AVG), b = i + W_AVG;
      const avg = (this.cum[b + 1] - this.cum[a]) / (b + 1 - a);
      if (i === 0) this.yG.push(avg);
      else {
        const p = this.yG[i - 1];
        this.yG.push(clamp(avg, p - MAX_GRADE * STEP, p + MAX_GRADE * STEP));
      }
    }
    // fine smoothing
    const nG = this.yG.length;
    while (this.y.length < nG - W_FINE) {
      const i = this.y.length;
      let s = 0, c = 0;
      for (let j = Math.max(0, i - W_FINE); j <= i + W_FINE; j++) { s += this.yG[j]; c++; }
      const y = s / c;
      this.y.push(y);
      const h = this.h0[i];
      this.rawT.push(h - y > 24 ? 1 : 0);
      this.rawB.push(y - h > 15 || h < SEA_LEVEL + 0.5 ? 1 : 0);
    }
    const nY = this.y.length;
    const at = (arr, j) => (j < 0 ? 0 : arr[j]);
    const orR = (arr, i, r) => { for (let j = i - r; j <= i + r; j++) if (at(arr, j)) return 1; return 0; };
    const andR = (arr, i, r) => { for (let j = i - r; j <= i + r; j++) if (j >= 0 && !arr[j]) return 0; return 1; };
    // morphological close (fill gaps) then open (drop short runs)
    while (this.dT.length < nY - TR1) { const i = this.dT.length; this.dT.push(orR(this.rawT, i, TR1)); }
    while (this.cT.length < this.dT.length - TR1) { const i = this.cT.length; this.cT.push(andR(this.dT, i, TR1)); }
    while (this.eT.length < this.cT.length - TR2) { const i = this.eT.length; this.eT.push(andR(this.cT, i, TR2)); }
    while (this.oT.length < this.eT.length - TR2) { const i = this.oT.length; this.oT.push(orR(this.eT, i, TR2)); }
    while (this.dB.length < nY - BR1) { const i = this.dB.length; this.dB.push(orR(this.rawB, i, BR1)); }
    while (this.cB.length < this.dB.length - BR1) { const i = this.cB.length; this.cB.push(andR(this.dB, i, BR1)); }
    while (this.eB.length < this.cB.length - BR2) { const i = this.eB.length; this.eB.push(andR(this.cB, i, BR2)); }
    while (this.oB.length < this.eB.length - BR2) { const i = this.oB.length; this.oB.push(orR(this.eB, i, BR2)); }
    const nF = Math.min(this.oT.length, this.oB.length);
    while (this.flag.length < nF) {
      const i = this.flag.length;
      this.flag.push(this.oT[i] ? FLAG_TUNNEL : this.oB[i] ? FLAG_BRIDGE : FLAG_ROAD);
    }
    // portal proximity + guard rails need a few samples of look-ahead
    const start = this.nFinal;
    const end = this.flag.length - 4;
    for (let i = start; i < end; i++) {
      const f = this.flag[i];
      let p = 0;
      if (f === FLAG_TUNNEL) {
        for (let j = Math.max(0, i - 3); j <= i + 3; j++) if (this.flag[j] !== FLAG_TUNNEL) { p = 1; break; }
      }
      this.portal.push(p);
      let rl = 0, rr = 0;
      if (f === FLAG_BRIDGE) { rl = rr = 1; }
      else if (f === FLAG_ROAD) {
        const th = this.hd[i], rx = -Math.sin(th), rz = Math.cos(th);
        const y = this.y[i];
        const hl = baseHeight(this.px[i] - rx * 13, this.pz[i] - rz * 13);
        const hr = baseHeight(this.px[i] + rx * 13, this.pz[i] + rz * 13);
        rl = hl < y - 3.5 || hl < SEA_LEVEL + 0.5 ? 1 : 0;
        rr = hr < y - 3.5 || hr < SEA_LEVEL + 0.5 ? 1 : 0;
      }
      this.railL.push(rl); this.railR.push(rr);
      this.nFinal = i + 1;
      if (i > 0) this._insertSeg(i - 1);
    }
    if (end > start) {
      const i0 = Math.max(0, start - 1), i1 = this.nFinal - 1;
      for (const fn of this.listeners) fn(i0, i1);
    }
  }

  _insertSeg(i) {
    const ax = this.px[i], az = this.pz[i], bx = this.px[i + 1], bz = this.pz[i + 1];
    const x0 = Math.floor((Math.min(ax, bx) - INFL) / CELL), x1 = Math.floor((Math.max(ax, bx) + INFL) / CELL);
    const z0 = Math.floor((Math.min(az, bz) - INFL) / CELL), z1 = Math.floor((Math.max(az, bz) + INFL) / CELL);
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
      const k = ckey(cx, cz);
      let l = this.grid.get(k);
      if (!l) { l = []; this.grid.set(k, l); }
      l.push(i);
    }
  }

  // Ensure the finalized road reaches at least sample `idx`.
  ensure(idx, maxSteps = Infinity) {
    let steps = 0;
    while (this.nFinal <= idx && steps < maxSteps) {
      for (let k = 0; k < 64; k++) this._growRaw();
      this._advance();
      steps += 64;
    }
    return this.nFinal > idx;
  }

  // Nearest finalized road segment within INFL. Returns a shared object or null.
  // With yRef, segments far above/below (a road crossing over itself) lose.
  query(x, z, yRef) {
    const l = this.grid.get(ckey(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!l) return null;
    const useY = yRef !== undefined;
    let bestD2 = INFL * INFL, bestC = Infinity, bi = -1, bt = 0, bcx = 0, bcz = 0;
    const px = this.px, pz = this.pz;
    for (let k = 0; k < l.length; k++) {
      const i = l[k];
      const ax = px[i], az = pz[i];
      const abx = px[i + 1] - ax, abz = pz[i + 1] - az;
      let t = ((x - ax) * abx + (z - az) * abz) / (abx * abx + abz * abz);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const cx = ax + abx * t, cz = az + abz * t;
      const dx = x - cx, dz = z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= INFL * INFL) continue;
      let c = d2;
      if (useY) { const dy = (this.y[i] + (this.y[i + 1] - this.y[i]) * t - yRef) * 3; c += dy * dy; }
      if (c < bestC) { bestC = c; bestD2 = d2; bi = i; bt = t; bcx = cx; bcz = cz; }
    }
    if (bi < 0) return null;
    const q = this.q;
    const j = bt < 0.5 ? bi : bi + 1;
    const hx = px[bi + 1] - px[bi], hz = pz[bi + 1] - pz[bi];
    const hl = Math.hypot(hx, hz);
    q.hx = hx / hl; q.hz = hz / hl;
    q.d = Math.sqrt(bestD2);
    q.side = (x - bcx) * -q.hz + (z - bcz) * q.hx; // + = right of travel
    q.i = bi; q.t = bt;
    q.y = this.y[bi] + (this.y[bi + 1] - this.y[bi]) * bt;
    q.flag = this.flag[j]; q.portal = this.portal[j];
    q.railL = this.railL[j]; q.railR = this.railR[j];
    q.s = (bi + bt) * STEP;
    return q;
  }

  nearestIndex(x, z) {
    const q = this.query(x, z);
    return q ? q.i : -1;
  }
}

// Final ground surface = natural terrain with the road carved in.
// Writes extra info into `info` when supplied (used for terrain holes).
export function makeGround(road) {
  const info = { hole: false, roadD: 1e9, flag: -1, roadY: 0 };
  function terrainHeight(x, z, wantHole = false) {
    let h = baseHeight(x, z);
    info.hole = false; info.roadD = 1e9; info.flag = -1;
    const q = road.query(x, z);
    if (!q) return h;
    const d = q.d, ry = q.y;
    info.roadD = d; info.flag = q.flag; info.roadY = ry;
    if (q.flag === FLAG_TUNNEL) {
      const roof = ry + 11;
      if (h < roof) h += (roof - h) * (1 - smoothstep(10.5, 17, d));
      if (wantHole && q.portal && d < TUBE_HALF + 2.2) info.hole = true;
      return h;
    }
    if (q.flag === FLAG_BRIDGE) {
      const cl = ry - 3.5;
      if (h > cl) h += (cl - h) * (1 - smoothstep(7, 22, d));
      return h;
    }
    const target = ry - 0.28;
    const blend = Math.min(INFL - ROAD_EDGE - 3.5, 7 + Math.abs(h - target) * 1.25);
    const w = 1 - smoothstep(ROAD_EDGE + 2.2, ROAD_EDGE + 2.2 + blend, d);
    // rough up the cut / fill slopes so they read as blasted rock and rubble
    const diff = Math.abs(h - target);
    const rough = w * (1 - w) * 4 * Math.min(1, diff / 8);
    const det = rough > 0.01 ? (noise2(x * 0.09, z * 0.09) * 2.2 + noise2(x * 0.31, z * 0.31) * 0.7) * rough * Math.min(3, 1 + diff / 25) : 0;
    return h + (target - h) * w + det;
  }
  return { terrainHeight, info };
}
