// Terrain generation, the river, the lake and their meshes.
import * as THREE from 'three';
import { N, fbm, eroded, smooth, clamp, lerp, smin } from './noise.js';
import { U, NOISE_GLSL, patch } from './shaders.js';

export const WORLD = 1000, HALF = WORLD / 2, SEG = 512, CELL = WORLD / SEG;
export const OUTER = 6000, OSEG = 240, BOUND = 485;
const RS = SEG + 1;
const RA = 0.55, RCA = Math.cos(RA), RSA = Math.sin(RA);

// Long rounded ridges running NE-SW (the Ridge-and-Valley look), broken by gaps,
// with eroded spurs and gullies on the flanks and rocky crests on top.
function rawHeight(x, z) {
  const wx = x + 110 * N(x * 0.0012 + 11.3, z * 0.0012 - 4.1);
  const wz = z + 110 * N(x * 0.0012 - 7.7, z * 0.0012 + 9.2);
  const u = wx * RCA - wz * RSA, v = wx * RSA + wz * RCA;
  const ph = 1.6 * N(u * 0.0015 + 3.3, v * 0.0008);
  let ridge = 0.5 + 0.5 * Math.cos(v * 0.016 + ph);
  ridge = ridge * ridge * (3 - 2 * ridge);
  const gaps = 0.55 + 0.45 * N(u * 0.0035 - 2.1, v * 0.002 + 8.4);
  const big = fbm(wx, wz, 2, 0.0007);
  const ero = eroded(wx, wz, 6, 0.0042);
  const crest = 1 - Math.abs(N(u * 0.006 + 1.7, v * 0.02 - 3.3));
  let h = 16 + 112 * ridge * gaps * (0.75 + 0.35 * big) + 30 * ero * (0.45 + 0.75 * ridge) + 24 * big + 9 * crest * crest * crest * ridge;
  h += 1.6 * N(x * 0.04, z * 0.04) + 0.5 * N(x * 0.13 + 3, z * 0.13 - 1);
  return h;
}

export let LAKE = { x: 0, z: 0, h: 1e9 };
for (let gx = -300; gx <= 300; gx += 15) for (let gz = -300; gz <= 300; gz += 15) {
  const h = rawHeight(gx, gz); if (h < LAKE.h) LAKE = { x: gx, z: gz, h };
}
export const WATER = LAKE.h + 6;
const LAKE_R = 155;

export function height(x, z) {
  let h = rawHeight(x, z);
  const dx = x - LAKE.x, dz = z - LAKE.z, d = Math.sqrt(dx * dx + dz * dz);
  if (d < LAKE_R * 1.4) {
    const a = Math.atan2(dz, dx);
    const rr = LAKE_R * (1 + 0.3 * N(Math.cos(a) * 1.3 + 5, Math.sin(a) * 1.3 - 2));
    const k = 1 - smooth(rr * 0.35, rr, d);
    if (k > 0) h = h * (1 - k) + Math.min(h, WATER - 8) * k;
  }
  return h;
}
export const forestDensity = (x, z) => smooth(0.2, 0.45, fbm(x + 500, z - 300, 3, 0.005) * 0.5 + 0.5);

export const heights = new Float32Array(RS * RS);
const riverD = new Float32Array(RS * RS).fill(1e9);
const riverW = new Float32Array(RS * RS);
const riverBed = new Float32Array(RS * RS);
const riverWL = new Float32Array(RS * RS).fill(-1e9);

function sampleGrid(arr, x, z) {
  const fx = (x + HALF) / CELL, fz = (z + HALF) / CELL;
  const ix = clamp(Math.floor(fx), 0, SEG - 1), iz = clamp(Math.floor(fz), 0, SEG - 1), tx = clamp(fx - ix, 0, 1), tz = clamp(fz - iz, 0, 1);
  const a = arr[iz * RS + ix], b = arr[iz * RS + ix + 1], c = arr[(iz + 1) * RS + ix], d = arr[(iz + 1) * RS + ix + 1];
  return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
}
export function getH(x, z) {
  if (x < -HALF || z < -HALF || x >= HALF || z >= HALF) return height(x, z);
  return sampleGrid(heights, x, z);
}
export function slopeAt(x, z) {
  const e = 1.5;
  const gx = (getH(x + e, z) - getH(x - e, z)) / (2 * e), gz = (getH(x, z + e) - getH(x, z - e)) / (2 * e);
  return Math.sqrt(gx * gx + gz * gz);
}
export function riverDistAt(x, z) {
  if (x < -HALF || z < -HALF || x >= HALF || z >= HALF) return 1e9;
  const ix = Math.round((x + HALF) / CELL), iz = Math.round((z + HALF) / CELL);
  const k = clamp(iz, 0, SEG) * RS + clamp(ix, 0, SEG);
  return riverD[k] - riverW[k] * 0.7;
}
// Water surface height at a point, or -Infinity where there is no water.
export function waterLevelAt(x, z) {
  let wl = -Infinity;
  if (x >= -HALF && z >= -HALF && x < HALF && z < HALF) {
    const ix = Math.round((x + HALF) / CELL), iz = Math.round((z + HALF) / CELL);
    const v = riverWL[clamp(iz, 0, SEG) * RS + clamp(ix, 0, SEG)];
    if (v > -1e8) wl = v;
  }
  if (getH(x, z) < WATER) wl = Math.max(wl, WATER);
  return wl;
}
export const isWet = (x, z, margin = 0.3) => getH(x, z) < waterLevelAt(x, z) + margin;

// ---------------------------------------------------------------- river: least-cost path down the valleys into the lake
export const river = { pts: [], wl: [], w: [] };
function buildRiver() {
  const CN = 125, CS = WORLD / CN, CR = CN + 1;
  const ch = new Float32Array(CR * CR);
  for (let iz = 0; iz <= CN; iz++) for (let ix = 0; ix <= CN; ix++) ch[iz * CR + ix] = getH(-HALF + ix * CS, -HALF + iz * CS);
  const lx = Math.round((LAKE.x + HALF) / CS), lz = Math.round((LAKE.z + HALF) / CS);
  const dist = new Float64Array(CR * CR).fill(Infinity), prev = new Int32Array(CR * CR).fill(-1);
  const heap = [];
  const push = (d, i) => { heap.push([d, i]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
  const start = lz * CR + lx; dist[start] = 0; push(0, start);
  while (heap.length) {
    const [d, i] = pop(); if (d > dist[i]) continue;
    const ix = i % CR, iz = (i / CR) | 0;
    for (let oz = -1; oz <= 1; oz++) for (let ox = -1; ox <= 1; ox++) {
      if (!ox && !oz) continue;
      const nx = ix + ox, nz = iz + oz; if (nx < 0 || nz < 0 || nx > CN || nz > CN) continue;
      const j = nz * CR + nx, len = Math.hypot(ox, oz) * CS;
      const climb = Math.max(0, ch[j] - ch[i]);
      const c = len * (1 + Math.max(0, ch[j] - WATER) * 0.07) + climb * 25;
      if (d + c < dist[j]) { dist[j] = d + c; prev[j] = i; push(d + c, j); }
    }
  }
  // source: a low valley near the edge of the map, as far from the lake as practical
  let src = -1, best = -Infinity;
  for (let iz = 3; iz <= CN - 3; iz++) for (let ix = 3; ix <= CN - 3; ix++) {
    const edge = Math.min(ix, iz, CN - ix, CN - iz); if (edge > 8) continue;
    const i = iz * CR + ix, x = -HALF + ix * CS, z = -HALF + iz * CS;
    const far = Math.hypot(x - LAKE.x, z - LAKE.z);
    if (far < 320) continue;
    const score = far * 0.25 - (ch[i] - WATER) * 3;
    if (score > best) { best = score; src = i; }
  }
  if (src < 0) return;
  let pts = [];
  for (let i = src; i >= 0; i = prev[i]) { pts.push([-HALF + (i % CR) * CS, -HALF + ((i / CR) | 0) * CS]); if (i === start) break; }
  for (let it = 0; it < 4; it++) {
    const out = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) { const [ax, az] = pts[i], [bx, bz] = pts[i + 1]; out.push([ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25], [ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75]); }
    out.push(pts[pts.length - 1]); pts = out;
  }
  // resample every 2m and add a gentle meander
  const rs = []; let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1], L = Math.hypot(bx - ax, bz - az);
    while (acc <= L) { const t = acc / L; rs.push([ax + (bx - ax) * t, az + (bz - az) * t]); acc += 2; }
    acc -= L;
  }
  const out = [];
  for (let i = 0; i < rs.length; i++) {
    const a = rs[Math.max(0, i - 3)], b = rs[Math.min(rs.length - 1, i + 3)];
    let tx = b[0] - a[0], tz = b[1] - a[1]; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    const m = 7 * N(i * 0.012 + 4.4, 1.7) * smooth(0, 20, i) * smooth(rs.length, rs.length - 30, i);
    out.push([rs[i][0] - tz * m, rs[i][1] + tx * m]);
  }
  // stop a little way into the lake
  let end = out.length;
  for (let i = 0; i < out.length; i++) if (getH(out[i][0], out[i][1]) < WATER - 3) { end = Math.min(out.length, i + 6); break; }
  const P = out.slice(0, end), n = P.length;
  let bed = getH(P[0][0], P[0][1]) - 1.8;
  for (let i = 0; i < n; i++) {
    const [x, z] = P[i];
    bed = Math.min(bed - 0.012, getH(x, z) - 1.8);
    const w = 2.4 + 3.4 * (i / n);
    river.pts.push(new THREE.Vector2(x, z)); river.wl.push(bed + 1.1); river.w.push(w);
    const R = w * 0.7 + 16, x0 = Math.floor((x - R + HALF) / CELL), x1 = Math.ceil((x + R + HALF) / CELL), z0 = Math.floor((z - R + HALF) / CELL), z1 = Math.ceil((z + R + HALF) / CELL);
    for (let iz = Math.max(0, z0); iz <= Math.min(SEG, z1); iz++) for (let ix = Math.max(0, x0); ix <= Math.min(SEG, x1); ix++) {
      const k = iz * RS + ix, gx = -HALF + ix * CELL, gz = -HALF + iz * CELL;
      const d = Math.hypot(gx - x, gz - z);
      if (d < riverD[k]) { riverD[k] = d; riverW[k] = w; riverBed[k] = bed; }
    }
  }
  for (let k = 0; k < RS * RS; k++) {
    if (riverD[k] > 1e8) continue;
    const w = riverW[k], d = riverD[k], b = riverBed[k];
    heights[k] = smin(heights[k], b + Math.max(0, d - w * 0.7) * 0.5, 2.0);
    if (d < w * 0.7 + 2.6) riverWL[k] = b + 1.1;
  }
}

// ---------------------------------------------------------------- terrain material
const TERRAIN_FRAG = `
{
  vec2 wp = vWPos.xz;
  float n1 = vnoise(wp * 0.08);
  float n2 = vnoise(wp * 0.9);
  float n3 = vnoise(wp * 3.7);
  float n4 = vnoise(wp * 0.23 + 3.0);
  vec3 c = diffuseColor.rgb;
  c *= (0.74 + 0.32 * n2 + 0.14 * n3) * (0.78 + 0.4 * n4);
  c = mix(c, c * vec3(0.7, 0.62, 0.5), smoothstep(0.55, 0.8, vnoise(wp * 0.6 - 9.0)) * 0.6);
  c = mix(c, c * vec3(1.12, 0.92, 0.78), n1);
  float strata = sin(vWPos.y * 1.3 + vnoise(wp * 0.07) * 9.0 + vnoise(wp * 0.6) * 2.0) * 0.5 + 0.5;
  c = mix(c, c * (0.82 + 0.3 * strata * vnoise(wp * 0.3 + 4.0)) * vec3(1.0, 0.97, 0.92), vSurf.y * 0.8);
  float pop = smoothstep(0.7, 0.9, vnoise(wp * 2.3 + 17.0));
  vec3 leafPop = mix(SRGB(vec3(0.62, 0.12, 0.05)), SRGB(vec3(0.86, 0.55, 0.1)), vnoise(wp * 1.1));
  c = mix(c, leafPop, pop * vSurf.x * 0.65);
  float dist = length(vWPos - cameraPosition);
  float cm = smoothstep(200.0, 480.0, dist) * smoothstep(0.3, 0.6, vSurf.x);
  float cn = vnoise(wp * 0.09), cn2 = vnoise(wp * 0.33 + 5.0);
  vec3 canopy = mix(SRGB(vec3(0.62, 0.13, 0.05)), SRGB(vec3(0.88, 0.45, 0.1)), smoothstep(0.2, 0.6, cn));
  canopy = mix(canopy, SRGB(vec3(0.9, 0.7, 0.18)), smoothstep(0.58, 0.9, cn));
  canopy = mix(canopy, SRGB(vec3(0.16, 0.24, 0.12)), smoothstep(0.72, 0.95, cn2) * 0.85);
  canopy *= 0.5 + 0.62 * cn2;
  c = mix(c, canopy, cm);
  c *= 1.0 + uDream * 0.22 * sin(dot(wp, vec2(0.11, 0.07)) + uTime * 0.5 + n1 * 6.0);
  diffuseColor.rgb = c;
}`;
const TERRAIN_BUMP = `
{
  float bd = length(vWPos - cameraPosition);
  if (bd < 90.0) {
    vec2 wp = vWPos.xz;
    float e = 0.06;
    #define BH(p) (vnoise((p) * 1.6) * 0.55 + vnoise((p) * 5.1) * 0.3 + vnoise((p) * 12.7) * 0.15)
    vec2 g = vec2(BH(wp + vec2(e, 0.0)) - BH(wp - vec2(e, 0.0)), BH(wp + vec2(0.0, e)) - BH(wp - vec2(0.0, e))) / (2.0 * e);
    float k = (0.22 + vSurf.y * 0.5) * (1.0 - smoothstep(50.0, 90.0, bd));
    normal = normalize(normal - (viewMatrix * vec4(g.x, 0.0, g.y, 0.0)).xyz * k);
  }
}`;
export const terrainMat = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }), 'terrain', (sh) => {
  sh.uniforms.uTime = U.uTime; sh.uniforms.uDream = U.uDream;
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nattribute vec2 aSurf;\nvarying vec2 vSurf;\nvarying vec3 vWPos;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSurf = aSurf;\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', `#include <common>\nuniform float uTime; uniform float uDream;\nvarying vec2 vSurf;\nvarying vec3 vWPos;\n${NOISE_GLSL}`)
    .replace('#include <color_fragment>', '#include <color_fragment>\n' + TERRAIN_FRAG)
    .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + TERRAIN_BUMP);
});

const COL = {
  grass: new THREE.Color('#8f8540'), grassLow: new THREE.Color('#6f7a3a'),
  litter: new THREE.Color('#7a4420'), litter2: new THREE.Color('#8c5a24'),
  rock: new THREE.Color('#7b766c'), mud: new THREE.Color('#4a3a2a'), sand: new THREE.Color('#8a7a5c'), pebble: new THREE.Color('#6e675c'),
};
function colorTerrain(geo, isOuter) {
  const pos = geo.attributes.position, nor = geo.attributes.normal, n = pos.count;
  const cols = new Float32Array(n * 3), surf = new Float32Array(n * 2);
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), ny = nor.getY(i);
    const fd = forestDensity(x, z);
    const rd = isOuter ? 1e9 : riverDistAt(x, z);
    const wl = isOuter ? WATER : Math.max(WATER, waterLevelAt(x, z));
    const rock = smooth(0.8, 0.64, ny);
    c.copy(COL.grass).lerp(COL.grassLow, smooth(60, 20, y - WATER));
    c.lerp(N(x * 0.05, z * 0.05) > 0 ? COL.litter : COL.litter2, smooth(0.15, 0.6, fd));
    c.lerp(COL.rock, rock * 0.92);
    c.lerp(COL.sand, smooth(2.2, 0.6, y - WATER));
    c.lerp(COL.pebble, smooth(4, 0.5, rd) * 0.85);
    c.lerp(COL.mud, smooth(0.5, -1.5, y - wl));
    cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
    surf[i * 2] = (y < WATER + 1 || ny < 0.72 || rd < 4) ? 0 : (isOuter ? Math.max(fd, 0.55) : fd);
    surf[i * 2 + 1] = rock;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  geo.setAttribute('aSurf', new THREE.BufferAttribute(surf, 2));
}

export let heightTex = null;
let innerMesh = null;
// Turn the ground around the homestead into grazed pasture.
export function paintPasture(spots) {
  const g = innerMesh.geometry, pos = g.attributes.position, col = g.attributes.color, surf = g.attributes.aSurf;
  const grass = new THREE.Color('#7f8a3e'), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    let k = 0;
    for (const s of spots) k = Math.max(k, smooth(s.r, s.r * 0.55, Math.hypot(x - s.x, z - s.z)));
    if (k <= 0) continue;
    c.fromBufferAttribute(col, i).lerp(grass.clone().offsetHSL(0, 0, N(x * 0.08, z * 0.08) * 0.06), k * 0.9);
    col.setXYZ(i, c.r, c.g, c.b);
    surf.setX(i, surf.getX(i) * (1 - k));
  }
  col.needsUpdate = true; surf.needsUpdate = true;
}
export function buildTerrain(scene) {
  const g = new THREE.PlaneGeometry(WORLD, WORLD, SEG, SEG); g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) heights[i] = height(p.getX(i), p.getZ(i));
  buildRiver();
  for (let i = 0; i < p.count; i++) p.setY(i, heights[i]);
  g.computeVertexNormals(); colorTerrain(g, false);
  const m = new THREE.Mesh(g, terrainMat); m.receiveShadow = true; scene.add(m);
  innerMesh = m;

  const og = new THREE.PlaneGeometry(OUTER, OUTER, OSEG, OSEG); og.rotateX(-Math.PI / 2);
  const op = og.attributes.position;
  for (let i = 0; i < op.count; i++) {
    const x = op.getX(i), z = op.getZ(i);
    const inside = Math.abs(x) < HALF - 1 && Math.abs(z) < HALF - 1;
    op.setY(i, height(x, z) - (inside ? 25 : 0));
  }
  og.computeVertexNormals(); colorTerrain(og, true);
  scene.add(new THREE.Mesh(og, terrainMat));

  const half = new Uint16Array(RS * RS);
  for (let i = 0; i < RS * RS; i++) half[i] = THREE.DataUtils.toHalfFloat(heights[i]);
  heightTex = new THREE.DataTexture(half, RS, RS, THREE.RedFormat, THREE.HalfFloatType);
  heightTex.magFilter = heightTex.minFilter = THREE.LinearFilter; heightTex.needsUpdate = true;
  buildWater(scene);
}

// ---------------------------------------------------------------- water
export const waterUniforms = {
  uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color() }, uZenith: { value: new THREE.Color() },
  uHorizon: { value: new THREE.Color() }, uNight: { value: 0 }, uHeight: { value: null },
};
const WATER_COMMON = `
  uniform vec3 uSunDir, uSunColor, uZenith, uHorizon; uniform float uTime, uNight, uDream; uniform sampler2D uHeight;
  varying vec3 vW;
  #include <common>
  #include <fog_pars_fragment>
  ${NOISE_GLSL}
  float terrainAt(vec2 p){ vec2 uv = ((p + ${HALF.toFixed(1)}) / ${CELL.toFixed(6)} + 0.5) / ${RS.toFixed(1)}; return texture2D(uHeight, uv).r; }
  vec3 shade(vec3 n, float depth, float foam, float level){
    vec3 V = normalize(cameraPosition - vW);
    float fres = 0.03 + 0.97 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
    vec3 R = reflect(-V, n);
    vec3 sky = mix(uHorizon, uZenith, pow(max(R.y, 0.0), 0.5));
    vec3 shore = SRGB(vec3(0.42, 0.2, 0.08)) * (0.3 + 0.7 * (1.0 - uNight)) * (0.6 + 0.6 * uHorizon.r);
    sky = mix(shore, sky, smoothstep(0.02, 0.22, R.y));
    vec3 shallowC = SRGB(vec3(0.28, 0.34, 0.24)), deepC = SRGB(vec3(0.04, 0.1, 0.12));
    vec3 body = mix(shallowC, deepC, smoothstep(0.0, 5.0, depth)) * (1.0 - 0.85 * uNight) * (0.5 + 0.6 * uHorizon.g);
    vec3 col = mix(body, sky, fres);
    col += uSunColor * pow(max(dot(R, uSunDir), 0.0), 220.0) * 4.0 * (1.0 - uNight);
    col = mix(col, vec3(0.9, 0.88, 0.82) * (0.25 + 0.75 * (1.0 - uNight)) * (0.5 + 0.5 * uHorizon.r), foam);
    return col;
  }`;
const WATER_VERT = `
  #include <common>
  #include <fog_pars_vertex>
  attribute vec2 aFlow;
  varying vec3 vW; varying vec2 vFlow; varying vec2 vUv2;
  void main(){ vec3 transformed = position; vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; vFlow = aFlow; vUv2 = uv;
    vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;
function makeWaterMat(fragMain) {
  return new THREE.ShaderMaterial({
    transparent: true, fog: true, depthWrite: false,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uDream: { value: 0 } }]),
    vertexShader: WATER_VERT,
    fragmentShader: WATER_COMMON + `\nvarying vec2 vFlow; varying vec2 vUv2;\n` + fragMain,
  });
}
export const lakeMat = makeWaterMat(`
  float wh(vec2 p){ float t = uTime;
    return vnoise(p * 0.18 + vec2(t * 0.25, t * 0.1)) * 0.5 + vnoise(p * 0.7 - vec2(t * 0.4, -t * 0.3)) * 0.25 + vnoise(p * 2.1 + vec2(t * 0.8, -t * 0.5)) * 0.1; }
  void main(){
    vec2 p = vW.xz; float e = 0.15; float s = 0.55 + uDream * 0.6;
    vec3 n = normalize(vec3(-(wh(p + vec2(e, 0.0)) - wh(p - vec2(e, 0.0))) / (2.0 * e) * s, 1.0, -(wh(p + vec2(0.0, e)) - wh(p - vec2(0.0, e))) / (2.0 * e) * s));
    float depth = vW.y - terrainAt(p);
    float foam = smoothstep(0.55, 0.0, depth) * smoothstep(0.35, 0.75, vnoise(p * 1.8 + vec2(uTime * 0.3, 0.0)) + 0.35 * sin(depth * 14.0 - uTime * 1.5));
    vec3 col = shade(n, depth, foam * 0.75, vW.y);
    float a = mix(0.35, 0.96, smoothstep(0.0, 2.5, depth));
    gl_FragColor = vec4(col, max(a, foam * 0.8));
    #include <fog_fragment>
  }`);
export const riverMat = makeWaterMat(`
  void main(){
    vec2 p = vW.xz; float t = uTime;
    float speed = 1.2 + vFlow.x * 18.0;
    vec2 fuv = vec2(vUv2.x * 3.0, vUv2.y * 0.25 - t * speed * 0.25);
    float n1 = vnoise(fuv * vec2(2.0, 3.0)), n2 = vnoise(fuv * vec2(5.0, 9.0) + 7.0);
    vec3 n = normalize(vec3((n1 - 0.5) * 0.5 + (n2 - 0.5) * 0.25, 1.0, (n2 - 0.5) * 0.5));
    float depth = vW.y - terrainAt(p);
    float rapids = smoothstep(0.02, 0.08, vFlow.x);
    float n3 = vnoise(fuv * vec2(9.0, 16.0) + 3.0);
    float foam = smoothstep(0.78, 0.98, n1 * 0.5 + n2 * 0.3 + n3 * 0.4) * (0.15 + rapids * 0.8) + smoothstep(0.25, 0.0, depth) * 0.25;
    vec3 col = shade(n, depth, clamp(foam, 0.0, 0.85), vW.y);
    float edge = smoothstep(0.0, 0.08, vUv2.x) * smoothstep(1.0, 0.92, vUv2.x);
    gl_FragColor = vec4(col, mix(0.0, 0.92, smoothstep(0.0, 0.9, depth)) * edge);
    #include <fog_fragment>
  }`);
for (const m of [lakeMat, riverMat]) Object.assign(m.uniforms, waterUniforms);

function buildWater(scene) {
  waterUniforms.uHeight.value = heightTex;
  const lake = new THREE.Mesh(new THREE.PlaneGeometry(OUTER, OUTER, 1, 1).rotateX(-Math.PI / 2), lakeMat);
  lake.position.y = WATER; lake.renderOrder = 2;
  scene.add(lake);
  const n = river.pts.length; if (n < 4) return;
  const pos = [], uv = [], flow = [], idx = [];
  let along = 0;
  for (let i = 0; i < n; i++) {
    const a = river.pts[Math.max(0, i - 1)], b = river.pts[Math.min(n - 1, i + 1)];
    let tx = b.x - a.x, tz = b.y - a.y; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    const hw = river.w[i] * 0.7 + 5, y = river.wl[i];
    const sl = Math.max(0, (river.wl[Math.max(0, i - 2)] - river.wl[Math.min(n - 1, i + 2)]) / 8);
    if (i > 0) along += river.pts[i].distanceTo(river.pts[i - 1]);
    pos.push(river.pts[i].x - tz * hw, y, river.pts[i].y + tx * hw, river.pts[i].x + tz * hw, y, river.pts[i].y - tx * hw);
    uv.push(0, along, 1, along); flow.push(sl, 0, sl, 0);
    if (i < n - 1) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aFlow', new THREE.Float32BufferAttribute(flow, 2));
  g.setIndex(idx);
  const rm = new THREE.Mesh(g, riverMat); rm.renderOrder = 3; rm.frustumCulled = false;
  scene.add(rm);
}
export function nearestRiverPoint(x, z) {
  let best = null, bd = Infinity;
  for (let i = 0; i < river.pts.length; i += 3) { const p = river.pts[i], d = (p.x - x) ** 2 + (p.y - z) ** 2; if (d < bd) { bd = d; best = i; } }
  return best === null ? null : { x: river.pts[best].x, z: river.pts[best].y, y: river.wl[best], d: Math.sqrt(bd), steep: best > 2 && best < river.wl.length - 3 ? (river.wl[best - 2] - river.wl[best + 2]) / 8 : 0 };
}
export function updateWater(t, dream) {
  lakeMat.uniforms.uTime.value = riverMat.uniforms.uTime.value = t;
  lakeMat.uniforms.uDream.value = riverMat.uniforms.uDream.value = dream;
}
