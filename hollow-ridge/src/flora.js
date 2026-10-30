// Trees, undergrowth, falling leaves, glowing motes and valley mist.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { N, mulberry32, SEED, smooth, clamp, lerp, pick } from './noise.js';
import { U, NOISE_GLSL, patch, glowTexture } from './shaders.js';
import { HALF, WATER, getH, slopeAt, forestDensity, riverDistAt, isWet, waterLevelAt } from './world.js';
import { spawn, farm } from './sites.js';
import { S } from './state.js';

export const GLOW = glowTexture();

// Leaf-cluster texture: a solid middle (used by the crown cores) surrounded by loose leaves (used by the cards).
function leafTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  const r = mulberry32(77);
  g.fillStyle = 'rgb(190,190,190)'; g.beginPath(); g.arc(128, 128, 62, 0, 7); g.fill();
  for (let i = 0; i < 420; i++) {
    const a = r() * Math.PI * 2, d = Math.pow(r(), 0.7) * 112, x = 128 + Math.cos(a) * d, y = 128 + Math.sin(a) * d;
    const s = 7 + r() * 9, b = Math.floor(120 + r() * 135);
    g.save(); g.translate(x, y); g.rotate(r() * 6.28);
    g.fillStyle = `rgb(${b},${b},${b})`;
    g.beginPath(); g.moveTo(0, -s); g.quadraticCurveTo(s * 0.7, -s * 0.2, 0, s); g.quadraticCurveTo(-s * 0.7, -s * 0.2, 0, -s); g.fill();
    g.strokeStyle = `rgba(60,60,60,0.35)`; g.lineWidth = 0.8; g.beginPath(); g.moveTo(0, -s); g.lineTo(0, s); g.stroke();
    g.restore();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
const LEAF_TEX = leafTexture();

function windPatch(mat, key, base, amount, glow, breathe) {
  return patch(mat, key, (sh) => {
    Object.assign(sh.uniforms, { uTime: U.uTime, uWind: U.uWind, uDream: U.uDream, uDay: U.uDay });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uWind; uniform float uDream;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      {
        vec3 ip = vec3(0.0);
        #ifdef USE_INSTANCING
        ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        #endif
        float hgt = max(transformed.y - ${base.toFixed(2)}, 0.0);
        float ph = uTime * 1.1 + ip.x * 0.045 + ip.z * 0.06;
        float w = uWind * (1.0 + uDream * 1.5) * ${amount.toFixed(3)};
        transformed.x += (sin(ph) + 0.4 * sin(ph * 2.3 + 1.0)) * hgt * w;
        transformed.z += cos(ph * 0.83) * hgt * w * 0.7;
        transformed += normal * sin(uTime * 2.7 + position.y * 1.7 + position.x * 1.3 + ip.x) * 0.04 * uWind * (1.0 + uDream);
        ${breathe ? 'transformed.xz *= 1.0 + uDream * 0.045 * sin(uTime * 0.45 + ip.x * 0.02 + ip.z * 0.03);' : ''}
      }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uDream; uniform float uDay;\n' + NOISE_GLSL)
      .replace('#include <color_fragment>', `#include <color_fragment>
      #ifdef USE_FOG
      {
        vec3 lw = vFogWorld;
        float ln = vnoise(lw.xz * 2.2 + lw.y * 1.7);
        float ln2 = vnoise(lw.xy * 5.5 + lw.z * 3.1);
        diffuseColor.rgb *= 0.72 + 0.36 * ln * ln2 + 0.18 * ln2;
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.12, 0.78, 0.6), smoothstep(0.62, 0.9, ln) * 0.4);
      }
      #endif`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * (${glow.toFixed(3)} * uDay + uDream * 0.15 * (0.3 + 0.7 * uDay));`);
  });
}

// Crown = lumpy core blobs + leaf cards scattered over their surface (one draw call, one material).
function crown(rng, blobs, detail, cardsPerArea) {
  const geos = [];
  let minY = 1e9, maxY = -1e9;
  for (const b of blobs) { minY = Math.min(minY, b[1] - b[3]); maxY = Math.max(maxY, b[1] + b[3]); }
  const seed = rng() * 100;
  const shadeAt = (y, vy, x, z) => clamp(0.42 + 0.58 * smooth(minY, maxY, y) * (0.75 + 0.25 * Math.max(vy + 0.3, 0)) + 0.12 * N(x * 1.7, z * 1.7 + y), 0.25, 1.05);
  const q = new THREE.Quaternion(), m = new THREE.Matrix4(), dir = new THREE.Vector3(), Z = new THREE.Vector3(0, 0, 1), roll = new THREE.Quaternion();
  for (const [cx, cy, cz, r] of blobs) {
    const g = new THREE.IcosahedronGeometry(r, detail);
    const p = g.attributes.position, nrm = g.attributes.normal, uv = g.attributes.uv, cols = new Float32Array(p.count * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.set(p.getX(i), p.getY(i), p.getZ(i)).normalize();
      const k = 0.88 + 0.2 * N(v.x * 2.2 + seed + cx, v.y * 2.2 + v.z * 1.7 + cz);
      const x = cx + v.x * r * k, y = cy + v.y * r * k * 0.9, z = cz + v.z * r * k;
      p.setXYZ(i, x, y, z);
      const nn = new THREE.Vector3(v.x, v.y + 0.35, v.z).normalize(); nrm.setXYZ(i, nn.x, nn.y, nn.z);
      uv.setXY(i, 0.5 + v.x * 0.16, 0.5 + v.z * 0.16);
      cols[i * 3] = cols[i * 3 + 1] = cols[i * 3 + 2] = shadeAt(y, v.y, x, z) * 0.85;
    }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    geos.push(g);
    const cards = cardsPerArea ? Math.round(r * r * cardsPerArea) : 0;
    for (let c = 0; c < cards; c++) {
      dir.set(rng() * 2 - 1, rng() * 1.6 - 0.5, rng() * 2 - 1).normalize();
      const s = r * (0.7 + rng() * 0.45), d = r * (0.72 + rng() * 0.3);
      const pg = new THREE.PlaneGeometry(s, s).toNonIndexed();
      q.setFromUnitVectors(Z, dir); roll.setFromAxisAngle(Z, rng() * 6.28); q.multiply(roll);
      m.compose(new THREE.Vector3(cx + dir.x * d, cy + dir.y * d * 0.9, cz + dir.z * d), q, new THREE.Vector3(1, 1, 1));
      pg.applyMatrix4(m);
      const pp = pg.attributes.position, pn = pg.attributes.normal, pc = new Float32Array(pp.count * 3);
      const nn = new THREE.Vector3(dir.x, dir.y + 0.4, dir.z).normalize();
      for (let i = 0; i < pp.count; i++) {
        pn.setXYZ(i, nn.x, nn.y, nn.z);
        pc[i * 3] = pc[i * 3 + 1] = pc[i * 3 + 2] = shadeAt(pp.getY(i), dir.y, pp.getX(i), pp.getZ(i));
      }
      pg.setAttribute('color', new THREE.BufferAttribute(pc, 3));
      geos.push(pg);
    }
  }
  return mergeGeometries(geos);
}
function trunkGeo(h, r0, r1, seg, branches) {
  const parts = [new THREE.CylinderGeometry(r1, r0, h, seg, 3).translate(0, h / 2, 0)];
  for (const [y, ang, len] of branches) {
    const b = new THREE.CylinderGeometry(r1 * 0.35, r1 * 0.55, len, Math.max(4, seg - 2)).translate(0, len / 2, 0);
    b.rotateZ(-0.9); b.rotateY(ang); b.translate(0, y, 0); parts.push(b);
  }
  parts.forEach(g => g.deleteAttribute('uv'));
  return mergeGeometries(parts.map(g => g.index ? g.toNonIndexed() : g));
}
function coneTree(rng, tiers, detail) {
  const geos = [];
  for (let k = 0; k < tiers; k++) {
    const r = 3.1 - k * (2.6 / tiers), y = 2.6 + k * 2.3;
    const g = new THREE.ConeGeometry(r, 3.8, detail, 2).translate(0, y, 0).toNonIndexed();
    const p = g.attributes.position, cols = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), yy = p.getY(i), z = p.getZ(i);
      const j = 1 + 0.12 * N(x * 1.3 + k, z * 1.3 - k);
      p.setXYZ(i, x * j, yy - (Math.hypot(x, z) / r) * 0.6, z * j);
      cols[i * 3] = cols[i * 3 + 1] = cols[i * 3 + 2] = 0.45 + 0.55 * smooth(y - 2, y + 2, yy) * (0.6 + 0.4 * k / tiers);
    }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    g.deleteAttribute('uv'); g.deleteAttribute('normal');
    const mg = mergeVertices(g, 1e-3); mg.computeVertexNormals();
    geos.push(mg.toNonIndexed());
  }
  return mergeGeometries(geos);
}

class Species {
  constructor(scene, parts, max) {
    this.max = max; this.n = 0;
    this.mats = new Float32Array(max * 16); this.cols = new Float32Array(max * 3); this.xz = new Float32Array(max * 2);
    this.near = []; this.far = [];
    const makeSet = (list, isNear) => {
      let im = null, ic = null;
      for (const [geo, mat, colored, depthMat] of list) {
        const m = new THREE.InstancedMesh(geo, mat, max);
        m.frustumCulled = false; m.castShadow = isNear; m.receiveShadow = isNear;
        if (depthMat) m.customDepthMaterial = depthMat;
        if (!im) { im = m.instanceMatrix; im.setUsage(THREE.DynamicDrawUsage); ic = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3); ic.setUsage(THREE.DynamicDrawUsage); }
        else m.instanceMatrix = im;
        if (colored) m.instanceColor = ic;
        m.count = 0; scene.add(m);
        (isNear ? this.near : this.far).push(m);
      }
    };
    makeSet(parts.near, true); makeSet(parts.far, false);
  }
  add(matrix, color, x, z) {
    if (this.n >= this.max) return;
    matrix.toArray(this.mats, this.n * 16); color.toArray(this.cols, this.n * 3);
    this.xz[this.n * 2] = x; this.xz[this.n * 2 + 1] = z; this.n++;
  }
  update(px, pz, R2) {
    const nm = this.near[0].instanceMatrix.array, nc = this.near.find(m => m.instanceColor)?.instanceColor;
    const fm = this.far[0].instanceMatrix.array, fc = this.far.find(m => m.instanceColor)?.instanceColor;
    let ni = 0, fi = 0;
    for (let i = 0; i < this.n; i++) {
      const dx = this.xz[i * 2] - px, dz = this.xz[i * 2 + 1] - pz;
      const m = this.mats.subarray(i * 16, i * 16 + 16), c = this.cols.subarray(i * 3, i * 3 + 3);
      if (dx * dx + dz * dz < R2) { nm.set(m, ni * 16); if (nc) nc.array.set(c, ni * 3); ni++; }
      else { fm.set(m, fi * 16); if (fc) fc.array.set(c, fi * 3); fi++; }
    }
    for (const m of this.near) m.count = ni;
    for (const m of this.far) m.count = fi;
    this.near[0].instanceMatrix.needsUpdate = true; this.far[0].instanceMatrix.needsUpdate = true;
    if (nc) nc.needsUpdate = true; if (fc) fc.needsUpdate = true;
  }
}

export const PAL = {
  scarlet: ['#b3241a', '#c8341c', '#a01c16', '#d0451f'],
  orange: ['#e0721d', '#ec8a22', '#d55f18', '#f09a30'],
  gold: ['#e6ae22', '#f0c53c', '#d9981a', '#e8bb30'],
  russet: ['#8c4a1f', '#7c3e1c', '#9d5a26'],
  late: ['#a3a535', '#8a9a30', '#b8a332'],
  ever: ['#2d4a2b', '#24402b', '#38542f', '#2a4636'],
};
function foliageColor(rng, x, z) {
  const region = N(x * 0.012 + 40, z * 0.012 - 20);
  const r = rng() + region * 0.35;
  const set = r < 0.22 ? PAL.scarlet : r < 0.5 ? PAL.orange : r < 0.78 ? PAL.gold : r < 0.92 ? PAL.russet : PAL.late;
  return new THREE.Color(pick(rng, set));
}
export const nearFarm = (x, z, pad = 0) => Math.hypot(x - farm.x, z - farm.z) < 18 + pad || Math.hypot(x - farm.penX, z - farm.penZ) < farm.penR + 4 + pad;

const trees = [];
let grassMesh = null, grassFull = 0;
export function setGrassDensity(f) { if (grassMesh) grassMesh.count = Math.floor(grassFull * f); }

export function buildFlora(scene) {
  const rng = mulberry32(SEED + 7);
  const barkMat = new THREE.MeshStandardMaterial({ color: '#5b4a3f', roughness: 0.95 });
  const birchBark = new THREE.MeshStandardMaterial({ color: '#8a8478', roughness: 0.9 });
  const leafy = (key, base) => {
    const m = windPatch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, map: LEAF_TEX, alphaTest: 0.42, side: THREE.DoubleSide }), key, base, key === 'crownB' ? 0.01 : 0.012, 0.07, true);
    return m;
  };
  const leafDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: LEAF_TEX, alphaTest: 0.42, side: THREE.DoubleSide });
  const crownMat = leafy('crownA', 6.0), crownMatB = leafy('crownB', 8.0);
  const crownFarMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, map: LEAF_TEX });
  const everMat = windPatch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), 'ever', 3.0, 0.006, 0.02, true);

  const maple = new Species(scene, {
    near: [[crown(rng, [[0, 8.6, 0, 3.4], [2.1, 7.8, 0.6, 2.4], [-1.9, 8.0, -0.8, 2.5], [0.4, 10.6, -0.5, 2.4], [-0.6, 7.6, 2.0, 2.2], [0.8, 7.9, -2.1, 2.2]], 1, 2.1), crownMat, true, leafDepth],
           [trunkGeo(7.5, 0.42, 0.24, 7, [[5.2, 0.4, 2.2], [5.8, 2.6, 2.0], [6.3, 4.4, 1.8]]), barkMat, false]],
    far: [[crown(rng, [[0, 8.6, 0, 3.6], [1.6, 8.0, 0.4, 2.6], [-1.5, 8.2, -0.6, 2.6]], 0, 0), crownFarMat, true],
          [new THREE.CylinderGeometry(0.24, 0.42, 7, 4).translate(0, 3.5, 0), barkMat, false]],
  }, 11000);
  const poplar = new Species(scene, {
    near: [[crown(rng, [[0, 10.5, 0, 2.6], [0.5, 12.8, 0.3, 2.4], [-0.6, 14.8, -0.3, 1.9], [1.5, 10.2, -0.9, 2.0], [-1.4, 11.0, 1.0, 2.1], [0.1, 16.4, 0.2, 1.3]], 1, 2.3), crownMatB, true, leafDepth],
           [trunkGeo(11, 0.36, 0.2, 7, [[8.2, 1.1, 1.6], [9.0, 3.6, 1.5]]), birchBark, false]],
    far: [[crown(rng, [[0, 11, 0, 2.8], [0, 14, 0, 2.2]], 0, 0), crownFarMat, true],
          [new THREE.CylinderGeometry(0.2, 0.36, 10, 4).translate(0, 5, 0), birchBark, false]],
  }, 6000);
  const hemlock = new Species(scene, {
    near: [[coneTree(rng, 5, 10), everMat, true], [new THREE.CylinderGeometry(0.2, 0.34, 4, 6).translate(0, 2, 0), barkMat, false]],
    far: [[coneTree(rng, 2, 6), crownFarMat, true]],
  }, 5000);
  trees.push(maple, poplar, hemlock);

  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
  for (let i = 0; i < 90000; i++) {
    const x = (rng() * 2 - 1) * (HALF - 8), z = (rng() * 2 - 1) * (HALF - 8);
    const h = getH(x, z);
    if (h < WATER + 1.2 || isWet(x, z, 1.5) || riverDistAt(x, z) < 3) continue;
    const sl = slopeAt(x, z); if (sl > 1.15) continue;
    const fd = forestDensity(x, z);
    if (rng() > fd * 0.95 + 0.03) continue;
    if (Math.hypot(x - spawn.x, z - spawn.z) < 30 || nearFarm(x, z, 6)) continue;
    const nearWater = Math.max(smooth(14, 2, h - WATER), smooth(25, 5, riverDistAt(x, z)));
    const highUp = smooth(120, 190, h);
    const evergreen = rng() < 0.1 + 0.4 * nearWater + 0.25 * highUp + 0.2 * smooth(0.6, 1.0, sl);
    const sc = 0.8 + rng() * 0.75;
    e.set((rng() - 0.5) * 0.08, rng() * Math.PI * 2, (rng() - 0.5) * 0.08); q.setFromEuler(e);
    const sxz = 0.85 + rng() * 0.3;
    s.set(sc * sxz, sc * (0.9 + rng() * 0.2), sc * sxz);
    mtx.compose(p.set(x, h - 0.25, z), q, s);
    if (evergreen) hemlock.add(mtx, new THREE.Color(pick(rng, PAL.ever)), x, z);
    else if (rng() < 0.33) poplar.add(mtx, foliageColor(rng, x + 99, z), x, z);
    else maple.add(mtx, foliageColor(rng, x, z), x, z);
  }

  // mossy boulders, thicker along the river and on steep ground
  const rockGeo = (() => {
    const g = new THREE.IcosahedronGeometry(1, 3); const pp = g.attributes.position, cols = new Float32Array(pp.count * 3);
    for (let i = 0; i < pp.count; i++) {
      const x = pp.getX(i), y = pp.getY(i), z = pp.getZ(i);
      const k = 1 + 0.28 * N(x * 1.4, z * 1.4 + y) + 0.1 * N(x * 4, y * 4 - z) + 0.04 * N(x * 9, z * 9 + y * 3);
      pp.setXYZ(i, x * k * 1.2, y * k * 0.7, z * k);
      const moss = smooth(0.2, 0.8, y + 0.15 * N(x * 3, z * 3));
      cols[i * 3] = lerp(0.5, 0.32, moss); cols[i * 3 + 1] = lerp(0.48, 0.4, moss); cols[i * 3 + 2] = lerp(0.44, 0.18, moss);
    }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3)); g.deleteAttribute('uv'); g.deleteAttribute('normal');
    const m = mergeVertices(g); m.computeVertexNormals(); return m;
  })();
  const rocks = new THREE.InstancedMesh(rockGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88 }), 2200);
  let rc = 0;
  for (let i = 0; i < 60000 && rc < 2200; i++) {
    const x = (rng() * 2 - 1) * (HALF - 5), z = (rng() * 2 - 1) * (HALF - 5);
    const h = getH(x, z); if (h < WATER - 1 || nearFarm(x, z)) continue;
    const sl = slopeAt(x, z), rd = riverDistAt(x, z);
    if (rng() > 0.02 + 0.5 * smooth(0.5, 1.1, sl) + 0.2 * smooth(3, 0, Math.abs(h - WATER)) + 0.35 * smooth(6, 0, Math.abs(rd))) continue;
    const sc = 0.35 + Math.pow(rng(), 2.5) * 2.6;
    e.set(rng() * 0.4, rng() * 6.28, rng() * 0.4); q.setFromEuler(e);
    mtx.compose(p.set(x, h - sc * 0.25, z), q, s.set(sc, sc, sc));
    rocks.setMatrixAt(rc++, mtx);
  }
  rocks.count = rc; rocks.castShadow = rocks.receiveShadow = true; rocks.frustumCulled = false;
  scene.add(rocks);

  // bushes: sumac, blueberry, mountain laurel
  const bushGeo = crown(rng, [[0, 0.5, 0, 0.75], [0.6, 0.4, 0.2, 0.55], [-0.5, 0.45, -0.3, 0.6], [0.1, 0.8, 0.4, 0.5]], 1, 3.5);
  const bushes = new THREE.InstancedMesh(bushGeo, windPatch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, map: LEAF_TEX, alphaTest: 0.42, side: THREE.DoubleSide }), 'bush', 0.2, 0.03, 0.06, false), 4500);
  const bushPal = ['#b0201c', '#c42e1e', '#8e1a22', '#d4581e', '#7a2a1a', '#3c4a26', '#a8862a'];
  let bc = 0; const bcol = new THREE.Color();
  for (let i = 0; i < 70000 && bc < 4500; i++) {
    const x = (rng() * 2 - 1) * (HALF - 5), z = (rng() * 2 - 1) * (HALF - 5);
    const h = getH(x, z); if (h < WATER + 0.8 || isWet(x, z, 0.8) || slopeAt(x, z) > 0.9 || nearFarm(x, z)) continue;
    const fd = forestDensity(x, z);
    if (rng() > 0.15 + 0.85 * smooth(0.05, 0.4, fd) * smooth(0.95, 0.5, fd)) continue;
    if (Math.hypot(x - spawn.x, z - spawn.z) < 12) continue;
    const sc = 0.7 + rng() * 1.1;
    e.set(0, rng() * 6.28, 0); q.setFromEuler(e);
    mtx.compose(p.set(x, h - 0.15, z), q, s.set(sc, sc * (0.7 + rng() * 0.5), sc));
    bushes.setMatrixAt(bc, mtx); bushes.setColorAt(bc, bcol.set(pick(rng, bushPal))); bc++;
  }
  bushes.count = bc; bushes.frustumCulled = false; bushes.receiveShadow = true;
  scene.add(bushes);

  // ferns going bronze along the river and in shade
  const fernGeo = (() => {
    const pos = [], col = [], nor = [];
    for (let f = 0; f < 7; f++) {
      const a = f / 7 * 6.28 + rng() * 0.4, L = 0.55 + rng() * 0.35;
      const dx = Math.cos(a), dz = Math.sin(a);
      for (let k = 0; k < 6; k++) {
        const t0 = k / 6, t1 = (k + 1) / 6, w0 = 0.09 * Math.sin(Math.PI * (t0 * 0.9 + 0.1)), w1 = 0.09 * Math.sin(Math.PI * (t1 * 0.9 + 0.1));
        const y0 = Math.sin(t0 * 1.9) * 0.42, y1 = Math.sin(t1 * 1.9) * 0.42;
        const A = [dx * L * t0 - dz * w0, y0, dz * L * t0 + dx * w0], B = [dx * L * t0 + dz * w0, y0, dz * L * t0 - dx * w0];
        const C = [dx * L * t1 - dz * w1, y1, dz * L * t1 + dx * w1], D = [dx * L * t1 + dz * w1, y1, dz * L * t1 - dx * w1];
        for (const v of [A, B, C, B, D, C]) { pos.push(...v); const sh = 0.5 + 0.5 * (v[1] / 0.42); col.push(sh, sh, sh); nor.push(0, 1, 0); }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return g;
  })();
  const ferns = new THREE.InstancedMesh(fernGeo, windPatch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }), 'fern', 0.0, 0.08, 0.04, false), 9000);
  const fernPal = ['#9a6a2a', '#7e7a32', '#a8782e', '#6a6e2c', '#b08a3a'];
  let fc = 0;
  for (let i = 0; i < 120000 && fc < 9000; i++) {
    const x = (rng() * 2 - 1) * (HALF - 5), z = (rng() * 2 - 1) * (HALF - 5);
    const h = getH(x, z); if (isWet(x, z, 0.4) || slopeAt(x, z) > 0.95 || nearFarm(x, z)) continue;
    const fd = forestDensity(x, z), rd = riverDistAt(x, z);
    if (rng() > 0.6 * smooth(0.4, 0.9, fd) + 0.6 * smooth(14, 2, rd)) continue;
    const sc = 0.7 + rng() * 0.8;
    e.set(0, rng() * 6.28, 0); q.setFromEuler(e);
    mtx.compose(p.set(x, h - 0.05, z), q, s.set(sc, sc, sc));
    ferns.setMatrixAt(fc, mtx); ferns.setColorAt(fc, bcol.set(pick(rng, fernPal))); fc++;
  }
  ferns.count = fc; ferns.frustumCulled = false; ferns.receiveShadow = true;
  scene.add(ferns);

  // tall meadow grass
  const grassGeo = (() => {
    const pos = [], col = [], nor = [];
    for (let b = 0; b < 11; b++) {
      const a = (b / 11) * Math.PI * 2 + rng() * 0.6, lean = 0.15 + rng() * 0.25, hgt = 0.5 + rng() * 0.6, w = 0.04;
      const ox = Math.cos(a) * 0.09, oz = Math.sin(a) * 0.09, tx = Math.cos(a) * lean, tz = Math.sin(a) * lean;
      const px = -Math.sin(a) * w, pz = Math.cos(a) * w;
      const mid = [ox + tx * 0.4, hgt * 0.55, oz + tz * 0.4];
      const v = [[ox - px, 0, oz - pz], [ox + px, 0, oz + pz], [mid[0] - px * 0.7, mid[1], mid[2] - pz * 0.7], [mid[0] + px * 0.7, mid[1], mid[2] + pz * 0.7], [ox + tx, hgt, oz + tz]];
      for (const t of [[0, 1, 2], [1, 3, 2], [2, 3, 4]]) for (const k of t) { pos.push(...v[k]); const sh = 0.45 + 0.55 * (v[k][1] / hgt); col.push(sh, sh, sh); nor.push(0, 1, 0); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return g;
  })();
  const grassMat = windPatch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }), 'grass', 0.0, 0.11, 0.05, false);
  const GMAX = 70000;
  const grass = new THREE.InstancedMesh(grassGeo, grassMat, GMAX);
  const grassPal = ['#c2a556', '#b39446', '#a39a4c', '#d2b46a', '#8e8a42', '#b88a48'];
  let gc = 0;
  for (let i = 0; i < 420000 && gc < GMAX; i++) {
    let x, z;
    if (i < 6000) { const a = rng() * 6.28, r = Math.sqrt(rng()) * 34; x = spawn.x + Math.cos(a) * r; z = spawn.z + Math.sin(a) * r; }
    else if (i < 14000) { const a = rng() * 6.28, r = Math.sqrt(rng()) * 70; x = farm.x + Math.cos(a) * r; z = farm.z + Math.sin(a) * r; }
    else { x = (rng() * 2 - 1) * (HALF - 5); z = (rng() * 2 - 1) * (HALF - 5); }
    const h = getH(x, z); if (h < WATER + 0.4 || isWet(x, z, 0.3) || slopeAt(x, z) > 0.75) continue;
    if (Math.hypot(x - farm.x, z - farm.z) < 9) continue;
    const fd = forestDensity(x, z);
    if (i >= 14000 && rng() > 0.9 * (1 - smooth(0.1, 0.55, fd))) continue;
    const sc = 0.55 + rng() * 0.6;
    e.set(0, rng() * 6.28, 0); q.setFromEuler(e);
    mtx.compose(p.set(x, h - 0.05, z), q, s.set(sc, sc * (0.65 + rng() * 0.45), sc));
    grass.setMatrixAt(gc, mtx); grass.setColorAt(gc, bcol.set(pick(rng, grassPal))); gc++;
  }
  grass.count = grassFull = gc; grass.frustumCulled = false; grass.receiveShadow = true;
  grassMesh = grass;
  scene.add(grass);

  buildLeaves(scene); buildMotes(scene); buildMist(scene);
}

const lodAt = new THREE.Vector2(1e9, 1e9);
export function updateLOD(px, pz, force) {
  if (!force && Math.hypot(px - lodAt.x, pz - lodAt.y) < 12) return;
  lodAt.set(px, pz);
  for (const t of trees) t.update(px, pz, 150 * 150);
}

// ---------------------------------------------------------------- falling leaves
const LEAF_N = 800;
let leaves; const leafState = []; const dummy = new THREE.Object3D();
function buildLeaves(scene) {
  const shape = new THREE.Shape();
  [[0, -0.5], [0.22, -0.25], [0.42, -0.05], [0.25, 0.05], [0.33, 0.3], [0.12, 0.25], [0, 0.55], [-0.12, 0.25], [-0.33, 0.3], [-0.25, 0.05], [-0.42, -0.05], [-0.22, -0.25]]
    .forEach(([x, y], i) => i ? shape.lineTo(x, y) : shape.moveTo(x, y));
  leaves = new THREE.InstancedMesh(new THREE.ShapeGeometry(shape).scale(0.16, 0.16, 0.16), new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.7 }), LEAF_N);
  leaves.frustumCulled = false;
  const r = mulberry32(99); const c = new THREE.Color();
  const all = [...PAL.scarlet, ...PAL.orange, ...PAL.gold, ...PAL.russet];
  for (let i = 0; i < LEAF_N; i++) {
    leafState.push({ x: 0, y: -999, z: 0, ph: r() * 10, sp: 0.6 + r() * 0.7, ax: r() * 3, ay: r() * 3, az: r() * 3, drift: r() * 6.28 });
    leaves.setColorAt(i, c.set(pick(r, all)));
  }
  scene.add(leaves);
}
function respawnLeaf(L, px, py, pz, anywhere) {
  const a = Math.random() * 6.28, r = 4 + Math.random() * 42;
  L.x = px + Math.cos(a) * r; L.z = pz + Math.sin(a) * r;
  const g = getH(L.x, L.z);
  L.y = anywhere ? g + Math.random() * 18 : Math.max(g + 10 + Math.random() * 10, py + 4 + Math.random() * 8);
}
export function updateLeaves(dt, t, px, py, pz) {
  const windX = Math.sin(t * 0.13) * 0.8 + 0.6, windZ = Math.cos(t * 0.09) * 0.5;
  const swirl = 1 + S.dream * 1.5;
  for (let i = 0; i < LEAF_N; i++) {
    const L = leafState[i];
    if (L.y < -900) respawnLeaf(L, px, py, pz, true);
    L.y -= L.sp * dt * (1 - S.dream * 0.4);
    L.x += (windX + Math.sin(t * 1.3 + L.ph) * 0.9 * swirl) * dt;
    L.z += (windZ + Math.cos(t * 1.1 + L.ph) * 0.9 * swirl) * dt;
    const dx = L.x - px, dz = L.z - pz;
    if (L.y < getH(L.x, L.z) + 0.05 || L.y < waterLevelAt(L.x, L.z) || dx * dx + dz * dz > 2500) respawnLeaf(L, px, py, pz, false);
    dummy.position.set(L.x, L.y, L.z);
    dummy.rotation.set(t * L.ax + L.ph, t * L.ay, t * L.az * 0.5 + L.drift);
    dummy.updateMatrix(); leaves.setMatrixAt(i, dummy.matrix);
  }
  leaves.instanceMatrix.needsUpdate = true;
}

// ---------------------------------------------------------------- fireflies at night, drifting golden motes by day, rainbow motes in dreams
const MOTE_N = 360;
let motes, moteGeo, motePos, moteCol; const moteData = [];
const tmpC = new THREE.Color();
function buildMotes(scene) {
  moteGeo = new THREE.BufferGeometry();
  motePos = new Float32Array(MOTE_N * 3); moteCol = new Float32Array(MOTE_N * 3);
  moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
  moteGeo.setAttribute('color', new THREE.BufferAttribute(moteCol, 3));
  for (let i = 0; i < MOTE_N; i++) moteData.push({ x: 0, y: -999, z: 0, ph: Math.random() * 20, s: 0.3 + Math.random() * 0.8 });
  motes = new THREE.Points(moteGeo, new THREE.PointsMaterial({ size: 0.36, map: GLOW, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  motes.frustumCulled = false; scene.add(motes);
}
export function updateMotes(dt, t, px, py, pz) {
  const D = S.dream, night = S.nightF;
  const day = 0.18 * S.dayF * (1 - night);
  for (let i = 0; i < MOTE_N; i++) {
    const m = moteData[i];
    const dx = m.x - px, dz = m.z - pz;
    if (m.y < -900 || dx * dx + dz * dz > 1600) { const a = Math.random() * 6.28, r = 3 + Math.random() * 36; m.x = px + Math.cos(a) * r; m.z = pz + Math.sin(a) * r; m.y = getH(m.x, m.z) + 0.4 + Math.random() * 4; }
    m.x += Math.sin(t * 0.4 * m.s + m.ph) * dt * 0.6; m.z += Math.cos(t * 0.33 * m.s + m.ph * 1.3) * dt * 0.6;
    m.y += Math.sin(t * 0.7 + m.ph) * dt * 0.25;
    motePos[i * 3] = m.x; motePos[i * 3 + 1] = m.y; motePos[i * 3 + 2] = m.z;
    const blink = Math.pow(Math.max(0, Math.sin(t * (0.8 + m.s) + m.ph)), 3);
    const isFly = i % 2 === 0;
    let r, g, b;
    if (night > 0.05 && isFly) { tmpC.setHSL(0.17, 0.9, 0.55); const k = blink * night * 2; r = tmpC.r * k; g = tmpC.g * k; b = tmpC.b * k; }
    else { tmpC.setHSL(0.1, 0.6, 0.7); const k = (0.4 + 0.6 * blink) * day; r = tmpC.r * k; g = tmpC.g * k; b = tmpC.b * k; }
    if (D > 0.02) { tmpC.setHSL((m.ph * 0.05 + t * 0.03) % 1, 0.9, 0.6); const k = D * 0.9 * (0.3 + 0.7 * blink); r += tmpC.r * k; g += tmpC.g * k; b += tmpC.b * k; }
    moteCol[i * 3] = r; moteCol[i * 3 + 1] = g; moteCol[i * 3 + 2] = b;
  }
  moteGeo.attributes.position.needsUpdate = true; moteGeo.attributes.color.needsUpdate = true;
}

// ---------------------------------------------------------------- mist banks drifting over low ground
const mists = [];
function buildMist(scene) {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  const geo = new THREE.PlaneGeometry(1, 1);
  const rng = mulberry32(SEED + 21);
  let tries = 0;
  while (mists.length < 34 && tries++ < 4000) {
    const x = (rng() * 2 - 1) * 470, z = (rng() * 2 - 1) * 470;
    const h = getH(x, z), wl = waterLevelAt(x, z);
    const low = Math.max(h, wl);
    if (low > WATER + 22) continue;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.5, color: 0xffffff });
    const m = new THREE.Mesh(geo, mat);
    const size = 120 + rng() * 140;
    m.scale.set(size, size * 0.22, 1);
    m.userData = { x, z, y: low + 1 + rng() * 4, ph: rng() * 6.28, sp: 0.4 + rng() * 0.8 };
    m.renderOrder = 4;
    scene.add(m); mists.push(m);
  }
}
export function updateMist(t, camera, fogColor) {
  // thickest around dawn and dusk, thinner midday, present at night
  const tod = S.timeOfDay;
  const morning = Math.exp(-((tod - 7) ** 2) / 3), evening = Math.exp(-((tod - 19) ** 2) / 4);
  const amount = 0.25 + 0.75 * Math.max(morning, evening) + S.dream * 0.3;
  for (const m of mists) {
    const u = m.userData;
    m.position.set(u.x + Math.sin(t * 0.01 * u.sp + u.ph) * 25, u.y + Math.sin(t * 0.05 + u.ph) * 1.5, u.z + Math.cos(t * 0.008 * u.sp + u.ph) * 25);
    m.quaternion.copy(camera.quaternion);
    const d = m.position.distanceTo(camera.position);
    m.material.opacity = amount * 0.16 * smooth(40, 120, d) * smooth(700, 300, d);
    m.material.color.copy(fogColor).multiplyScalar(1.15);
  }
}
