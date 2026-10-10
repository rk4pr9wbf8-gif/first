// Builds the visible highway: asphalt, gravel shoulders, guard rails,
// delineator posts, bridges with piers and parapets, and tunnels with
// concrete portals and sodium lamps.
import * as THREE from 'three';
import { STEP, FLAG_ROAD, FLAG_TUNNEL, FLAG_BRIDGE, TUBE_HALF } from './road.js';
import { baseHeight, SEA_LEVEL } from './world.js';

const CH = 64;

class GB {
  constructor() { this.p = []; this.u = []; this.i = []; }
  v(x, y, z, u, v) { this.p.push(x, y, z); this.u.push(u, v); return this.p.length / 3 - 1; }
  box(cx, cy, cz, hx, hy, hz, fx, fz) {
    // oriented box: local z along (fx,fz), local x = (fz,-fx)
    const rx = fz, rz = -fx;
    const P = (sx, sy, sz) => [cx + rx * hx * sx + fx * hz * sz, cy + hy * sy, cz + rz * hx * sx + fz * hz * sz];
    const faces = [
      [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]], [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]],
      [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]], [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]],
      [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]], [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]],
    ];
    for (const f of faces) {
      const b = this.p.length / 3;
      f.forEach((c, k) => { const q = P(...c); this.v(q[0], q[1], q[2], k === 1 || k === 2 ? 1 : 0, k >= 2 ? 1 : 0); });
      this.i.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
  }
  empty() { return this.i.length === 0; }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.setIndex(this.i);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

// Sweep a 2D cross-section (lateral, height) along samples.
function sweep(gb, frames, profile, opts = {}) {
  const segs = opts.smooth ? [profile] : profile.slice(0, -1).map((p, k) => [p, profile[k + 1]]);
  for (const prof of segs) {
    let len = [0];
    for (let k = 1; k < prof.length; k++) len.push(len[k - 1] + Math.hypot(prof[k][0] - prof[k - 1][0], prof[k][1] - prof[k - 1][1]));
    const base = gb.p.length / 3, m = prof.length;
    for (const F of frames) {
      for (let k = 0; k < m; k++) {
        const [lat, hy] = prof[k];
        const u = opts.uLat ? (lat + 5.6) / 11.2 : len[k] * (opts.uScale || 0.25);
        gb.v(F.x + F.rx * lat, F.y + hy, F.z + F.rz * lat, u, F.s * (opts.vScale || 0.25));
      }
    }
    for (let a = 0; a < frames.length - 1; a++) {
      for (let k = 0; k < m - 1; k++) {
        const A = base + a * m + k, B = A + 1, C = A + m, D = C + 1;
        if (opts.flip) gb.i.push(A, C, B, B, C, D); else gb.i.push(A, B, C, B, D, C);
      }
    }
  }
}

function archProfile(half, wallTop, rise, n = 14) {
  const p = [[-half, -0.4], [-half, wallTop]];
  for (let k = 1; k < n; k++) {
    const a = Math.PI - (k / n) * Math.PI;
    p.push([Math.cos(a) * half, wallTop + Math.sin(a) * rise]);
  }
  p.push([half, wallTop], [half, -0.4]);
  return p;
}
const TUBE = archProfile(TUBE_HALF, 3.3, 4.1);

export function makeRoadMaterials(tex, uniforms) {
  const conc = tex.concrete;
  const tunnelTex = conc.clone(); tunnelTex.needsUpdate = true;
  return {
    road: new THREE.MeshStandardMaterial({ map: tex.asphalt, roughness: 0.82, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
    concrete: new THREE.MeshStandardMaterial({ map: conc, roughness: 0.9, color: 0xd8d4cc }),
    tunnel: new THREE.MeshStandardMaterial({ map: tunnelTex, roughness: 0.7, color: 0xcfc6b4, side: THREE.DoubleSide }),
    rail: new THREE.MeshStandardMaterial({ color: 0xb9bec2, metalness: 0.85, roughness: 0.38, side: THREE.DoubleSide }),
    post: new THREE.MeshStandardMaterial({ color: 0xeeeeea, roughness: 0.6 }),
    lamp: new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 1.9, 0.7) }),
    reflector: new THREE.MeshStandardMaterial({ color: 0x331a00, emissive: 0xffa040, emissiveIntensity: 0.0, roughness: 0.4 }),
    rockcap: new THREE.MeshStandardMaterial({ map: tex.rock, roughness: 0.95, color: 0x8a8578 }),
  };
}

export class RoadMesh {
  constructor(scene, road, ground, mats) {
    this.scene = scene; this.road = road; this.ground = ground; this.mats = mats;
    this.chunks = new Map();
    this.group = new THREE.Group(); scene.add(this.group);
    this.radius = 7000;
  }

  invalidate(i0, i1) {
    for (let k = Math.floor(i0 / CH) - 1; k <= Math.floor(i1 / CH) + 1; k++) {
      const c = this.chunks.get(k);
      if (c) c.stale = true;
    }
  }

  update(cx, cz, budgetMs) {
    const t0 = performance.now();
    const r = this.road;
    const maxK = Math.floor((r.nFinal - 24) / CH) - 1;
    const todo = [];
    for (let k = 0; k <= maxK; k++) {
      const i = k * CH + CH / 2;
      const d = Math.hypot(r.px[i] - cx, r.pz[i] - cz);
      let c = this.chunks.get(k);
      if (d < this.radius) {
        if (!c || c.stale) todo.push([k, d]);
      } else if (c && d > this.radius + 1500) {
        this._free(c); this.chunks.delete(k);
      }
    }
    todo.sort((a, b) => a[1] - b[1]);
    let pending = 0;
    for (const [k] of todo) {
      if (performance.now() - t0 < budgetMs) this._build(k); else pending++;
    }
    return pending;
  }

  _free(c) { for (const m of c.meshes) { this.group.remove(m); m.geometry.dispose(); } }

  _build(k) {
    const old = this.chunks.get(k);
    if (old) this._free(old);
    const r = this.road;
    const i0 = k * CH, i1 = i0 + CH;
    const ox = r.px[i0], oz = r.pz[i0];
    const frame = (i) => {
      const th = r.hd[i];
      return { x: r.px[i] - ox, z: r.pz[i] - oz, y: r.y[i], rx: -Math.sin(th), rz: Math.cos(th), fx: Math.cos(th), fz: Math.sin(th), s: i * STEP, i };
    };
    const frames = [];
    for (let i = i0; i <= i1; i++) frames.push(frame(i));
    const g = { road: new GB(), concrete: new GB(), tunnel: new GB(), rail: new GB(), post: new GB(), lamp: new GB(), reflector: new GB(), rockcap: new GB() };

    // asphalt + shoulders
    sweep(g.road, frames, [[-6.5, -0.42], [-5.6, 0.02], [5.6, 0.02], [6.5, -0.42]], { uLat: true, vScale: 1 / 22.4 });

    // runs of a flag (inclusive sample indices), optionally extended
    const runs = (flag, ext) => {
      const out = [];
      let s = -1;
      for (let i = i0; i <= i1; i++) {
        const on = r.flag[i] === flag || (ext && (r.flag[i - 1] === flag || r.flag[i + 1] === flag));
        if (on && s < 0) s = i;
        if ((!on || i === i1) && s >= 0) { out.push([s, on ? i : i - 1]); s = -1; }
      }
      return out.filter(([a, b]) => b > a);
    };
    const sub = (a, b) => frames.slice(a - i0, b - i0 + 1);

    // tunnels
    for (const [a, b] of runs(FLAG_TUNNEL, true)) {
      sweep(g.tunnel, sub(a, b), TUBE, { smooth: true, flip: true, uScale: 0.2, vScale: 0.125 });
      for (let i = a; i <= b; i++) {
        if (r.flag[i] !== FLAG_TUNNEL || i % 5) continue;
        const F = frame(i);
        for (const lat of [-3.4, 3.4]) g.lamp.box(F.x + F.rx * lat, F.y + 6.55, F.z + F.rz * lat, 0.22, 0.05, 1.1, F.fx, F.fz);
        // kerb reflectors
        for (const lat of [-6.1, 6.1]) g.reflector.box(F.x + F.rx * lat, F.y + 0.9, F.z + F.rz * lat, 0.08, 0.05, 0.12, F.fx, F.fz);
      }
    }
    // portals
    for (let i = Math.max(i0, 1); i <= i1; i++) {
      if (r.flag[i] !== FLAG_TUNNEL) continue;
      const entry = r.flag[i - 1] !== FLAG_TUNNEL, exit = r.flag[i + 1] !== FLAG_TUNNEL;
      if (entry) this._portal(g.concrete, g.rockcap, frame(i), 1, ox, oz);
      if (exit) this._portal(g.concrete, g.rockcap, frame(i), -1, ox, oz);
    }
    // bridges
    for (const [a, b] of runs(FLAG_BRIDGE, true)) {
      const fr = sub(a, b);
      sweep(g.concrete, fr, [[-6.4, -0.05], [-6.4, -0.6], [-4.6, -1.8], [4.6, -1.8], [6.4, -0.6], [6.4, -0.05]], { flip: true, uScale: 0.25 });
      sweep(g.concrete, fr, [[-5.65, 0], [-5.65, 0.95], [-6.4, 0.95], [-6.4, -0.05]], { flip: true });
      sweep(g.concrete, fr, [[6.4, -0.05], [6.4, 0.95], [5.65, 0.95], [5.65, 0]], { flip: true });
      for (let i = a + 4; i <= b - 4; i++) {
        if (r.flag[i] !== FLAG_BRIDGE || i % 10) continue;
        const F = frame(i);
        const gx = r.px[i], gz = r.pz[i];
        const floor = Math.min(baseHeight(gx, gz), F.y - 4) - (baseHeight(gx, gz) < SEA_LEVEL ? 2 : 1.5);
        const top = F.y - 1.8;
        const h = Math.max(1, top - floor);
        g.concrete.box(F.x, top - 0.6, F.z, 6.2, 0.6, 1.3, F.fx, F.fz);
        for (const lat of [-3.0, 3.0]) g.concrete.box(F.x + F.rx * lat, floor + h / 2 - 0.6, F.z + F.rz * lat, 0.85, h / 2, 1.1, F.fx, F.fz);
      }
    }
    // guard rails
    for (const side of [-1, 1]) {
      const arr = side < 0 ? r.railL : r.railR;
      let s = -1;
      for (let i = i0; i <= i1 + 1; i++) {
        const on = i <= i1 && arr[i] && r.flag[i] === FLAG_ROAD;
        if (on && s < 0) s = i;
        if (!on && s >= 0) {
          const e = Math.min(i, i1);
          if (e > s) {
            const L = 6.05 * side;
            sweep(g.rail, sub(s, e), [[L, 0.48], [L, 0.62], [L - 0.06 * side, 0.68], [L, 0.74], [L, 0.86]], { smooth: true });
            for (let j = s; j <= e; j += 2) {
              const F = frame(j);
              g.post.box(F.x + F.rx * (L + 0.12 * side), F.y + 0.25, F.z + F.rz * (L + 0.12 * side), 0.07, 0.55, 0.09, F.fx, F.fz);
            }
          }
          s = -1;
        }
      }
    }
    // delineator posts with amber reflectors
    for (let i = i0; i < i1; i += 1) {
      if (i % 12 || r.flag[i] !== FLAG_ROAD) continue;
      const F = frame(i);
      for (const side of [-1, 1]) {
        if ((side < 0 ? r.railL[i] : r.railR[i])) continue;
        const L = 6.7 * side;
        g.post.box(F.x + F.rx * L, F.y + 0.25, F.z + F.rz * L, 0.06, 0.65, 0.06, F.fx, F.fz);
        g.reflector.box(F.x + F.rx * L, F.y + 0.72, F.z + F.rz * L, 0.065, 0.09, 0.065, F.fx, F.fz);
      }
    }

    const meshes = [];
    for (const key in g) {
      if (g[key].empty()) continue;
      const m = new THREE.Mesh(g[key].build(), this.mats[key]);
      m.position.set(ox, 0, oz);
      m.receiveShadow = key !== 'lamp';
      m.castShadow = key === 'concrete' || key === 'rail' || key === 'post';
      m.matrixAutoUpdate = false; m.updateMatrix();
      this.group.add(m); meshes.push(m);
    }
    this.chunks.set(k, { meshes, stale: false });
  }

  // Concrete collar around a tunnel mouth. Its roof follows the hillside
  // so it hugs the terrain, and it hides the hole cut into the terrain mesh
  // above the tube.
  _portal(gb, rock, F, dir, ox, oz) {
    const fx = F.fx * dir, fz = F.fz * dir;
    const rx = fz, rz = -fx; // local +x
    const th = this.ground.terrainHeight;
    const A0 = -6.5, A1 = 20, W = 13.5, BOT = -3;
    const NA = 9, NL = 9;
    const top = [];
    for (let ia = 0; ia < NA; ia++) {
      const a = A0 + (A1 - A0) * ia / (NA - 1);
      const row = [];
      for (let il = 0; il < NL; il++) {
        const l = -W + 2 * W * il / (NL - 1);
        const wx = F.x + ox + fx * a + rx * l, wz = F.z + oz + fz * a + rz * l;
        row.push(Math.min(60, Math.max(th(wx, wz) - F.y + 0.9, 9.6)));
      }
      top.push(row);
    }
    // front facade height: flat parapet a little above the arch
    const frontTop = Math.max(9.6, Math.min(...top[0]));
    for (let il = 0; il < NL; il++) top[0][il] = Math.max(frontTop, Math.min(top[0][il], top[1][il]));
    const P = (a, l, y) => [F.x + fx * a + rx * l, F.y + y, F.z + fz * a + rz * l];
    const quad = (p0, p1, p2, p3, target = gb) => {
      // p0..p3 counter-clockwise when seen from the outside; world-scaled UVs
      const b = target.p.length / 3;
      const pts = [p0, p1, p2, p3];
      const ax = Math.abs(p1[1] - p0[1]) + Math.abs(p2[1] - p1[1]) > 0.5 * (Math.hypot(p1[0] - p0[0], p1[2] - p0[2]) + 0.01);
      pts.forEach((p) => target.v(p[0], p[1], p[2], (p[0] + p[2]) * 0.11, (ax ? p[1] : p[2] - p[0]) * 0.11));
      target.i.push(b, b + 1, b + 2, b, b + 2, b + 3);
    };
    const la = (ia) => A0 + (A1 - A0) * ia / (NA - 1);
    const ll = (il) => -W + 2 * W * il / (NL - 1);
    // roof
    for (let ia = 0; ia < NA - 1; ia++) for (let il = 0; il < NL - 1; il++) {
      quad(P(la(ia), ll(il + 1), top[ia][il + 1]), P(la(ia), ll(il), top[ia][il]), P(la(ia + 1), ll(il), top[ia + 1][il]), P(la(ia + 1), ll(il + 1), top[ia + 1][il + 1]), ia === 0 ? gb : rock);
    }
    // sides
    for (let ia = 0; ia < NA - 1; ia++) {
      quad(P(la(ia + 1), -W, BOT), P(la(ia + 1), -W, top[ia + 1][0]), P(la(ia), -W, top[ia][0]), P(la(ia), -W, BOT));
      quad(P(la(ia), W, BOT), P(la(ia), W, top[ia][NL - 1]), P(la(ia + 1), W, top[ia + 1][NL - 1]), P(la(ia + 1), W, BOT));
    }
    // back
    for (let il = 0; il < NL - 1; il++) quad(P(A1, ll(il + 1), BOT), P(A1, ll(il + 1), top[NA - 1][il + 1]), P(A1, ll(il), top[NA - 1][il]), P(A1, ll(il), BOT));
    // front face with the arch cut out
    const shape = new THREE.Shape();
    shape.moveTo(-W, BOT); shape.lineTo(W, BOT);
    for (let il = NL - 1; il >= 0; il--) shape.lineTo(ll(il), top[0][il]);
    shape.closePath();
    const hw = TUBE_HALF + 0.35;
    const hole = new THREE.Path();
    hole.moveTo(-hw, -0.6); hole.lineTo(hw, -0.6); hole.lineTo(hw, 3.3);
    hole.absellipse(0, 3.3, hw, 4.45, 0, Math.PI, false);
    hole.lineTo(-hw, -0.6);
    shape.holes.push(hole);
    const sg = new THREE.ShapeGeometry(shape, 16);
    const sp = sg.attributes.position, b = gb.p.length / 3;
    for (let k = 0; k < sp.count; k++) {
      // shape x = local lateral (mirrored so the face points outward), y = height
      const q = P(A0, -sp.getX(k), sp.getY(k));
      gb.v(q[0], q[1], q[2], sp.getX(k) * 0.12, sp.getY(k) * 0.12);
    }
    for (let k = 0; k < sg.index.count; k++) gb.i.push(b + sg.index.getX(k));
    // inner reveal of the arch (short tunnel lining inside the collar)
    const arch = [];
    arch.push([-hw, -0.6], [-hw, 3.3]);
    for (let k = 1; k < 16; k++) { const ang = Math.PI - (k / 16) * Math.PI; arch.push([Math.cos(ang) * hw, 3.3 + Math.sin(ang) * 4.45]); }
    arch.push([hw, 3.3], [hw, -0.6]);
    for (let k = 0; k < arch.length - 1; k++) {
      const [l0, y0] = arch[k], [l1, y1] = arch[k + 1];
      quad(P(A0, l0, y0), P(A0, l1, y1), P(A0 + 6, l1, y1), P(A0 + 6, l0, y0));
    }
    // cornice band
    gb.box(F.x - fx * (-A0 + 0.25), F.y + frontTop - 0.3, F.z - fz * (-A0 + 0.25), W + 0.4, 0.4, 0.45, fx, fz);
  }
}
