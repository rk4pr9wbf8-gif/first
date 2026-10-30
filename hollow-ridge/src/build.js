// Player-placed building pieces, the homestead, and collision against both.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, clamp } from './noise.js';
import { getH } from './world.js';
import { farm } from './sites.js';
import { GLOW } from './flora.js';
import { S } from './state.js';
import { sfx } from './audio.js';

function canvasTex(w, h, draw, rep = 1) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.repeat.set(rep, rep); return t;
}
const rnd = mulberry32(5);
function boards(g, w, h, tones, n = 4) {
  const bw = w / n;
  for (let b = 0; b < n; b++) {
    g.fillStyle = `rgb(${tones[b % tones.length]})`; g.fillRect(b * bw, 0, bw, h);
    for (let l = 0; l < 70; l++) {
      const x0 = b * bw + rnd() * bw; g.strokeStyle = `rgba(${rnd() < 0.5 ? '40,30,20' : '255,240,220'},${0.06 + rnd() * 0.1})`;
      g.lineWidth = 0.6 + rnd() * 1.6; g.beginPath();
      for (let y = 0; y <= h; y += 16) g.lineTo(x0 + Math.sin(y * 0.02 + l) * 3, y); g.stroke();
    }
    if (rnd() < 0.8) { const kx = b * bw + bw * (0.3 + rnd() * 0.4), ky = rnd() * h; g.fillStyle = 'rgba(40,25,15,0.5)'; g.beginPath(); g.ellipse(kx, ky, 5, 9, 0, 0, 7); g.fill(); }
    g.fillStyle = 'rgba(20,12,8,0.8)'; g.fillRect(b * bw, 0, 3, h);
    g.fillRect(b * bw, rnd() * h, bw, 2);
  }
}
const texPlank = canvasTex(512, 512, (g, w, h) => boards(g, w, h, ['139,94,60', '150,104,66', '128,86,54', '146,98,58']));
const texPlankV = texPlank.clone(); texPlankV.center.set(0.5, 0.5); texPlankV.rotation = Math.PI / 2; texPlankV.needsUpdate = true;
const texGrey = canvasTex(512, 512, (g, w, h) => boards(g, w, h, ['200,200,200', '215,215,215', '190,190,190', '208,208,208'], 8));
const texBark = canvasTex(256, 512, (g, w, h) => {
  g.fillStyle = '#6a5038'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(${rnd() < 0.6 ? '40,28,18' : '140,110,80'},${0.15 + rnd() * 0.3})`; g.fillRect(rnd() * w, rnd() * h, 2 + rnd() * 5, 30 + rnd() * 120); }
});
const texStone = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#7d7a72'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 900; i++) { const v = 90 + rnd() * 70; g.fillStyle = `rgba(${v},${v - 4},${v - 10},0.35)`; g.beginPath(); g.arc(rnd() * w, rnd() * h, 2 + rnd() * 10, 0, 7); g.fill(); }
  for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(80,100,50,${0.15 + rnd() * 0.2})`; g.beginPath(); g.arc(rnd() * w, rnd() * h * 0.4, 4 + rnd() * 14, 0, 7); g.fill(); }
});
const texShingle = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#3c2a22'; g.fillRect(0, 0, w, h);
  const rows = 8, rh = h / rows;
  for (let r = 0; r < rows; r++) for (let c = -1; c < 7; c++) {
    const x = c * 40 + (r % 2) * 20, v = 70 + rnd() * 40;
    g.fillStyle = `rgb(${v + 20},${v - 5},${v - 20})`; g.fillRect(x + 1, r * rh + 1, 38, rh - 2);
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x + 1, r * rh + rh - 5, 38, 4);
  }
});
const texHay = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#c9a54e'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 1400; i++) { const v = rnd(); g.strokeStyle = v < 0.5 ? 'rgba(120,90,30,0.4)' : 'rgba(245,220,140,0.45)'; g.lineWidth = 1; g.beginPath(); const x = rnd() * w, y = rnd() * h, a = rnd() * 0.6 - 0.3; g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 20, y + Math.sin(a) * 20); g.stroke(); }
});

export const MAT = {
  plank: new THREE.MeshStandardMaterial({ map: texPlank, roughness: 0.82 }),
  plankV: new THREE.MeshStandardMaterial({ map: texPlankV, roughness: 0.82 }),
  bark: new THREE.MeshStandardMaterial({ map: texBark, roughness: 0.92 }),
  stone: new THREE.MeshStandardMaterial({ map: texStone, roughness: 0.9 }),
  shingle: new THREE.MeshStandardMaterial({ map: texShingle, roughness: 0.75 }),
  glass: new THREE.MeshStandardMaterial({ color: '#b8dcea', transparent: true, opacity: 0.22, roughness: 0.04, metalness: 0.2, depthWrite: false }),
  iron: new THREE.MeshStandardMaterial({ color: '#2b2622', roughness: 0.55, metalness: 0.7 }),
  glow: new THREE.MeshStandardMaterial({ color: '#ffd29a', emissive: '#ffa648', emissiveIntensity: 5 }),
  ember: new THREE.MeshStandardMaterial({ color: '#2a170c', emissive: '#ff4e12', emissiveIntensity: 2.2, roughness: 1 }),
  wool: new THREE.MeshStandardMaterial({ color: '#c9b79a', roughness: 1 }),
  hay: new THREE.MeshStandardMaterial({ map: texHay, roughness: 1 }),
  barn: new THREE.MeshStandardMaterial({ map: texGrey, vertexColors: true, roughness: 0.85 }),
  ghostOk: new THREE.MeshBasicMaterial({ color: '#cfe8a0', transparent: true, opacity: 0.38, depthWrite: false }),
  ghostBad: new THREE.MeshBasicMaterial({ color: '#e86a50', transparent: true, opacity: 0.38, depthWrite: false }),
};
const GEO = {
  floor: new RoundedBoxGeometry(2, 0.2, 2, 2, 0.04),
  wall: new RoundedBoxGeometry(2, 2.4, 0.16, 2, 0.03),
  log: new THREE.CylinderGeometry(0.2, 0.2, 2.06, 16, 1).rotateZ(Math.PI / 2),
  post: new THREE.CylinderGeometry(0.14, 0.16, 2.4, 14),
  roof: new RoundedBoxGeometry(2.1, 0.12, 2.9, 2, 0.03).rotateX(-Math.PI / 4).translate(0, 1.04, 0),
  stone: new RoundedBoxGeometry(1, 1, 1, 3, 0.14),
  stairs: (() => { const parts = []; for (let i = 0; i < 4; i++) parts.push(new RoundedBoxGeometry(2, 0.5 * (i + 1), 0.5, 2, 0.03).translate(0, 0.25 * (i + 1), -0.75 + i * 0.5)); return mergeGeometries(parts); })(),
  fence: (() => { const parts = [new THREE.CylinderGeometry(0.07, 0.08, 1.2, 8).translate(-0.95, 0.6, 0), new THREE.CylinderGeometry(0.07, 0.08, 1.2, 8).translate(0.95, 0.6, 0)]; for (const y of [0.45, 0.95]) parts.push(new THREE.CylinderGeometry(0.05, 0.05, 2.0, 8).rotateZ(Math.PI / 2).translate(0, y, 0)); return mergeGeometries(parts); })(),
  frameH: new THREE.BoxGeometry(2, 0.16, 0.18), frameV: new THREE.BoxGeometry(0.16, 2.4, 0.18), pane: new THREE.BoxGeometry(1.7, 2.1, 0.04),
  lanternBody: new THREE.CylinderGeometry(0.12, 0.12, 0.28, 12), lanternCap: new THREE.ConeGeometry(0.17, 0.14, 12), lanternBase: new THREE.CylinderGeometry(0.15, 0.15, 0.04, 12),
  ring: new THREE.IcosahedronGeometry(0.16, 1).scale(1, 0.75, 1), fireLog: new THREE.CylinderGeometry(0.07, 0.08, 1.0, 8).rotateZ(Math.PI / 2),
  bench: (() => mergeGeometries([new RoundedBoxGeometry(1.8, 0.08, 0.45, 2, 0.02).translate(0, 0.45, 0), new RoundedBoxGeometry(0.08, 0.45, 0.4, 2, 0.02).translate(-0.75, 0.22, 0), new RoundedBoxGeometry(0.08, 0.45, 0.4, 2, 0.02).translate(0.75, 0.22, 0), new RoundedBoxGeometry(1.8, 0.35, 0.06, 2, 0.02).translate(0, 0.75, -0.2)]))(),
  rug: new THREE.CylinderGeometry(0.9, 0.9, 0.02, 32),
};
export const DEFS = [
  { id: 'floor', name: 'Floor', size: [2, 0.2, 2], snap: 'tile', swatch: '#8b5e3c', solid: true },
  { id: 'wall', name: 'Wall', size: [2, 2.4, 0.16], snap: 'edge', swatch: '#96683f', solid: true },
  { id: 'log', name: 'Log', size: [2, 0.4, 0.4], snap: 'edge', swatch: '#6a5038', solid: true },
  { id: 'post', name: 'Post', size: [0.32, 2.4, 0.32], snap: 'corner', swatch: '#5c4532', solid: true },
  { id: 'roof', name: 'Roof', size: [2, 2, 2], snap: 'tile', swatch: '#4a332a', ramp: true },
  { id: 'stone', name: 'Stone', size: [1, 1, 1], snap: 'cell', swatch: '#7d7a72', solid: true },
  { id: 'window', name: 'Window', size: [2, 2.4, 0.18], snap: 'edge', swatch: '#a9cbd6', solid: true },
  { id: 'lantern', name: 'Lantern', size: [0.34, 0.5, 0.34], snap: 'free', swatch: '#ffb35a', light: 'lantern' },
  { id: 'campfire', name: 'Campfire', size: [1.2, 0.5, 1.2], snap: 'free', swatch: '#ff5a1e', light: 'fire' },
  { id: 'stairs', name: 'Stairs', size: [2, 2, 2], snap: 'tile', swatch: '#7a5434', ramp: true },
  { id: 'fence', name: 'Fence', size: [2, 1.2, 0.2], snap: 'edge', swatch: '#5e4836', solid: true },
  { id: 'bench', name: 'Bench', size: [1.8, 0.9, 0.5], snap: 'free', swatch: '#9a6c44', solid: true },
  { id: 'rug', name: 'Rug', size: [1.8, 0.02, 1.8], snap: 'free', swatch: '#b0583a' },
];
function meshAt(geo, mat, x, y, z) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; return m; }
const rugMat = new THREE.MeshStandardMaterial({ map: canvasTex(256, 256, (g) => { const cols = ['#a8442e', '#d08a3c', '#5a6a3a', '#e8d8b0', '#7a3a2e']; for (let r = 128; r > 0; r -= 12) { g.fillStyle = cols[(r / 12 | 0) % cols.length]; g.beginPath(); g.arc(128, 128, r, 0, 7); g.fill(); } }), roughness: 1 });
export function makePiece(i, ghost) {
  const g = new THREE.Group(), id = DEFS[i].id;
  if (id === 'floor') g.add(meshAt(GEO.floor, MAT.plank, 0, 0.1, 0));
  else if (id === 'wall') g.add(meshAt(GEO.wall, MAT.plankV, 0, 1.2, 0));
  else if (id === 'log') g.add(meshAt(GEO.log, MAT.bark, 0, 0.2, 0));
  else if (id === 'post') g.add(meshAt(GEO.post, MAT.bark, 0, 1.2, 0));
  else if (id === 'roof') g.add(meshAt(GEO.roof, MAT.shingle, 0, 0, 0));
  else if (id === 'stone') g.add(meshAt(GEO.stone, MAT.stone, 0, 0.5, 0));
  else if (id === 'stairs') g.add(meshAt(GEO.stairs, MAT.plank, 0, 0, 0));
  else if (id === 'fence') g.add(meshAt(GEO.fence, MAT.bark, 0, 0, 0));
  else if (id === 'bench') g.add(meshAt(GEO.bench, MAT.plank, 0, 0, 0));
  else if (id === 'rug') g.add(meshAt(GEO.rug, rugMat, 0, 0.01, 0));
  else if (id === 'window') {
    g.add(meshAt(GEO.frameH, MAT.plank, 0, 0.08, 0), meshAt(GEO.frameH, MAT.plank, 0, 2.32, 0), meshAt(GEO.frameV, MAT.plank, -0.92, 1.2, 0), meshAt(GEO.frameV, MAT.plank, 0.92, 1.2, 0));
    g.add(meshAt(new THREE.BoxGeometry(1.7, 0.08, 0.1), MAT.plank, 0, 1.2, 0), meshAt(new THREE.BoxGeometry(0.08, 2.1, 0.1), MAT.plank, 0, 1.2, 0));
    const pane = meshAt(GEO.pane, MAT.glass, 0, 1.2, 0); pane.castShadow = false; g.add(pane);
  } else if (id === 'lantern') {
    g.add(meshAt(GEO.lanternBase, MAT.iron, 0, 0.02, 0), meshAt(GEO.lanternBody, MAT.glow, 0, 0.18, 0), meshAt(GEO.lanternCap, MAT.iron, 0, 0.39, 0));
  } else if (id === 'campfire') {
    for (let k = 0; k < 9; k++) { const a = k / 9 * Math.PI * 2; g.add(meshAt(GEO.ring, MAT.stone, Math.cos(a) * 0.5, 0.08, Math.sin(a) * 0.5)); }
    for (let k = 0; k < 3; k++) { const l = meshAt(GEO.fireLog, k ? MAT.bark : MAT.ember, 0, 0.12 + k * 0.03, 0); l.rotation.y = k * 1.05; l.rotation.z = 0.2; g.add(l); }
    g.add(meshAt(new THREE.CircleGeometry(0.4, 12).rotateX(-Math.PI / 2), MAT.ember, 0, 0.03, 0));
    if (!ghost) {
      const n = 56, geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.55, map: GLOW, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      pts.frustumCulled = false;
      pts.userData.p = Array.from({ length: n }, () => ({ life: Math.random(), x: 0, y: 0, z: 0, vx: 0, vz: 0, spark: Math.random() < 0.15 }));
      g.add(pts); g.userData.fire = pts;
    }
  }
  if (ghost) g.traverse(o => { if (o.isMesh) { o.material = MAT.ghostOk; o.castShadow = o.receiveShadow = false; o.renderOrder = 5; } });
  return g;
}

export let pieces = [];
export const pieceRoot = new THREE.Group();
export function pieceBox(type, x, y, z, rot) {
  const [sx, sy, sz] = DEFS[type].size, swap = rot % 2 === 1;
  const hx = (swap ? sz : sx) / 2, hz = (swap ? sx : sz) / 2;
  return { minX: x - hx, maxX: x + hx, minY: y, maxY: y + sy, minZ: z - hz, maxZ: z + hz };
}
export function addPiece(type, x, y, z, rot, quiet) {
  const g = makePiece(type, false);
  g.position.set(x, y, z); g.rotation.y = rot * Math.PI / 2;
  pieceRoot.add(g);
  const p = { type, x, y, z, rot, g, ...pieceBox(type, x, y, z, rot), def: DEFS[type] };
  g.traverse(o => { o.userData.piece = p; });
  pieces.push(p);
  if (!quiet) { save(); sfx.place(); }
  return p;
}
export function removePiece(p) {
  pieceRoot.remove(p.g);
  p.g.traverse(o => { if (o.isPoints) o.geometry.dispose(); });
  pieces = pieces.filter(q => q !== p);
  save(); sfx.remove();
}
export function clearPieces() { for (const p of pieces) pieceRoot.remove(p.g); const n = pieces.length; pieces = []; save(); return n; }
const SAVE_KEY = 'hollow-ridge.v1';
let saveTimer = 0;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify({ pieces: pieces.map(p => [p.type, +p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3), p.rot]) })); } catch (e) { /* storage unavailable */ }
  }, 300);
}
export function loadPieces() {
  try { const d = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); if (d && d.pieces) for (const [t, x, y, z, r] of d.pieces) if (DEFS[t]) addPiece(t, x, y, z, r, true); } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------- homestead
// Static colliders are oriented boxes: {x, z, hx, hz, c, s, minY, maxY}
export const statics = [];
function addStatic(x, z, hx, hz, ang, minY, maxY) { statics.push({ x, z, hx, hz, c: Math.cos(ang), s: Math.sin(ang), minY, maxY }); }
function colored(geo, color) {
  geo = geo.index ? geo.toNonIndexed() : geo;
  const n = geo.attributes.position.count, c = new THREE.Color(color), a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  return geo;
}
function slab(w, h, d, x, y, z, color, rx = 0) { const g = new THREE.BoxGeometry(w, h, d); if (rx) g.rotateX(rx); g.translate(x, y, z); return colored(g, color); }
export function buildHomestead(scene) {
  const fx = farm.x, fz = farm.z, ang = farm.ang;
  const base = getH(fx, fz);
  const W = 9, D = 12, H = 4.6, red = '#9e2f22', white = '#efe6d6', roof = '#55575c', dark = '#3a1a14';
  const parts = [];
  // walls (on a stone footing so slopes do not show gaps)
  parts.push(slab(W, H, 0.3, 0, H / 2, D / 2, red), slab(W, H, 0.3, 0, H / 2, -D / 2, red), slab(0.3, H, D, W / 2, H / 2, 0, red), slab(0.3, H, D, -W / 2, H / 2, 0, red));
  // gambrel gable ends
  const gable = new THREE.Shape(); gable.moveTo(-W / 2, 0); gable.lineTo(W / 2, 0); gable.lineTo(W / 2 - 1.2, 2.2); gable.lineTo(0, 3.6); gable.lineTo(-W / 2 + 1.2, 2.2); gable.lineTo(-W / 2, 0);
  for (const zz of [D / 2, -D / 2]) { const g = new THREE.ExtrudeGeometry(gable, { depth: 0.3, bevelEnabled: false }).translate(0, H, zz - 0.15); g.computeVertexNormals(); parts.push(colored(g, red)); }
  // roof planes: lower steep pair and upper shallow pair
  const lowA = Math.atan2(2.2, 1.2), upA = Math.atan2(1.4, W / 2 - 1.2), lowL = Math.hypot(2.2, 1.2) + 0.25, upL = Math.hypot(1.4, W / 2 - 1.2) + 0.2;
  for (const s of [1, -1]) {
    const l = new THREE.BoxGeometry(lowL, 0.16, D + 0.8).rotateZ(-s * lowA).translate(s * (W / 2 - 0.55), H + 1.15, 0);
    const u = new THREE.BoxGeometry(upL, 0.16, D + 0.8).rotateZ(-s * upA).translate(s * (W / 2 - 1.2) / 2, H + 2.97, 0);
    parts.push(colored(l, roof), colored(u, roof));
  }
  // big doors with white X trim on both ends, plus loft door
  for (const s of [1, -1]) {
    const zz = s * (D / 2 + 0.17);
    parts.push(slab(3.2, 3.4, 0.06, 0, 1.7, zz, dark));
    parts.push(slab(3.4, 0.16, 0.08, 0, 3.45, zz + s * 0.02, white), slab(0.16, 3.4, 0.08, -1.65, 1.7, zz + s * 0.02, white), slab(0.16, 3.4, 0.08, 1.65, 1.7, zz + s * 0.02, white));
    for (const k of [1, -1]) { const x = new THREE.BoxGeometry(0.14, 4.4, 0.08).rotateZ(k * 0.75).translate(0, 1.7, zz + s * 0.03); parts.push(colored(x, white)); }
    parts.push(slab(1.4, 1.3, 0.06, 0, H + 1.1, zz, dark), slab(1.6, 0.12, 0.08, 0, H + 1.8, zz + s * 0.02, white));
    // corner trim
    for (const k of [1, -1]) parts.push(slab(0.2, H, 0.2, k * (W / 2), H / 2, s * (D / 2), white));
  }
  parts.push(slab(W + 0.6, 1.2, D + 0.6, 0, -0.5, 0, '#8a857c'));
  const barnGeo = mergeGeometries(parts);
  const barn = new THREE.Mesh(barnGeo, MAT.barn);
  barn.position.set(fx, base, fz); barn.rotation.y = ang; barn.castShadow = barn.receiveShadow = true;
  scene.add(barn);
  addStatic(fx, fz, W / 2 + 0.2, D / 2 + 0.2, ang, base - 1, base + 9);

  // split-rail fence around the pasture, with a gate gap facing the barn
  const fence = [], R = farm.penR, seg = 48;
  const toBarn = Math.atan2(fx - farm.penX, fz - farm.penZ);
  for (let i = 0; i < seg; i++) {
    const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2, am = (a0 + a1) / 2;
    let da = Math.abs(((am - toBarn) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI);
    if (da < 0.09) continue;
    const x0 = farm.penX + Math.sin(a0) * R, z0 = farm.penZ + Math.cos(a0) * R, x1 = farm.penX + Math.sin(a1) * R, z1 = farm.penZ + Math.cos(a1) * R;
    const y0 = getH(x0, z0), y1 = getH(x1, z1);
    fence.push(new THREE.CylinderGeometry(0.08, 0.1, 1.4, 7).translate(x0, y0 + 0.55, z0));
    const L = Math.hypot(x1 - x0, z1 - z0), yaw = Math.atan2(x1 - x0, z1 - z0), pitch = Math.atan2(y1 - y0, L);
    for (const hgt of [0.45, 0.95]) {
      const r = new THREE.CylinderGeometry(0.055, 0.055, L + 0.3, 7).rotateX(Math.PI / 2);
      r.rotateX(-pitch); r.rotateY(yaw); r.translate((x0 + x1) / 2, (y0 + y1) / 2 + hgt, (z0 + z1) / 2);
      fence.push(r);
    }
    addStatic((x0 + x1) / 2, (z0 + z1) / 2, 0.15, L / 2 + 0.1, yaw, Math.min(y0, y1) - 0.5, Math.max(y0, y1) + 1.25);
  }
  fence.forEach(g => g.deleteAttribute('uv'));
  const fm = new THREE.Mesh(mergeGeometries(fence.map(g => g.toNonIndexed())), new THREE.MeshStandardMaterial({ color: '#6e5a48', roughness: 0.95 }));
  fm.castShadow = fm.receiveShadow = true; scene.add(fm);

  // hay bales and a water trough beside the barn
  const bales = [];
  const side = (k, f) => [fx + Math.cos(ang) * k + Math.sin(ang) * f, fz - Math.sin(ang) * k + Math.cos(ang) * f];
  for (const [k, f, up] of [[6.5, 2, 0], [6.5, 3.4, 0], [6.6, 2.7, 1], [-6.4, -1, 0]]) {
    const [x, z] = side(k, f); const y = getH(x, z);
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 1.2, 24).rotateZ(Math.PI / 2), MAT.hay);
    b.position.set(x, y + 0.72 + up * 1.35, z); b.rotation.y = ang; b.castShadow = b.receiveShadow = true;
    scene.add(b); bales.push(b);
    if (!up) addStatic(x, z, 0.65, 0.8, ang, y - 0.5, y + 1.45 + (k > 0 && f > 2 && f < 3.5 ? 1.35 : 0));
  }
  const [tx, tz] = side(-6.2, 3.5), ty = getH(tx, tz);
  const trough = new THREE.Mesh(mergeGeometries([new RoundedBoxGeometry(2.2, 0.6, 0.8, 2, 0.05)]), MAT.plank);
  trough.position.set(tx, ty + 0.3, tz); trough.rotation.y = ang; trough.castShadow = true; scene.add(trough);
  const tw = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.6).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#2a4a50', roughness: 0.05, metalness: 0.2 }));
  tw.position.set(tx, ty + 0.55, tz); tw.rotation.y = ang; scene.add(tw);
  addStatic(tx, tz, 1.1, 0.4, ang, ty - 0.5, ty + 0.6);
  // a porch lantern on the barn that glows at night
  const [lx, lz] = side(0, D / 2 + 0.4);
  lanternSpots.push({ x: lx, y: base + 3.9, z: lz });
  const ln = makePiece(7, false); ln.position.set(lx, base + 3.65, lz); scene.add(ln);
}
export const lanternSpots = [];

// ---------------------------------------------------------------- collision
export const PR = 0.3, PH = 1.75, STEP = 0.55;
function staticHit(st, x, z, r) {
  const dx = x - st.x, dz = z - st.z;
  const lx = dx * st.c - dz * st.s, lz = dx * st.s + dz * st.c;
  return Math.abs(lx) < st.hx + r && Math.abs(lz) < st.hz + r;
}
export function supportHeight(x, z, feetY) {
  let best = getH(x, z);
  for (const p of pieces) {
    if (p.def.ramp) {
      if (x < p.minX || x > p.maxX || z < p.minZ || z > p.maxZ) continue;
      const a = p.rot * Math.PI / 2;
      const t = clamp(((x - p.x) * Math.sin(a) + (z - p.z) * Math.cos(a) + 1) / 2, 0, 1);
      const top = p.y + (p.def.id === 'stairs' ? Math.ceil(t * 4) * 0.5 : t * 2 + 0.1);
      if (top <= feetY + STEP && top > best) best = top;
    } else if (p.def.solid) {
      const r = PR * 0.8;
      if (x < p.minX - r || x > p.maxX + r || z < p.minZ - r || z > p.maxZ + r) continue;
      if (p.maxY <= feetY + STEP && p.maxY > best) best = p.maxY;
    }
  }
  for (const st of statics) if (st.maxY <= feetY + STEP && st.maxY > best && staticHit(st, x, z, PR * 0.8)) best = st.maxY;
  return best;
}
export function blocked(x, z, feetY, r = PR, h = PH) {
  for (const p of pieces) {
    if (!p.def.solid) continue;
    if (p.maxY <= feetY + STEP || p.minY >= feetY + h) continue;
    if (x + r > p.minX && x - r < p.maxX && z + r > p.minZ && z - r < p.maxZ) return true;
  }
  for (const st of statics) {
    if (st.maxY <= feetY + STEP || st.minY >= feetY + h) continue;
    if (staticHit(st, x, z, r)) return true;
  }
  return false;
}
export function hitsCeiling(x, z, feetY, ny) {
  for (const q of pieces) {
    if (!q.def.solid) continue;
    if (x + PR > q.minX && x - PR < q.maxX && z + PR > q.minZ && z - PR < q.maxZ && q.minY >= feetY + PH - 0.01 && q.minY < ny + PH) return true;
  }
  return false;
}
export function overlapsPlayer(b) {
  const f = S.player.pos;
  return f.x + PR > b.minX && f.x - PR < b.maxX && f.z + PR > b.minZ && f.z - PR < b.maxZ && f.y + PH > b.minY + 0.05 && f.y < b.maxY - 0.05;
}

// ---------------------------------------------------------------- lights and fires
const lightPool = [];
export function initLights(scene) { for (let i = 0; i < 6; i++) { const l = new THREE.PointLight('#ffb060', 0, 20, 1.6); scene.add(l); lightPool.push(l); } }
let lightTick = 0, lightList = [];
export function updateLights(dt, t, camPos) {
  lightTick -= dt;
  if (lightTick <= 0) {
    lightTick = 0.5;
    const src = pieces.filter(p => p.def.light).map(p => ({ x: p.x, y: p.y, z: p.z, fire: p.def.light === 'fire', p }));
    for (const s of lanternSpots) src.push({ x: s.x, y: s.y - 0.3, z: s.z, fire: false, fixed: true });
    src.sort((a, b) => ((a.x - camPos.x) ** 2 + (a.z - camPos.z) ** 2) - ((b.x - camPos.x) ** 2 + (b.z - camPos.z) ** 2));
    lightList = src.slice(0, lightPool.length);
  }
  lightPool.forEach((l, i) => {
    const s = lightList[i];
    if (!s || (s.p && !pieces.includes(s.p))) { l.intensity = 0; return; }
    l.position.set(s.x, s.y + (s.fire ? 0.7 : 0.25), s.z);
    l.color.set(s.fire ? '#ff7a2a' : '#ffb466');
    const flick = s.fire ? 0.75 + 0.25 * Math.sin(t * 17 + i) * Math.sin(t * 7.3 + i * 2) + 0.1 * Math.random() : 1;
    l.intensity = (s.fire ? 9 : 5) * flick * (0.45 + 0.55 * Math.max(S.nightF, 0.25)) * (s.fixed ? S.nightF : 1);
    l.distance = s.fire ? 22 : 15;
  });
}
export function updateFires(dt, camPos) {
  let nearest = 1e9;
  for (const p of pieces) {
    const pts = p.g.userData.fire; if (!pts) continue;
    nearest = Math.min(nearest, p.g.position.distanceTo(camPos));
    const pos = pts.geometry.attributes.position.array, col = pts.geometry.attributes.color.array;
    pts.userData.p.forEach((q, i) => {
      q.life += dt * (q.spark ? 0.45 : 0.9 + (i % 5) * 0.12);
      if (q.life >= 1) { q.life = 0; q.x = (Math.random() - 0.5) * 0.4; q.z = (Math.random() - 0.5) * 0.4; q.y = 0.1; q.vx = (Math.random() - 0.5) * (q.spark ? 1.2 : 0.25); q.vz = (Math.random() - 0.5) * (q.spark ? 1.2 : 0.25); }
      const L = q.life;
      pos[i * 3] = q.x * (1 - L) + q.vx * L; pos[i * 3 + 1] = q.y + L * (q.spark ? 4 : 1.5); pos[i * 3 + 2] = q.z * (1 - L) + q.vz * L;
      const b = q.spark ? (1 - L) * 0.8 : Math.sin(L * Math.PI) * 1.2;
      col[i * 3] = b; col[i * 3 + 1] = b * (q.spark ? 0.5 : 0.55 - L * 0.4); col[i * 3 + 2] = b * 0.12 * (1 - L);
    });
    pts.geometry.attributes.position.needsUpdate = true; pts.geometry.attributes.color.needsUpdate = true;
  }
  sfx.fireNear(nearest);
}
