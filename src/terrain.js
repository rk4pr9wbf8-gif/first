// Quadtree-LOD terrain. Leaves are 32x32 grids; small leaves near the
// camera (2 m spacing) and huge ones on the horizon (256 m spacing), so
// you can see volcanoes 15 km away. Skirts hide cracks between levels.
import * as THREE from 'three';
import { biomeAt, forestDensity, deciduousFraction, foliageHue } from './world.js';
import { INFL } from './road.js';

const ROOT = 8192;
const MIN_SIZE = 64;
const N = 32;
const SPLIT = 1.7;

export function makeTerrainMaterial(tex, uniforms) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms, {
      tGrass: { value: tex.grass }, tLitter: { value: tex.litter }, tRock: { value: tex.rock },
      tSnow: { value: tex.snow }, tGravel: { value: tex.gravel }, tNoise: { value: tex.noise },
    });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aData; attribute float aRoad;
        varying vec4 vData; varying float vRoad; varying vec3 vWPos; varying vec3 vWNrm;`)
      .replace('#include <fog_vertex>', `#include <fog_vertex>
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWNrm = normalize(mat3(modelMatrix) * objectNormal);
        vData = aData; vRoad = aRoad;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D tGrass, tLitter, tRock, tSnow, tGravel, tNoise;
        uniform float uTreeDist;
        varying vec4 vData; varying float vRoad; varying vec3 vWPos; varying vec3 vWNrm;
        float tRough;
        vec3 triRock(vec3 p, vec3 n, float s) {
          vec3 w = pow(abs(n), vec3(4.0)); w /= (w.x + w.y + w.z);
          return texture2D(tRock, p.zy * s).rgb * w.x + texture2D(tRock, p.xz * s).rgb * w.y + texture2D(tRock, p.xy * s).rgb * w.z;
        }`)
      .replace('#include <map_fragment>', `
        vec3 N = normalize(vWNrm);
        float slope = 1.0 - N.y;
        vec2 wp = vWPos.xz;
        float dist = length(vWPos - cameraPosition);
        vec4 nz = texture2D(tNoise, wp * 0.0019);
        vec4 nzs = texture2D(tNoise, wp * 0.021);
        float biome = vData.x, forest = vData.y, decid = vData.z, hue = vData.w;
        float far = smoothstep(25.0, 260.0, dist);
        vec3 grass = mix(texture2D(tGrass, wp * 0.22).rgb, texture2D(tGrass, wp * 0.027).rgb, 0.25 + far * 0.6);
        float tundra = biome * smoothstep(350.0, 850.0, vWPos.y) * smoothstep(0.35, 0.7, nz.g);
        grass = mix(grass, grass * vec3(1.55, 0.72, 0.5), tundra);
        grass *= mix(vec3(1.0), vec3(0.92, 1.0, 0.85), (1.0 - biome) * nz.b);
        vec3 litter = mix(texture2D(tLitter, wp * 0.28).rgb, texture2D(tLitter, wp * 0.04).rgb, 0.2 + far * 0.6);
        vec3 ground = mix(grass, litter, smoothstep(0.22, 0.6, forest + (nzs.b - 0.5) * 0.5));
        // far forest canopy painted onto the ground, mottled per crown
        float cf = smoothstep(uTreeDist * 0.5, uTreeDist * 0.92, dist) * smoothstep(0.05, 0.25, forest);
        vec4 cn = texture2D(tNoise, wp * 0.0042);
        vec4 cn2 = texture2D(tNoise, wp * 0.0011);
        vec3 conifer = mix(vec3(0.030, 0.052, 0.034), vec3(0.055, 0.082, 0.045), cn.r) * mix(vec3(1.0), vec3(0.9, 0.98, 1.08), biome);
        vec3 red = mix(vec3(0.42, 0.05, 0.03), vec3(0.62, 0.18, 0.03), cn.g);
        vec3 gold = mix(vec3(0.72, 0.42, 0.05), vec3(0.62, 0.52, 0.10), cn.g);
        float isDec = smoothstep(1.0 - decid - 0.08, 1.0 - decid + 0.08, cn.b * 0.7 + cn.a * 0.3 + (cn2.g - 0.5) * 0.3);
        vec3 canopy = mix(conifer, mix(red, gold, clamp(hue + (cn.r - 0.5) * 0.8, 0.0, 1.0)) * 0.7, isDec) * (0.6 + 0.7 * cn.a);
        ground = mix(ground, canopy, cf * 0.95);
        float rockW = smoothstep(0.38, 0.56, slope + (nzs.r - 0.5) * 0.22 - cf * 0.08);
        vec3 rockC = triRock(vWPos, N, 0.07) * mix(0.75, 1.1, nz.a);
        rockC = mix(rockC, triRock(vWPos, N, 0.011), far * 0.6);
        vec3 col = mix(ground, rockC, rockW);
        float shoulder = 1.0 - smoothstep(6.2, 9.5, vRoad + (nzs.g - 0.5) * 3.0);
        col = mix(col, texture2D(tGravel, wp * 0.45).rgb, shoulder * 0.92);
        float sl = mix(1900.0, 1050.0, biome) + (nz.r - 0.5) * 360.0;
        float snowW = smoothstep(sl - 70.0, sl + 70.0, vWPos.y) * (1.0 - smoothstep(0.5, 0.78, slope - clamp((vWPos.y - sl) * 0.00025, 0.0, 0.25)));
        col = mix(col, texture2D(tSnow, wp * 0.08).rgb, snowW);
        float shore = 1.0 - smoothstep(0.3, 2.6, vWPos.y + (nzs.r - 0.5) * 1.5);
        col = mix(col, texture2D(tGravel, wp * 0.3).rgb * vec3(0.75, 0.72, 0.66), shore);
        col *= mix(1.0, 0.35, 1.0 - smoothstep(-8.0, 0.0, vWPos.y));
        col *= 0.8 + 0.38 * nz.r;
        diffuseColor.rgb = col;
        tRough = mix(0.93, 0.62, snowW);
        tRough = mix(tRough, 0.35, shore);
      `)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = tRough;`);
  };
  mat.customProgramCacheKey = () => 'terrain-v1';
  return mat;
}

class Leaf {
  constructor(x0, z0, size, key) {
    this.x0 = x0; this.z0 = z0; this.size = size; this.key = key;
    this.mesh = null; this.stale = false; this.lastUsed = 0;
  }
}

export class Terrain {
  constructor(scene, ground, material) {
    this.scene = scene; this.ground = ground; this.material = material;
    this.cache = new Map();
    this.visible = new Set();
    this.desired = [];
    this.viewRadius = 15000;
    this.frame = 0;
    this.group = new THREE.Group();
    scene.add(this.group);
  }

  _collect(cx, cz) {
    const out = [];
    const r = this.viewRadius;
    const visit = (x0, z0, size) => {
      const dx = Math.max(x0 - cx, 0, cx - (x0 + size));
      const dz = Math.max(z0 - cz, 0, cz - (z0 + size));
      const d = Math.hypot(dx, dz);
      if (d > r) return;
      if (size > MIN_SIZE && d < size * SPLIT) {
        const h = size / 2;
        visit(x0, z0, h); visit(x0 + h, z0, h); visit(x0, z0 + h, h); visit(x0 + h, z0 + h, h);
      } else out.push([x0, z0, size, d]);
    };
    const i0 = Math.floor((cx - r) / ROOT), i1 = Math.floor((cx + r) / ROOT);
    const j0 = Math.floor((cz - r) / ROOT), j1 = Math.floor((cz + r) / ROOT);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) visit(i * ROOT, j * ROOT, ROOT);
    return out;
  }

  invalidate(minX, minZ, maxX, maxZ) {
    minX -= INFL; minZ -= INFL; maxX += INFL; maxZ += INFL;
    for (const leaf of this.cache.values()) {
      if (leaf.x0 > maxX || leaf.x0 + leaf.size < minX || leaf.z0 > maxZ || leaf.z0 + leaf.size < minZ) continue;
      leaf.stale = true;
    }
  }

  // returns number of leaves still pending
  update(cx, cz, budgetMs) {
    this.frame++;
    const list = this._collect(cx, cz);
    list.sort((a, b) => a[3] - b[3]);
    const t0 = performance.now();
    let pending = 0;
    const want = [];
    for (const [x0, z0, size] of list) {
      const key = x0 + ':' + z0 + ':' + size;
      let leaf = this.cache.get(key);
      if (!leaf) { leaf = new Leaf(x0, z0, size, key); this.cache.set(key, leaf); }
      leaf.lastUsed = this.frame;
      if (!leaf.mesh || leaf.stale) {
        if (performance.now() - t0 < budgetMs) this._build(leaf);
        else pending++;
      }
      want.push(leaf);
    }
    // swap in the new set only when it is complete, so there are never holes
    const missing = want.some(l => !l.mesh);
    if (!missing) {
      const next = new Set(want);
      for (const l of this.visible) if (!next.has(l) && l.mesh) l.mesh.visible = false;
      for (const l of next) l.mesh.visible = true;
      this.visible = next;
    }
    // evict
    if (this.cache.size > 900) {
      for (const [k, l] of this.cache) {
        if (this.frame - l.lastUsed > 120 && !this.visible.has(l)) {
          if (l.mesh) { this.group.remove(l.mesh); l.mesh.geometry.dispose(); }
          this.cache.delete(k);
        }
      }
    }
    return pending;
  }

  _build(leaf) {
    const { x0, z0, size } = leaf;
    const s = size / N;
    const G = N + 3;
    const th = this.ground.terrainHeight, info = this.ground.info;
    const H = new Float32Array(G * G);
    const nv = (N + 1) * (N + 1);
    const hole = new Uint8Array(nv);
    const road = new Float32Array(nv);
    const wantHole = size <= 128;
    for (let j = 0; j < G; j++) {
      for (let i = 0; i < G; i++) {
        const x = x0 + (i - 1) * s, z = z0 + (j - 1) * s;
        const inner = i >= 1 && i <= N + 1 && j >= 1 && j <= N + 1;
        H[j * G + i] = th(x, z, wantHole && inner);
        if (inner) {
          const v = (j - 1) * (N + 1) + (i - 1);
          hole[v] = info.hole ? 1 : 0;
          road[v] = Math.min(info.roadD, 60);
        }
      }
    }
    const skirtN = 4 * (N + 1);
    const total = nv + skirtN;
    const pos = new Float32Array(total * 3);
    const nrm = new Float32Array(total * 3);
    const data = new Float32Array(total * 4);
    const aRoad = new Float32Array(total);
    const cxm = x0 + size / 2, czm = z0 + size / 2;
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        const v = j * (N + 1) + i;
        const gi = (j + 1) * G + (i + 1);
        const h = H[gi];
        const x = x0 + i * s, z = z0 + j * s;
        pos[v * 3] = x - cxm; pos[v * 3 + 1] = h; pos[v * 3 + 2] = z - czm;
        let nx = H[gi - 1] - H[gi + 1], nz = H[gi - G] - H[gi + G], ny = 2 * s;
        const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
        nrm[v * 3] = nx; nrm[v * 3 + 1] = ny; nrm[v * 3 + 2] = nz;
        const a = biomeAt(x, z);
        data[v * 4] = a;
        data[v * 4 + 1] = forestDensity(x, z, h, 1 - ny, a);
        data[v * 4 + 2] = deciduousFraction(x, z, h, a);
        data[v * 4 + 3] = foliageHue(x, z, a);
        aRoad[v] = road[v];
      }
    }
    // skirts
    const drop = 2 + size * 0.015;
    const edge = [];
    for (let i = 0; i <= N; i++) edge.push(i);                       // top row j=0
    for (let j = 0; j <= N; j++) edge.push(j * (N + 1) + N);           // right col
    for (let i = N; i >= 0; i--) edge.push(N * (N + 1) + i);           // bottom row
    for (let j = N; j >= 0; j--) edge.push(j * (N + 1));               // left col
    edge.forEach((v, k) => {
      const d = nv + k;
      pos[d * 3] = pos[v * 3]; pos[d * 3 + 1] = pos[v * 3 + 1] - drop; pos[d * 3 + 2] = pos[v * 3 + 2];
      nrm[d * 3] = nrm[v * 3]; nrm[d * 3 + 1] = nrm[v * 3 + 1]; nrm[d * 3 + 2] = nrm[v * 3 + 2];
      for (let c = 0; c < 4; c++) data[d * 4 + c] = data[v * 4 + c];
      aRoad[d] = aRoad[v];
    });
    const idx = [];
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
        if (hole[a] || hole[b] || hole[c] || hole[d]) continue;
        // alternate diagonal for nicer shading
        if ((i + j) & 1) { idx.push(a, c, b, b, c, d); } else { idx.push(a, c, d, a, d, b); }
      }
    }
    // skirt quads along each side (side order matches edge list)
    const side = N + 1;
    for (let sIdx = 0; sIdx < 4; sIdx++) {
      for (let k = 0; k < N; k++) {
        const e0 = sIdx * side + k, e1 = e0 + 1;
        const t0 = edge[e0], t1 = edge[e1], b0 = nv + e0, b1 = nv + e1;
        idx.push(t0, t1, b0, t1, b1, b0, t0, b0, t1, t1, b0, b1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute('aData', new THREE.BufferAttribute(data, 4));
    geo.setAttribute('aRoad', new THREE.BufferAttribute(aRoad, 1));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    if (leaf.mesh) { this.group.remove(leaf.mesh); leaf.mesh.geometry.dispose(); }
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.position.set(cxm, 0, czm);
    mesh.receiveShadow = true;
    mesh.castShadow = size <= 256;
    mesh.visible = this.visible.has(leaf);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.group.add(mesh);
    leaf.mesh = mesh; leaf.stale = false;
  }
}
