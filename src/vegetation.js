// Dense instanced forests: Douglas fir / Sitka spruce, bigleaf & vine
// maple, paper birch & aspen, shrubs, boulders and roadside grass.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, hash2, smoothstep, noise2 } from './noise.js';
import { ATLAS } from './textures.js';
import { baseHeight, biomeAt, forestDensity, deciduousFraction, foliageHue, treeline, SEA_LEVEL } from './world.js';
import { FLAG_TUNNEL } from './road.js';

const CELL = 256;
const T_CONIFER = 0, T_MAPLE = 1, T_BIRCH = 2, T_SHRUB = 3, T_ROCK = 4, T_TUFT = 5;

// ---------------------------------------------------------------- geometry
function hashv(x, y, z) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

function prep(geo, colorFn, tint, keepUv = false) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  if (!keepUv) g.deleteAttribute('uv');
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3), t = new Float32Array(p.count);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    colorFn(c, p.getX(i), p.getY(i), p.getZ(i));
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    t[i] = tint;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aTint', new THREE.BufferAttribute(t, 1));
  return g;
}

function blob(cx, cy, cz, r, detail, sx = 1, sy = 1, sz = 1, amp = 0.16) {
  const g0 = new THREE.IcosahedronGeometry(r, detail);
  g0.deleteAttribute('uv'); g0.deleteAttribute('normal');
  const g = mergeVertices(g0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + (hashv(x * 9.1 + cx, y * 9.1 + cy, z * 9.1 + cz) - 0.5) * 2 * amp;
    p.setXYZ(i, cx + x * k * sx, cy + y * k * sy, cz + z * k * sz);
  }
  g.computeVertexNormals();
  return g;
}

const shadeY = (y0, y1, lo = 0.5, hi = 1.0) => (c, x, y, z) => {
  const t = Math.min(1, Math.max(0, (y - y0) / (y1 - y0)));
  const v = lo + (hi - lo) * t;
  c.setRGB(v, v, v);
};

function bark(r, g, b) { return (c) => c.setRGB(r, g, b); }

// ---- leaf-card geometry -------------------------------------------------
// atlas cell k -> uv rect (canvas row 0 is the top, textures are flipY)
function cellUV(k, u, v) {
  const c = k % ATLAS.cols, r = Math.floor(k / ATLAS.cols);
  return [(c + 0.04 + u * 0.92) / ATLAS.cols, 1 - (r + 1) / ATLAS.rows + (0.04 + v * 0.92) / ATLAS.rows];
}

class CardBuilder {
  constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; this.t = []; this.idx = []; }
  // centre, half-extent vectors R (u) and U (v), normal override per corner
  card(cx, cy, cz, R, U, k, nrmFn, shadeFn, tint = 2) {
    const base = this.p.length / 3;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (const [su, sv] of corners) {
      const x = cx + R[0] * su + U[0] * sv, y = cy + R[1] * su + U[1] * sv, z = cz + R[2] * su + U[2] * sv;
      this.p.push(x, y, z);
      const n = nrmFn(x, y, z);
      this.n.push(n[0], n[1], n[2]);
      const uv = cellUV(k, (su + 1) / 2, (sv + 1) / 2);
      this.uv.push(uv[0], uv[1]);
      const g = shadeFn(x, y, z);
      this.c.push(g, g, g); this.t.push(tint);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('aTint', new THREE.Float32BufferAttribute(this.t, 1));
    g.setIndex(this.idx);
    return g.toNonIndexed();
  }
}

function barkPart(geo, colorFn) {
  const g = prep(geo, colorFn, 0, true);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    const [u, v] = cellUV(ATLAS.BARK, uv.getX(i) % 1, (uv.getY(i) * 3) % 1);
    uv.setXY(i, u, v);
  }
  return g;
}

const norm3 = (x, y, z) => { const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; };
const rndv = mulberry32(4242);

function randUnit() {
  const u = rndv() * 2 - 1, a = rndv() * Math.PI * 2, r = Math.sqrt(1 - u * u);
  return [Math.cos(a) * r, u, Math.sin(a) * r];
}

// cards scattered through an ellipsoid crown with soft spherical normals
function crownCards(cb, k, n, c, rad, size) {
  for (let i = 0; i < n; i++) {
    const d = randUnit();
    const rr = 0.35 + 0.65 * Math.pow(rndv(), 0.5);
    const x = c[0] + d[0] * rad[0] * rr, y = c[1] + d[1] * rad[1] * rr, z = c[2] + d[2] * rad[2] * rr;
    // card faces roughly outward, with random roll
    const nn = norm3(d[0] + (rndv() - 0.5), d[1] + (rndv() - 0.5), d[2] + (rndv() - 0.5));
    let t = Math.abs(nn[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let Rv = norm3(t[1] * nn[2] - t[2] * nn[1], t[2] * nn[0] - t[0] * nn[2], t[0] * nn[1] - t[1] * nn[0]);
    let Uv = [nn[1] * Rv[2] - nn[2] * Rv[1], nn[2] * Rv[0] - nn[0] * Rv[2], nn[0] * Rv[1] - nn[1] * Rv[0]];
    const roll = rndv() * Math.PI * 2, cs = Math.cos(roll), sn = Math.sin(roll);
    const R2 = Rv.map((v, j) => v * cs + Uv[j] * sn), U2 = Uv.map((v, j) => -Rv[j] * sn + v * cs);
    const s = size * (0.75 + rndv() * 0.5) / 2;
    cb.card(x, y, z, R2.map(v => v * s), U2.map(v => v * s), k,
      (px, py, pz) => norm3((px - c[0]) / rad[0] + nn[0] * 0.3, (py - c[1]) / rad[1] + 0.25 + nn[1] * 0.3, (pz - c[2]) / rad[2] + nn[2] * 0.3),
      (px, py, pz) => {
        const o = Math.hypot((px - c[0]) / rad[0], (py - c[1]) / rad[1], (pz - c[2]) / rad[2]);
        return 0.42 + 0.5 * Math.min(1, o) + 0.18 * ((py - c[1]) / rad[1]);
      });
  }
}

function crossCards(cb, k, w, h, y0, n = 2) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI;
    const R = [Math.cos(a) * w / 2, 0, Math.sin(a) * w / 2];
    cb.card(0, y0 + h / 2, 0, R, [0, h / 2, 0], k,
      (x, y, z) => norm3(x * 2, 0.6, z * 2), (x, y) => 0.55 + 0.5 * Math.min(1, (y - y0) / h));
  }
}

function coniferHi() {
  const parts = [];
  const tr = new THREE.CylinderGeometry(0.008, 0.02, 0.5, 7, 1, true); tr.translate(0, 0.25, 0);
  parts.push(barkPart(tr, (c) => c.setRGB(0.42, 0.3, 0.24)));
  const cb = new CardBuilder();
  const T = 12;
  for (let k = 0; k < T; k++) {
    const t = k / (T - 1);
    const y = 0.14 + t * 0.8;
    const len = 0.16 * Math.pow(1 - t, 0.9) + 0.025;
    const nb = 7 - Math.floor(t * 3);
    for (let b = 0; b < nb; b++) {
      const a = (b / nb) * Math.PI * 2 + k * 0.9 + rndv() * 0.4;
      const dx = Math.cos(a), dz = Math.sin(a);
      const droop = 0.25 + rndv() * 0.15;
      const R = [dx * len / 2, -droop * len / 2, dz * len / 2];
      const w = len * 0.55;
      const U = [-dz * w / 2, 0.15 * w / 2, dx * w / 2];
      cb.card(dx * len / 2, y - droop * len / 2, dz * len / 2, R, U, ATLAS.NEEDLE,
        (x, yy, z) => norm3(x * 3, 1.0, z * 3),
        (x, yy, z) => 0.35 + 0.65 * Math.min(1, Math.hypot(x, z) / (len + 0.01)) * (0.75 + 0.35 * t));
    }
  }
  crossCards(cb, ATLAS.FIR, 0.22, 0.9, 0.1, 3); // dense core so you can't see through
  parts.push(cb.geometry());
  return mergeGeometries(parts);
}

function coniferLo() {
  const cb = new CardBuilder();
  crossCards(cb, ATLAS.FIR, 0.34, 0.98, 0.04, 3);
  return cb.geometry();
}

function trunkWithBranches(h, r0, r1, col) {
  const parts = [];
  const tr = new THREE.CylinderGeometry(r1, r0, h, 7, 1, true); tr.translate(0, h / 2, 0);
  parts.push(barkPart(tr, (c) => c.setRGB(...col)));
  for (let i = 0; i < 4; i++) {
    const b = new THREE.CylinderGeometry(0.006, 0.014, 0.28, 5, 1, true);
    b.translate(0, 0.14, 0); b.rotateZ(0.7 + rndv() * 0.4); b.rotateY(i * 1.6 + rndv());
    b.translate(0, h * (0.75 + rndv() * 0.2), 0);
    parts.push(barkPart(b, (c) => c.setRGB(...col)));
  }
  return parts;
}

function mapleHi() {
  const parts = trunkWithBranches(0.55, 0.04, 0.022, [0.32, 0.25, 0.2]);
  const cb = new CardBuilder();
  crownCards(cb, ATLAS.MAPLE, 46, [0, 0.66, 0], [0.32, 0.27, 0.32], 0.26);
  parts.push(cb.geometry());
  return mergeGeometries(parts);
}

function mapleLo() {
  const cb = new CardBuilder();
  crossCards(cb, ATLAS.CROWN, 0.78, 0.98, 0.02, 3);
  return cb.geometry();
}

function birchHi() {
  const parts = [];
  const tr = new THREE.CylinderGeometry(0.013, 0.022, 0.85, 7, 12, true); tr.translate(0, 0.425, 0);
  parts.push(barkPart(tr, (c, x, y) => {
    const band = hashv(Math.floor(y * 30), 1.3, 2.7);
    const v = band < 0.25 ? 0.12 : 0.95;
    c.setRGB(v, v, v * 0.97);
  }));
  const cb = new CardBuilder();
  crownCards(cb, ATLAS.BIRCH, 34, [0, 0.72, 0], [0.19, 0.27, 0.19], 0.2);
  parts.push(cb.geometry());
  return mergeGeometries(parts);
}

function birchLo() {
  const cb = new CardBuilder();
  crossCards(cb, ATLAS.CROWN, 0.5, 1.0, 0.02, 3);
  return cb.geometry();
}

function shrubGeo() {
  const cb = new CardBuilder();
  crownCards(cb, ATLAS.SHRUB, 16, [0, 0.3, 0], [0.55, 0.35, 0.55], 0.5);
  return cb.geometry();
}

function rockGeo() {
  const g = blob(0, 0.12, 0, 0.5, 2, 1, 0.62, 0.85, 0.3);
  const p = g.attributes.position, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) { uv[i * 2] = (p.getX(i) + p.getZ(i)) * 1.5; uv[i * 2 + 1] = p.getY(i) * 1.5 + p.getX(i) * 0.5; }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return prep(g, (c, x, y, z) => { const v = 0.8 + hashv(x * 3, y * 3, z * 3) * 0.25; c.setRGB(v, v, v); }, 1, true);
}

function tuftGeo() {
  const a = new THREE.PlaneGeometry(1, 1); a.translate(0, 0.5, 0);
  const b = a.clone(); b.rotateY(Math.PI / 2);
  const c = a.clone(); c.rotateY(Math.PI / 4);
  const g = mergeGeometries([a, b, c].map(x => prep(x, shadeY(0, 1, 0.55, 1.05), 1, true)));
  // grass normals point up for soft, even lighting
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return g;
}

// ---------------------------------------------------------------- materials
const NOISE_GLSL = `
  float vhash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float vnoise(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(vhash(i), vhash(i + vec3(1,0,0)), f.x), mix(vhash(i + vec3(0,1,0)), vhash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(vhash(i + vec3(0,0,1)), vhash(i + vec3(1,0,1)), f.x), mix(vhash(i + vec3(0,1,1)), vhash(i + vec3(1,1,1)), f.x), f.y), f.z); }`;

export function makeFoliageMaterial(uniforms, opts = {}) {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: opts.roughness ?? 0.82, metalness: 0,
    map: opts.map || null, alphaTest: opts.alphaTest || 0, side: opts.side || THREE.FrontSide,
  });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uniforms.uTime;
    sh.uniforms.uSunView = uniforms.uSunView;
    sh.uniforms.uSunColor = uniforms.uSunColor;
    sh.uniforms.uWind = uniforms.uWind;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aTint; attribute vec3 iTint;
        uniform float uTime; uniform float uWind;
        varying float vTintAmt; varying float vLeaf; varying vec3 vLocal;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        float ph = ip.x * 0.071 + ip.z * 0.053;
        float sway = uWind * max(position.y, 0.0) * max(position.y, 0.0);
        transformed.x += sin(uTime * 1.3 + ph) * sway * ${opts.swayAmp ?? '0.035'};
        transformed.z += cos(uTime * 1.07 + ph * 1.3) * sway * ${opts.swayAmp ?? '0.035'} * 0.7;
        vLocal = position * 26.0 + ip * 0.37;
        transformed += normal * sin(uTime * 4.0 + dot(position, vec3(37.0, 23.0, 51.0)) + ph) * 0.006 * max(aTint - 1.0, 0.0);
        vTintAmt = min(aTint, 1.0); vLeaf = max(aTint - 1.0, 0.0);`)
      .replace('#include <color_vertex>', `#include <color_vertex>
        vColor.rgb *= mix(vec3(1.0), iTint, min(aTint, 1.0));`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uSunView; uniform vec3 uSunColor;
        varying float vTintAmt; varying float vLeaf; varying vec3 vLocal;
        ${NOISE_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float spk = vnoise(vLocal) * 0.65 + vnoise(vLocal * 2.7) * 0.35;
        diffuseColor.rgb *= mix(1.0, 0.6 + 0.75 * spk, vLeaf * ${opts.speckle ?? '1.0'} + vTintAmt * (1.0 - vLeaf) * 0.5);
`)
      .replace('#include <normal_fragment_begin>', opts.cards ? THREE.ShaderChunk.normal_fragment_begin.replace('float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;', 'float faceDirection = 1.0;') : '#include <normal_fragment_begin>')
      .replace('#include <opaque_fragment>', `
        float back = pow(max(dot(normalize(vViewPosition), uSunView), 0.0), 3.0);
        outgoingLight += diffuseColor.rgb * uSunColor * back * 0.55 * vLeaf;
        #include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => 'foliage-' + (opts.key || 'a');
  return mat;
}

// ---------------------------------------------------------------- palettes
const PAL = {
  maple: ['#b0201a', '#d13a1a', '#e2581b', '#ee7d22', '#d99a1e', '#8c1a1f', '#c42a2a', '#f09a2a'],
  birch: ['#e8b51f', '#f1c63c', '#d9a016', '#e9cf5b', '#c99316', '#f4d86a', '#b7a12c'],
  shrub: ['#a11d1b', '#c3331b', '#d55a1c', '#7c1820', '#b37a26', '#e07b2a'],
  fir: ['#3d6338', '#46703c', '#4f7840', '#3a5c40', '#557f4a'],
  spruce: ['#3a5a4c', '#41634f', '#34574d', '#476c58'],
};
const PALC = {};
for (const k in PAL) PALC[k] = PAL[k].map(h => new THREE.Color(h));

// ---------------------------------------------------------------- cells
class Cell {
  constructor(ci, cj) { this.ci = ci; this.cj = cj; this.meshes = []; this.trunks = null; this.built = false; this.stale = false; }
}

export class Vegetation {
  constructor(scene, ground, uniforms, tex) {
    this.scene = scene; this.ground = ground;
    this.group = new THREE.Group(); scene.add(this.group);
    this.cells = new Map();
    this.radius = 950; this.hiR = 330; this.density = 1;
    this.geos = [
      [coniferHi(), coniferLo()], [mapleHi(), mapleLo()], [birchHi(), birchLo()],
      [shrubGeo(), null], [rockGeo(), null], [tuftGeo(), null],
    ];
    this.matFol = makeFoliageMaterial(uniforms, { key: 'fol', map: tex.atlas, alphaTest: 0.42, side: THREE.DoubleSide, cards: true, speckle: '0.25' });
    this.matRock = makeFoliageMaterial(uniforms, { key: 'rock', roughness: 0.9, swayAmp: '0.0', speckle: '0.0', map: tex.rock });
    this.matTuft = makeFoliageMaterial(uniforms, { key: 'tuft', map: tex.tuft, alphaTest: 0.42, side: THREE.DoubleSide, swayAmp: '0.12', speckle: '0.0', cards: true });
    this.cullR = { 3: 400, 4: 650, 5: 230 };
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler();
    this._p = new THREE.Vector3(); this._s = new THREE.Vector3();
  }

  invalidate(minX, minZ, maxX, maxZ) {
    for (const c of this.cells.values()) {
      const x0 = c.ci * CELL, z0 = c.cj * CELL;
      if (x0 > maxX + 60 || x0 + CELL < minX - 60 || z0 > maxZ + 60 || z0 + CELL < minZ - 60) continue;
      c.stale = true;
    }
  }

  update(cx, cz, budgetMs) {
    const t0 = performance.now();
    const R = this.radius;
    const i0 = Math.floor((cx - R) / CELL), i1 = Math.floor((cx + R) / CELL);
    const j0 = Math.floor((cz - R) / CELL), j1 = Math.floor((cz + R) / CELL);
    const todo = [];
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const d = Math.hypot((i + 0.5) * CELL - cx, (j + 0.5) * CELL - cz);
      if (d > R + CELL * 0.7) continue;
      const k = i * 100000 + j;
      let c = this.cells.get(k);
      if (!c) { c = new Cell(i, j); this.cells.set(k, c); }
      c.dist = d;
      if (!c.built || c.stale) todo.push(c);
    }
    todo.sort((a, b) => a.dist - b.dist);
    let pending = 0;
    for (const c of todo) {
      if (performance.now() - t0 < budgetMs) this._build(c); else pending++;
    }
    // visibility / LOD / eviction
    for (const [k, c] of this.cells) {
      const d = Math.hypot((c.ci + 0.5) * CELL - cx, (c.cj + 0.5) * CELL - cz);
      if (d > R + CELL * 1.5) { this._free(c); this.cells.delete(k); continue; }
      const hi = d < this.hiR + CELL * 0.5;
      for (const m of c.meshes) {
        const r = this.cullR[m.userData.type];
        if (m.userData.lo) m.visible = !hi && d < R + CELL * 0.5;
        else if (r) m.visible = d < r + CELL * 0.5;
        else m.visible = hi;
      }
    }
    return pending;
  }

  _free(c) {
    for (const m of c.meshes) { this.group.remove(m); m.geometry.dispose(); m.dispose?.(); }
    c.meshes = []; c.built = false;
  }

  _build(c) {
    this._free(c);
    const th = this.ground.terrainHeight, info = this.ground.info;
    const x0 = c.ci * CELL, z0 = c.cj * CELL;
    const rnd = mulberry32((hash2(c.ci, c.cj, 5) * 4294967296) | 0);
    const lists = [[], [], [], [], [], []];
    const trunks = [];
    const dens = this.density;
    const push = (type, x, y, z, sx, sy, sz, col, rot = rnd() * 6.283, tilt = 0.05) => {
      lists[type].push(x, y, z, sx, sy, sz, rot, (rnd() - 0.5) * tilt, (rnd() - 0.5) * tilt, col.r, col.g, col.b);
    };
    const tmp = new THREE.Color();
    const pick = (arr, t) => arr[Math.min(arr.length - 1, Math.floor(t * arr.length))];
    // trees
    const G = Math.round(32 * Math.sqrt(dens)), sp = CELL / G;
    for (let gj = 0; gj < G; gj++) for (let gi = 0; gi < G; gi++) {
      const x = x0 + (gi + rnd()) * sp, z = z0 + (gj + rnd()) * sp;
      const r0 = rnd();
      const h = th(x, z);
      const rd = info.roadD, fl = info.flag;
      if (h < SEA_LEVEL + 0.6) continue;
      if (fl === FLAG_TUNNEL) { if (rd < 15 && h < info.roadY + 10) continue; }
      else if (rd < 9.5) continue;
      const hx = baseHeight(x + 3, z), hz = baseHeight(x, z + 3), hb = baseHeight(x, z);
      const ny = 3 / Math.hypot(hx - hb, 3, hz - hb);
      const a = biomeAt(x, z);
      let f = forestDensity(x, z, h, 1 - ny, a);
      const verge = 1 - smoothstep(10, 55, rd);
      f *= 0.55 + 0.45 * smoothstep(9.5, 18, rd);
      if (r0 > f) continue;
      const tl = treeline(x, z, a);
      const stunt = 1 - 0.55 * smoothstep(tl - 450, tl, h);
      const dec = deciduousFraction(x, z, h, a) + 0.45 * verge;
      if (rnd() < dec) {
        const hue = foliageHue(x, z, a);
        const maple = rnd() < (0.75 - 0.6 * a) * (1.2 - hue * 0.6);
        if (maple) {
          tmp.copy(pick(PALC.maple, Math.min(0.999, Math.max(0, hue * 0.7 + rnd() * 0.45 - 0.1)))).multiplyScalar(0.8 + rnd() * 0.35);
          const H = (7 + rnd() * 9) * stunt;
          push(T_MAPLE, x, h - 0.3, z, H * (0.8 + rnd() * 0.4), H, H * (0.8 + rnd() * 0.4), tmp);
          trunks.push(x, z, 0.35);
        } else {
          tmp.copy(rnd() < 0.08 ? new THREE.Color('#8fa53a') : pick(PALC.birch, rnd())).multiplyScalar(0.85 + rnd() * 0.3);
          const H = (9 + rnd() * 9) * stunt;
          push(T_BIRCH, x, h - 0.3, z, H * (0.85 + rnd() * 0.3), H, H * (0.85 + rnd() * 0.3), tmp);
          trunks.push(x, z, 0.3);
        }
      } else {
        const spruce = rnd() < 0.25 + 0.7 * a;
        tmp.copy(pick(spruce ? PALC.spruce : PALC.fir, rnd())).multiplyScalar(0.8 + rnd() * 0.4);
        const H = (spruce ? 11 + rnd() * 15 : 15 + rnd() * 26) * stunt;
        const w = spruce ? 0.7 + rnd() * 0.2 : 0.9 + rnd() * 0.3;
        push(T_CONIFER, x, h - 0.4, z, H * w, H, H * w, tmp, rnd() * 6.283, 0.03);
        trunks.push(x, z, 0.25 + H * 0.012);
      }
    }
    // shrubs & rocks
    const GS = Math.round(22 * Math.sqrt(dens)), ss = CELL / GS;
    for (let gj = 0; gj < GS; gj++) for (let gi = 0; gi < GS; gi++) {
      const x = x0 + (gi + rnd()) * ss, z = z0 + (gj + rnd()) * ss;
      const h = th(x, z);
      const rd = info.roadD;
      if (h < SEA_LEVEL + 0.4 || rd < 7.2 || (info.flag === FLAG_TUNNEL && rd < 15)) continue;
      const a = biomeAt(x, z);
      const verge = 1 - smoothstep(9, 40, rd);
      const n = noise2(x * 0.01, z * 0.01);
      const r = rnd();
      if (r < 0.06 + 0.12 * Math.max(0, n) + 0.08 * verge * (rd < 16 ? 1 : 0)) {
        const s = 0.6 + rnd() * rnd() * 3.2;
        const g = 0.32 + rnd() * 0.18;
        tmp.setRGB(g * (a > 0.5 ? 0.95 : 1.02), g, g * (0.95 + rnd() * 0.08));
        push(T_ROCK, x, h - s * 0.12, z, s * (1 + rnd() * 0.6), s, s * (1 + rnd() * 0.6), tmp, rnd() * 6.283, 0.5);
        if (s > 1.4) trunks.push(x, z, s * 0.55);
      } else if (r < 0.32 + 0.55 * verge) {
        const hue = foliageHue(x, z, a);
        tmp.copy(pick(PALC.shrub, Math.min(0.999, hue * 0.6 + rnd() * 0.5))).multiplyScalar(0.75 + rnd() * 0.4);
        if (a > 0.5 && rnd() < 0.5) tmp.lerp(new THREE.Color('#9e3a1f'), 0.4);
        const s = 1.0 + rnd() * 1.8;
        push(T_SHRUB, x, h - 0.15, z, s, s * (0.7 + rnd() * 0.5), s, tmp);
      }
    }
    // grass tufts along the verge and in meadows
    const GT = Math.round(48 * Math.sqrt(dens)), ts = CELL / GT;
    for (let gj = 0; gj < GT; gj++) for (let gi = 0; gi < GT; gi++) {
      const x = x0 + (gi + rnd()) * ts, z = z0 + (gj + rnd()) * ts;
      const pre = rnd();
      if (pre > 0.55) continue;
      const h = th(x, z);
      const rd = info.roadD;
      if (h < SEA_LEVEL + 0.5 || rd < 6.6 || (info.flag === FLAG_TUNNEL && rd < 15)) continue;
      const verge = rd < 24 ? 1 : 0;
      const a = biomeAt(x, z);
      const meadow = (1 - forestDensity(x, z, h, 0.1, a)) * 0.6;
      if (pre > 0.55 * Math.max(verge, meadow)) continue;
      const g = 0.75 + rnd() * 0.35;
      tmp.setRGB(g * 1.05, g, g * 0.85);
      const s = 0.7 + rnd() * 0.7;
      push(T_TUFT, x, h - 0.08, z, s * 1.3, s, s * 1.3, tmp, rnd() * 6.283, 0.25);
    }
    // instanced meshes
    for (let t = 0; t < 6; t++) {
      const L = lists[t]; const n = L.length / 12;
      if (!n) continue;
      for (let lod = 0; lod < 2; lod++) {
        const base = this.geos[t][lod];
        if (!base) continue;
        // own copy: disposing a geometry frees its GPU buffers, so never share them
        const geo = base.clone();
        const tint = new Float32Array(n * 3);
        const mat = t === T_ROCK ? this.matRock : t === T_TUFT ? this.matTuft : this.matFol;
        const im = new THREE.InstancedMesh(geo, mat, n);
        for (let k = 0; k < n; k++) {
          const o = k * 12;
          this._p.set(L[o], L[o + 1], L[o + 2]);
          this._s.set(L[o + 3], L[o + 4], L[o + 5]);
          this._e.set(L[o + 7], L[o + 6], L[o + 8]);
          this._q.setFromEuler(this._e);
          this._m.compose(this._p, this._q, this._s);
          im.setMatrixAt(k, this._m);
          tint[k * 3] = L[o + 9]; tint[k * 3 + 1] = L[o + 10]; tint[k * 3 + 2] = L[o + 11];
        }
        geo.setAttribute('iTint', new THREE.InstancedBufferAttribute(tint, 3));
        geo.boundingSphere = null;
        im.computeBoundingSphere();
        im.userData.type = t; im.userData.lo = lod === 1;
        im.castShadow = lod === 0 && (t <= T_BIRCH || t === T_ROCK);
        im.receiveShadow = t !== T_TUFT;
        im.matrixAutoUpdate = false;
        im.visible = false;
        this.group.add(im);
        c.meshes.push(im);
      }
    }
    c.trunks = new Float32Array(trunks);
    c.built = true; c.stale = false;
  }

  // Push a circle (car) out of tree trunks / big boulders.
  collide(x, z, r) {
    const ci = Math.floor(x / CELL), cj = Math.floor(z / CELL);
    let hit = null;
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      const c = this.cells.get((ci + di) * 100000 + (cj + dj));
      if (!c || !c.trunks) continue;
      const T = c.trunks;
      for (let k = 0; k < T.length; k += 3) {
        const dx = x - T[k], dz = z - T[k + 1];
        if (Math.abs(dx) > 4 || Math.abs(dz) > 4) continue;
        const d = Math.hypot(dx, dz), m = r + T[k + 2];
        if (d < m && d > 1e-4) {
          if (!hit || m - d > hit.pen) hit = { nx: dx / d, nz: dz / d, pen: m - d };
        }
      }
    }
    return hit;
  }
}
