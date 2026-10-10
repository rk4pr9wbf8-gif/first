import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { makeTextures } from './textures.js';
import { biomeAt, baseHeight, regionAt, SEA_LEVEL } from './world.js';
import { Road, makeGround, STEP, FLAG_TUNNEL, FLAG_BRIDGE } from './road.js';
import { Terrain, makeTerrainMaterial } from './terrain.js';
import { Vegetation } from './vegetation.js';
import { RoadMesh, makeRoadMaterials } from './roadmesh.js';
import { Atmosphere, PRESETS } from './atmosphere.js';
import { makeWater, makeLeaves } from './effects.js';
import { Car } from './car.js';
import { CarAudio } from './audio.js';

const $ = (id) => document.getElementById(id);
const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));
const isTouch = matchMedia('(pointer: coarse)').matches;

const DPR = Math.min(window.devicePixelRatio || 1, 2);
const QUALITY = [
  { name: 'Low', pr: Math.min(DPR, 1) * 0.75, shadows: false, shadowSize: 1024, post: false, veg: 560, hiR: 180, dens: 0.55, terrainR: 9000, leaves: 300 },
  { name: 'Medium', pr: Math.min(DPR, 1), shadows: true, shadowSize: 1024, post: true, veg: 760, hiR: 250, dens: 0.75, terrainR: 12000, leaves: 600 },
  { name: 'High', pr: Math.min(DPR, 1.5), shadows: true, shadowSize: 2048, post: true, veg: 980, hiR: 330, dens: 1.0, terrainR: 15000, leaves: 900 },
  { name: 'Ultra', pr: DPR, shadows: true, shadowSize: 4096, post: true, veg: 1300, hiR: 440, dens: 1.3, terrainR: 18000, leaves: 900 },
];
const CAMS = ['Chase', 'Far chase', 'Bumper', 'Roadside', 'Drone'];
const START_IDX = 360;
const AHEAD = 2600;

const hot = window.claude?.hot;
const saved = hot?.data || {};
const qParam = new URLSearchParams(location.search).get('q');
let qi = qParam != null ? +qParam : saved.quality ?? (isTouch ? 0 : 2);
let Q = QUALITY[qi];

// ------------------------------------------------------------------ renderer
const renderer = new THREE.WebGLRenderer({ antialias: !Q.post, powerPreference: 'high-performance' });
renderer.setPixelRatio(Q.pr);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.7;
renderer.shadowMap.enabled = Q.shadows;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.info.autoReset = false;
$('stage').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.5, 34000);
const uniforms = {
  uTime: { value: 0 }, uTreeDist: { value: Q.veg },
  uSunView: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color(1, 1, 1) }, uWind: { value: 1 },
};

let composer, bloom, grade;
function setupPost() {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.28, 0.6, 0.9);
  composer.addPass(bloom);
  grade = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uVig: { value: 0.9 }, uSat: { value: 1.12 }, uFlash: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform float uVig, uSat, uFlash; varying vec2 vUv;
      void main(){ vec4 c = texture2D(tDiffuse, vUv); float l = dot(c.rgb, vec3(0.2126,0.7152,0.0722));
        c.rgb = max(mix(vec3(l), c.rgb, uSat), 0.0);
        c.rgb *= vec3(1.02, 1.0, 0.97);
        vec2 d = vUv - 0.5; c.rgb *= 1.0 - dot(d, d) * uVig;
        c.rgb = mix(c.rgb, vec3(1.0, 0.95, 0.9) * 2.0, uFlash);
        gl_FragColor = c; }`,
  });
  composer.addPass(grade);
  composer.addPass(new OutputPass());
}

// ------------------------------------------------------------------ world
let tex, road, ground, terrain, veg, roadMesh, atm, water, leaves, car, world;
const audio = new CarAudio();
const envMats = [];
const tunnelLights = [];

function findStart() {
  // a Cascadia valley with land under it
  for (let k = 0; k < 400; k++) {
    const x = k * 1500, z = (k % 7) * 900;
    if (biomeAt(x, z) < 0.05 && biomeAt(x + 20000, z) < 0.3) {
      const h = baseHeight(x, z);
      if (h > 40 && h < 450) return [x, z];
    }
  }
  return [0, 0];
}

function setProgress(p, label) {
  $('bar-fill').style.transform = `scaleX(${p})`;
  if (label) $('load-label').textContent = label;
}

async function init() {
  setProgress(0.03, 'Painting textures');
  await nextFrame();
  tex = makeTextures();
  for (const t of Object.values(tex)) t.anisotropy = Math.min(t.anisotropy, renderer.capabilities.getMaxAnisotropy());

  setProgress(0.12, 'Surveying the highway');
  await nextFrame();
  const [sx, sz] = findStart();
  road = new Road(sx, sz, 0.35);
  ground = makeGround(road);
  let startIdx = Math.max(START_IDX, saved.idx || 0);
  road.ensure(startIdx + AHEAD);
  if (!saved.idx) startIdx = openRoadNear(startIdx);

  atm = new Atmosphere(renderer, scene, uniforms);
  if (saved.preset != null) { atm.presetIndex = saved.preset; atm.apply(PRESETS[saved.preset]); }

  const tmat = makeTerrainMaterial(tex, uniforms);
  terrain = new Terrain(scene, ground, tmat);
  terrain.viewRadius = Q.terrainR;
  veg = new Vegetation(scene, ground, uniforms, tex);
  veg.radius = Q.veg; veg.hiR = Q.hiR; veg.density = Q.dens;
  const rmats = makeRoadMaterials(tex, uniforms);
  roadMesh = new RoadMesh(scene, road, ground, rmats);
  water = makeWater(scene, tex, uniforms);
  leaves = makeLeaves(scene, tex, uniforms, 900);
  car = new Car(scene);
  world = { road, ground, veg };

  road.onFinalize((i0, i1) => {
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    for (let i = i0; i <= i1; i++) { a = Math.min(a, road.px[i]); b = Math.min(b, road.pz[i]); c = Math.max(c, road.px[i]); d = Math.max(d, road.pz[i]); }
    terrain.invalidate(a, b, c, d);
    veg.invalidate(a, b, c, d);
    roadMesh.invalidate(i0, i1);
  });

  for (const m of [rmats.road, rmats.concrete, rmats.rail, rmats.post, car.paint, tmat, veg.matFol, veg.matRock, veg.matTuft, water.mesh.material])
    envMats.push([m, m.envMapIntensity]);
  rmats.tunnel.envMapIntensity = 0.12;
  reflectorMat = rmats.reflector;

  for (let k = 0; k < 3; k++) {
    const l = new THREE.PointLight(0xffb060, 0, 32, 1.6);
    scene.add(l); tunnelLights.push(l);
  }

  const i = startIdx;
  car.place(road.px[i], road.pz[i], road.hd[i], road.y[i] + 0.02);
  carIdx = i;
  if (saved.paint) { for (let k = 0; k < saved.paint; k++) car.nextPaint(); }
  if (saved.cam != null) camMode = saved.cam;
  snapCamera();

  setProgress(0.2, 'Raising mountains');
  let pending = 1;
  while (pending > 0) {
    pending = terrain.update(camera.position.x, camera.position.z, 40);
    setProgress(0.2 + 0.45 * (1 - Math.min(1, pending / 120)), 'Raising mountains');
    await nextFrame();
  }
  pending = 1;
  while (pending > 0) {
    pending = veg.update(camera.position.x, camera.position.z, 40);
    setProgress(0.65 + 0.25 * (1 - Math.min(1, pending / 40)), 'Planting forests');
    await nextFrame();
  }
  pending = 1;
  while (pending > 0) { pending = roadMesh.update(camera.position.x, camera.position.z, 40); await nextFrame(); }
  setProgress(0.97, 'Warming up shaders');
  applyQuality();
  renderer.compile(scene, camera);
  await nextFrame();
  setProgress(1, 'Ready');
  $('start').disabled = false;
  $('start').textContent = 'Start driving';
  ready = true;
  if (saved.started) begin();
}

// first sample at or after i with plain road around it (no tunnel/bridge)
function openRoadNear(i) {
  for (let k = i; k < road.nFinal - 100; k++) {
    let ok = true;
    for (let j = k - 30; j < k + 90 && ok; j++) if (road.flag[j] !== 0) ok = false;
    if (ok) return k;
  }
  return i;
}

function teleport(i) {
  road.ensure(i + AHEAD);
  car.place(road.px[i], road.pz[i], road.hd[i], road.y[i] + 0.02);
  carIdx = i; cine = null;
  snapCamera();
}

// fully stream the world around the camera (used after big jumps)
function warm() {
  for (let n = 0; n < 50; n++) {
    const p = terrain.update(camera.position.x, camera.position.z, 1e9) + veg.update(camera.position.x, camera.position.z, 1e9) + roadMesh.update(camera.position.x, camera.position.z, 1e9);
    if (!p) break;
  }
}

window.__alcan = {
  teleport: (i) => { teleport(i); warm(); }, warm, openRoadNear: (i) => openRoadNear(i),
  setCam: (m) => { camMode = m; cine = null; freeCam = null; snapCamera(); },
  free: (x, y, z, lx, ly, lz) => { freeCam = [x, y, z, lx, ly, lz]; },
  info: () => ({ ...stats, geos: renderer.info.memory.geometries, progs: renderer.info.programs.length }),
  setPreset: (p) => { atm.presetIndex = p; atm.apply(PRESETS[p]); },
  state: () => ({ carIdx, x: car.x, z: car.z, y: car.y, vx: car.vx, nFinal: road.nFinal, flag: road.flag[carIdx] }),
  sim: (sec, thr = 1, steer = 0, auto = false) => { for (let t = 0; t < sec; t += 1 / 60) { const inp = { steer, throttle: thr, brake: 0, handbrake: false }; if (auto) autoDrive(inp); car.update(1 / 60, inp, world); const q = road.query(car.x, car.z, car.y); if (q) carIdx = q.i; road.ensure(carIdx + AHEAD, 64); } snapCamera(); },
  autoTest: (sec) => { let maxSide = 0, sum = 0, n = 0, off = 0; for (let t = 0; t < sec; t += 1 / 60) { const inp = { steer: 0, throttle: 0, brake: 0, handbrake: false }; autoDrive(inp); car.update(1 / 60, inp, world); const q = road.query(car.x, car.z, car.y); if (q) { carIdx = q.i; maxSide = Math.max(maxSide, Math.abs(q.side)); if (Math.abs(q.side) > 5) off++; } else off++; sum += car.vx; n++; road.ensure(carIdx + AHEAD, 64); } snapCamera(); return { maxSide, avgSpeed: sum / n, offFrames: off, idx: carIdx, y: car.y, air: car.air }; },
  findAlaska: (from = 400) => { for (let i = from; i < 60000; i += 50) { road.ensure(i + 200); if (biomeAt(road.px[i], road.pz[i]) > 0.85) return openRoadNear(i); } return -1; },
  findFlag: (f, from) => { for (let i = from; i < road.nFinal; i++) if (road.flag[i] === f && road.flag[i - 1] !== f) return i; return -1; },
};

let reflectorMat;
let stats = {};
let autoQDone = new URLSearchParams(location.search).has('q'), autoQT = -2, autoQN = 0;
let ready = false, started = false;
let carIdx = 0;
let camMode = 0;
let odo = 0;
let lastRegion = '';
let tunnelF = 0, tunnelShown = -1;
let headOverride = null;
let exposure = 0.7;

function applyQuality() {
  Q = QUALITY[qi];
  renderer.setPixelRatio(Q.pr);
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = Q.shadows;
  atm.sun.castShadow = Q.shadows;
  if (atm.sun.shadow.map) { atm.sun.shadow.map.dispose(); atm.sun.shadow.map = null; }
  atm.sun.shadow.mapSize.set(Q.shadowSize, Q.shadowSize);
  terrain.viewRadius = Q.terrainR;
  if (veg.density !== Q.dens) { veg.density = Q.dens; for (const c of veg.cells.values()) c.stale = true; }
  veg.radius = Q.veg; veg.hiR = Q.hiR;
  uniforms.uTreeDist.value = Q.veg;
  if (Q.post) { if (composer) composer.dispose?.(); setupPost(); }
  scene.traverse(o => { if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach(m => m.needsUpdate = true); } });
}

// ------------------------------------------------------------------ input
const keys = new Set();
const input = { steer: 0, throttle: 0, brake: 0, handbrake: false };
const touch = { left: false, right: false, gas: false, brake: false };
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys.add(e.code);
  if (!started) return;
  switch (e.code) {
    case 'KeyC': cycleCam(); break;
    case 'KeyT': toast(atm.next()); break;
    case 'KeyH': headOverride = !(headOverride ?? autoHeadlights()); toast(headOverride ? 'Headlights on' : 'Headlights off'); break;
    case 'KeyR': resetCar(); break;
    case 'KeyM': toast(audio.toggleMute() ? 'Sound off' : 'Sound on'); break;
    case 'KeyQ': autoQDone = true; qi = (qi + 1) % QUALITY.length; applyQuality(); toast('Quality: ' + QUALITY[qi].name); break;
    case 'KeyP': car.nextPaint(); break;
    case 'KeyO': autopilot = !autopilot; toast(autopilot ? 'Scenic autopilot: steer or brake to take over' : 'Autopilot off'); break;
    case 'KeyU': metric = !metric; break;
    case 'Slash': case 'F1': $('help').hidden = !$('help').hidden; break;
  }
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

let metric = !/^en-US/.test(navigator.language || '') ;
let orbitYaw = 0, orbitPitch = 0, dragging = false, lastPX = 0, lastPY = 0, lastDrag = 0;
renderer.domElement.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') { dragging = true; lastPX = e.clientX; lastPY = e.clientY; } });
addEventListener('pointerup', () => { dragging = false; lastDrag = performance.now(); });
addEventListener('pointermove', (e) => {
  if (!dragging) return;
  orbitYaw -= (e.clientX - lastPX) * 0.006; orbitPitch = Math.max(-0.3, Math.min(1.1, orbitPitch + (e.clientY - lastPY) * 0.004));
  lastPX = e.clientX; lastPY = e.clientY;
});
renderer.domElement.addEventListener('wheel', (e) => { zoom = Math.max(0.6, Math.min(2.2, zoom * (1 + Math.sign(e.deltaY) * 0.08))); }, { passive: true });
let zoom = 1;

for (const [id, k] of [['t-left', 'left'], ['t-right', 'right'], ['t-gas', 'gas'], ['t-brake', 'brake']]) {
  const el = $(id);
  el.addEventListener('pointerdown', (e) => { touch[k] = true; el.setPointerCapture(e.pointerId); el.classList.add('on'); e.preventDefault(); });
  const off = () => { touch[k] = false; el.classList.remove('on'); };
  el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off);
}
$('t-cam').addEventListener('click', () => cycleCam());
$('t-time').addEventListener('click', () => toast(atm.next()));
$('t-auto').addEventListener('click', () => { autopilot = !autopilot; toast(autopilot ? 'Scenic autopilot on' : 'Autopilot off'); });

let padPrev = [];
function readInput(dt) {
  let st = 0, th = 0, br = 0, hb = false;
  if (keys.has('ArrowLeft') || keys.has('KeyA') || touch.left) st -= 1;
  if (keys.has('ArrowRight') || keys.has('KeyD') || touch.right) st += 1;
  if (keys.has('ArrowUp') || keys.has('KeyW') || touch.gas) th = 1;
  if (keys.has('ArrowDown') || keys.has('KeyS') || touch.brake) br = 1;
  if (keys.has('Space')) hb = true;
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const p of pads) {
    if (!p) continue;
    const ax = p.axes[0] || 0;
    if (Math.abs(ax) > 0.12) st = Math.sign(ax) * (Math.abs(ax) - 0.12) / 0.88;
    th = Math.max(th, p.buttons[7]?.value || 0);
    br = Math.max(br, p.buttons[6]?.value || 0);
    if (p.buttons[0]?.pressed || p.buttons[1]?.pressed) hb = true;
    const pressed = (i) => p.buttons[i]?.pressed && !padPrev[i];
    if (pressed(3)) cycleCam();
    if (pressed(2)) toast(atm.next());
    padPrev = p.buttons.map(b => b.pressed);
    break;
  }
  // keyboard steering eases in like a real wheel
  const k = Math.abs(st) > Math.abs(input.steer) ? 5 : 9;
  input.steer += (st - input.steer) * Math.min(1, dt * k);
  input.throttle = th; input.brake = br; input.handbrake = hb;
  if (autopilot) {
    if (Math.abs(st) > 0.5 || br > 0) { autopilot = false; toast('Autopilot off'); }
    else autoDrive(input);
  }
}

// Scenic autopilot: follows the centre of the right-hand lane.
let autopilot = false;
function autoDrive(inp) {
  const sp = Math.max(0, car.vx);
  const q = road.query(car.x, car.z, car.y);
  if (!q) { inp.steer = 0; inp.throttle = 0.3; inp.brake = 0; return; }
  // Stanley lane keeping: heading error + cross-track term + curvature feed-forward
  const i = q.i, ahead = Math.min(road.nFinal - 3, i + 1 + Math.round(sp * 0.12 / STEP * 4));
  let he = road.hd[ahead] - car.th; he = Math.atan2(Math.sin(he), Math.cos(he));
  const e = 1.8 - q.side;
  let kap = road.hd[ahead + 1] - road.hd[ahead]; kap = Math.atan2(Math.sin(kap), Math.cos(kap)) / STEP;
  const delta = he + Math.atan(0.9 * e / (sp + 3)) + 2.7 * kap - car.w * 0.02;
  inp.steer = Math.max(-1, Math.min(1, delta / (0.6 / (1 + sp / 13))));
  // slow for curves ahead
  let curv = 0;
  for (let k = 0; k < 40; k++) {
    const i = Math.min(road.nFinal - 2, carIdx + k);
    let d = road.hd[i + 1] - road.hd[i]; d = Math.atan2(Math.sin(d), Math.cos(d));
    curv = Math.max(curv, Math.abs(d) / STEP);
  }
  const vT = Math.min(27, Math.sqrt(6.5 / Math.max(curv, 1e-4)));
  inp.throttle = sp < vT - 1 ? Math.min(1, (vT - sp) * 0.25) : 0;
  inp.brake = sp > vT + 2.5 ? Math.min(1, (sp - vT) * 0.15) : 0;
  inp.handbrake = false;
}

function cycleCam() { camMode = (camMode + 1) % CAMS.length; toast(CAMS[camMode] + ' camera'); cine = null; }

function resetCar() {
  const i = Math.max(1, carIdx);
  car.place(road.px[i], road.pz[i], road.hd[i], road.y[i] + 0.3);
  toast('Back on the road');
}

let toastT = 0;
function toast(msg) { const el = $('toast'); el.textContent = msg; el.classList.add('show'); toastT = 2.2; }

// ------------------------------------------------------------------ camera
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
let camHeading = 0, cine = null, freeCam = null;
function snapCamera() {
  camHeading = car.th;
  updateCamera(1, true);
}

function camGroundClamp(p) {
  const q = road.query(p.x, p.z, p.y);
  if (q && q.flag === FLAG_TUNNEL && q.d < 7.5 && p.y < q.y + 12) {
    p.y = Math.min(Math.max(p.y, q.y + 0.9), q.y + 6.2);
    // keep inside the tube laterally
    if (Math.abs(q.side) > 5.6) {
      const s = Math.sign(q.side) * (Math.abs(q.side) - 5.6);
      p.x -= -q.hz * s; p.z -= q.hx * s;
    }
    return;
  }
  const g = ground.terrainHeight(p.x, p.z);
  const gr = q && q.d < 7 ? q.y : -1e9;
  p.y = Math.max(p.y, g + 0.7, gr + 0.7, SEA_LEVEL + 0.5);
}

function updateCamera(dt, snap = false) {
  const fx = Math.cos(car.th), fz = Math.sin(car.th);
  let dh = car.th - camHeading; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
  camHeading += dh * (snap ? 1 : Math.min(1, dt * 3.2));
  if (!dragging && performance.now() - lastDrag > 1500) { orbitYaw *= 1 - Math.min(1, dt * 2); orbitPitch *= 1 - Math.min(1, dt * 2); }
  const speed = Math.abs(car.vx);
  let fov = 62;
  const target = new THREE.Vector3(car.x, car.y, car.z);
  let want = new THREE.Vector3(), look = new THREE.Vector3();
  let lerpK = 8;
  if (!started) {
    const a = elapsed * 0.06 + 2.2;
    want.set(car.x + Math.cos(a) * 34, car.y + 11, car.z + Math.sin(a) * 34);
    look.set(car.x + fx * 6, car.y + 3, car.z + fz * 6);
    fov = 50; lerpK = 1000;
  } else if (camMode === 0 || camMode === 1 || camMode === 4) {
    const portrait = camera.aspect < 1 ? 1.55 : 1;
    const dist = (camMode === 0 ? 7.0 : camMode === 1 ? 12.5 : 42) * zoom * portrait + speed * (camMode === 4 ? 0.2 : 0.035);
    const hgt = (camMode === 0 ? 2.25 : camMode === 1 ? 4.0 : 24) * zoom * (portrait > 1 ? 1.3 : 1) + orbitPitch * dist * 0.8;
    const h = camHeading + orbitYaw;
    want.set(car.x - Math.cos(h) * dist, car.y + hgt, car.z - Math.sin(h) * dist);
    look.set(car.x + fx * 4, car.y + 1.1, car.z + fz * 4);
    fov = camMode === 4 ? 55 : 62 + Math.min(14, speed * 0.22);
    lerpK = camMode === 4 ? 3 : 10;
  } else if (camMode === 2) {
    const c = Math.cos(car.th), s = Math.sin(car.th);
    want.set(car.x + c * 2.15, car.y + 0.95, car.z + s * 2.15);
    look.set(car.x + c * 30, car.y + 1.0 + Math.tan(car.pitch) * 30, car.z + s * 30);
    fov = 70 + Math.min(10, speed * 0.15);
    lerpK = 60;
  } else {
    // roadside TV camera that leapfrogs ahead of the car
    if (!cine || carIdx > cine.idx + 18 || Math.hypot(cine.pos.x - car.x, cine.pos.z - car.z) > 700) {
      const idx = Math.min(road.nFinal - 2, carIdx + 90 + Math.floor(Math.random() * 60));
      const side = Math.random() < 0.5 ? -1 : 1;
      const th = road.hd[idx];
      const lat = side * (10 + Math.random() * 16);
      const p = new THREE.Vector3(road.px[idx] - Math.sin(th) * lat, 0, road.pz[idx] + Math.cos(th) * lat);
      const tunnel = road.flag[idx] === FLAG_TUNNEL;
      if (tunnel) { p.x = road.px[idx] - Math.sin(th) * side * 4; p.z = road.pz[idx] + Math.cos(th) * side * 4; }
      p.y = (tunnel ? road.y[idx] + 2.5 : Math.max(ground.terrainHeight(p.x, p.z), road.y[idx]) + 2 + Math.random() * 6);
      cine = { idx, pos: p };
    }
    want.copy(cine.pos); look.copy(target).add(new THREE.Vector3(0, 1, 0));
    const d = want.distanceTo(target);
    fov = THREE.MathUtils.clamp(2 * Math.atan(9 / d) * 180 / Math.PI, 12, 60);
    lerpK = 1000;
  }
  if (snap) { camPos.copy(want); camLook.copy(look); }
  else {
    camPos.lerp(want, Math.min(1, dt * lerpK));
    camLook.lerp(look, Math.min(1, dt * (lerpK > 50 ? 60 : 12)));
  }
  if (camMode !== 3) camGroundClamp(camPos);
  if (freeCam) { camera.position.set(freeCam[0], freeCam[1], freeCam[2]); camera.lookAt(freeCam[3], freeCam[4], freeCam[5]); camera.fov = 60; camera.updateProjectionMatrix(); return; }
  camera.position.copy(camPos);
  if (car.impact > 0.05) camera.position.add(new THREE.Vector3((Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)).multiplyScalar(car.impact * 0.25));
  camera.lookAt(camLook);
  camera.fov += (fov - camera.fov) * (snap ? 1 : Math.min(1, dt * 3));
  camera.updateProjectionMatrix();
}

// ------------------------------------------------------------------ HUD
const mini = $('minimap').getContext('2d');
function drawMinimap() {
  const W = mini.canvas.width, H = mini.canvas.height, s = W / 2;
  mini.clearRect(0, 0, W, H);
  mini.save();
  mini.beginPath(); mini.arc(s, s, s - 2, 0, Math.PI * 2); mini.clip();
  mini.fillStyle = 'rgba(10,22,18,0.72)'; mini.fillRect(0, 0, W, H);
  const scale = s / 900;
  const c = Math.cos(-car.th - Math.PI / 2), sn = Math.sin(-car.th - Math.PI / 2);
  const P = (i) => {
    const dx = road.px[i] - car.x, dz = road.pz[i] - car.z;
    return [s + (dx * c - dz * sn) * scale, s + (dx * sn + dz * c) * scale];
  };
  const a = Math.max(0, carIdx - 260), b = Math.min(road.nFinal - 1, carIdx + 320);
  mini.lineCap = 'round'; mini.lineJoin = 'round';
  for (let i = a; i < b; i += 2) {
    const f = road.flag[i];
    const [x0, y0] = P(i), [x1, y1] = P(Math.min(b, i + 2));
    mini.strokeStyle = f === FLAG_TUNNEL ? 'rgba(255,255,255,0.28)' : f === FLAG_BRIDGE ? '#8fd3ff' : '#f2efe4';
    mini.lineWidth = f === FLAG_TUNNEL ? 2 : 3;
    if (f === FLAG_TUNNEL) mini.setLineDash([3, 3]); else mini.setLineDash([]);
    mini.beginPath(); mini.moveTo(x0, y0); mini.lineTo(x1, y1); mini.stroke();
  }
  mini.setLineDash([]);
  mini.restore();
  mini.fillStyle = '#f2c230';
  mini.beginPath(); mini.moveTo(s, s - 8); mini.lineTo(s + 6, s + 6); mini.lineTo(s, s + 3); mini.lineTo(s - 6, s + 6); mini.closePath(); mini.fill();
  // north marker
  const north = [0, -1];
  const rx = north[0] * c - north[1] * sn, ry = north[0] * sn + north[1] * c;
  mini.fillStyle = '#ffffff'; mini.font = '700 13px Overpass, system-ui, sans-serif'; mini.textAlign = 'center'; mini.textBaseline = 'middle';
  mini.fillText('N', s + rx * (s - 13), s + ry * (s - 13));
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
let hudT = 0, regionCheckT = 0, signT = 0;
function updateHUD(dt) {
  const kmh = Math.abs(car.vx) * 3.6;
  $('speed').textContent = Math.round(metric ? kmh : kmh * 0.621371);
  $('unit').textContent = metric ? 'km/h' : 'mph';
  const rpm = audio.rpm || (900 + Math.abs(car.vx) * 60);
  $('tach').style.transform = `scaleX(${Math.min(1, rpm / 6000)})`;
  $('gear').textContent = car.vx < -0.5 ? 'R' : (audio.gear || 1);
  hudT -= dt;
  if (hudT <= 0) {
    hudT = 0.2;
    const dist = metric ? odo / 1000 : odo / 1609.34;
    $('odo').textContent = dist.toFixed(1);
    $('odo-unit').textContent = metric ? 'km' : 'mi';
    $('elev').textContent = metric ? Math.round(car.y) + ' m' : Math.round(car.y * 3.28084) + ' ft';
    const bearing = (Math.atan2(Math.cos(car.th), -Math.sin(car.th)) * 180 / Math.PI + 360) % 360;
    $('heading').textContent = COMPASS[Math.round(bearing / 45) % 8];
    $('tod').textContent = atm.preset.name;
    drawMinimap();
  }
  regionCheckT -= dt;
  if (regionCheckT <= 0) {
    regionCheckT = 1;
    const r = regionAt(car.x, car.z);
    if (r.name !== lastRegion) {
      lastRegion = r.name;
      $('sign-name').textContent = r.name;
      $('sign-state').textContent = r.state;
      $('region').classList.add('show'); signT = 6;
    }
    // tunnel warning: look ahead for the next portal
    let found = -1;
    for (let i = carIdx + 25; i < Math.min(road.nFinal - 1, carIdx + 110); i++) {
      if (road.flag[i] === FLAG_TUNNEL && road.flag[i - 1] !== FLAG_TUNNEL) { found = i; break; }
    }
    if (found > 0 && found !== tunnelShown) {
      let e = found; while (e < road.nFinal - 1 && road.flag[e] === FLAG_TUNNEL) e++;
      const len = (e - found) * STEP;
      $('tunnel-len').textContent = metric ? (len >= 1000 ? (len / 1000).toFixed(1) + ' km' : Math.round(len / 10) * 10 + ' m') : (len * 3.28084 >= 5280 ? (len / 1609.34).toFixed(1) + ' mi' : Math.round(len * 3.28084 / 50) * 50 + ' ft');
      $('tunnel-sign').classList.add('show');
      tunnelShown = found;
      setTimeout(() => $('tunnel-sign').classList.remove('show'), 7000);
    }
  }
  if (signT > 0) { signT -= dt; if (signT <= 0) $('region').classList.remove('show'); }
  if (toastT > 0) { toastT -= dt; if (toastT <= 0) $('toast').classList.remove('show'); }
}

function autoHeadlights() { return atm.night > 0.3 || tunnelF > 0.05; }

// how deep inside a tunnel is a point (0 outside, 1 = >60 m in)
function tunnelDepth(x, z, y) {
  const q = road.query(x, z, y);
  if (!q || q.flag !== FLAG_TUNNEL || q.d > 8 || y > q.y + 9) return 0;
  let n = 0;
  const i = q.i;
  for (let k = 1; k <= 20; k++) {
    if (road.flag[i - k] !== FLAG_TUNNEL || road.flag[i + k] !== FLAG_TUNNEL) break;
    n = k;
  }
  return Math.min(1, (n * STEP) / 60);
}

// ------------------------------------------------------------------ loop
let last = performance.now();
let elapsed = 0;
function frame() {
  requestAnimationFrame(frame);
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!ready) return;
  stats = { calls: renderer.info.render.calls, tris: renderer.info.render.triangles };
  renderer.info.reset();
  elapsed += dt;
  uniforms.uTime.value = elapsed;

  if (started) readInput(dt);
  else { input.steer = 0; input.throttle = 0; input.brake = 0; input.handbrake = false; }
  const px = car.x, pz = car.z;
  car.update(dt, input, world);
  odo += Math.hypot(car.x - px, car.z - pz);
  const q = road.query(car.x, car.z, car.y);
  if (q) carIdx = q.i;
  if (car.y < -60) resetCar();

  // keep the road surveyed far ahead
  if (road.nFinal < carIdx + AHEAD) road.ensure(carIdx + AHEAD, 64);

  // streaming
  const cx = camera.position.x, cz = camera.position.z;
  const ms = qi <= 0 ? 3 : 5;
  terrain.update(cx, cz, ms);
  veg.update(cx, cz, ms * 0.8);
  roadMesh.update(cx, cz, 2);

  // tunnel lighting / eye adaptation
  const tf = tunnelDepth(car.x, car.z, car.y);
  tunnelF += (tf - tunnelF) * Math.min(1, dt * 2.5);
  const tfc = tunnelDepth(camera.position.x, camera.position.z, camera.position.y);
  atm.sun.intensity = atm.baseSun * (1 - tfc);
  atm.hemi.intensity = atm.baseHemi * (1 - 0.9 * tfc);
  scene.fog.density = atm.baseFog * (1 - 0.7 * tfc);
  const envK = atm.envIntensity * (1 - 0.85 * tfc);
  for (const [m, base] of envMats) m.envMapIntensity = base * envK;
  for (let k = 0; k < tunnelLights.length; k++) {
    const L = tunnelLights[k];
    if (tunnelF > 0.01 && q) {
      const i = Math.round(carIdx / 5) * 5 + (k - 1) * 5;
      if (road.flag[i] === FLAG_TUNNEL) {
        L.position.set(road.px[i], road.y[i] + 6.2, road.pz[i]);
        L.intensity = 90 * Math.max(tunnelF, tfc);
      } else L.intensity = 0;
    } else L.intensity = 0;
  }
  const targetExp = atm.exposure * (1 + 1.1 * tfc);
  exposure += (targetExp - exposure) * Math.min(1, dt * 1.2);
  renderer.toneMappingExposure = exposure;
  const heads = headOverride ?? autoHeadlights();
  car.setHeadlights(heads, atm.night > 0.3 ? 1 : 0.6);
  car.tailMat.emissiveIntensity = input.brake > 0 ? 6 : heads ? 2 : 0.6;
  if (reflectorMat) reflectorMat.emissiveIntensity = heads ? 2.5 : 0;

  updateCamera(dt);
  atm.update(camera, new THREE.Vector3(car.x, car.y, car.z));
  water.update(camera);
  const a = biomeAt(car.x, car.z);
  const leafLight = new THREE.Color().copy(atm.sunColor).multiplyScalar(0.35 + 0.45 * (1 - atm.night)).multiplyScalar(1 - 0.85 * tfc);
  leaves.update(camera, (0.25 + 0.6 * (1 - a * 0.5)) * (1 - tfc) * (Q.leaves / 900), leafLight);
  uniforms.uWind.value = 0.8 + 0.4 * Math.sin(elapsed * 0.13);

  audio.update(car.vx, input.throttle, car.slip, tunnelF, !car.onRoad);
  if (started) updateHUD(dt);

  // auto quality: if the first seconds of driving are slow, step down once
  if (started && !autoQDone) {
    autoQT += dt; if (autoQT > 0) autoQN++;
    if (autoQT > 6) {
      autoQDone = true;
      const fps = autoQN / autoQT;
      if (fps < 32 && qi > 0) { qi--; applyQuality(); toast(`Quality lowered to ${QUALITY[qi].name} for smoother driving · Q to change`); }
    }
  }

  if (Q.post && composer) {
    grade.uniforms.uFlash.value = car.impact * 0.15;
    composer.render();
  } else renderer.render(scene, camera);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  if (composer) { const s = renderer.getDrawingBufferSize(new THREE.Vector2()); composer.setSize(innerWidth, innerHeight); bloom.resolution.set(s.x / 2, s.y / 2); }
});

function begin() {
  if (started) return;
  started = true;
  audio.start();
  document.body.classList.add('driving');
  $('title').hidden = true;
  $('hud').hidden = false;
  if (isTouch) { $('touch').hidden = false; document.body.classList.add('touch-ui'); }
  toast(isTouch ? 'Hold the pedals to drive' : 'W / ↑ to drive · C camera · T time of day');
}
$('start').addEventListener('click', begin);

hot?.snapshot?.(() => ({ idx: carIdx, preset: atm?.presetIndex, cam: camMode, quality: qi, paint: car?.paintIndex, started }));

requestAnimationFrame(frame);
init().catch((e) => { console.error(e); $('load-label').textContent = 'Could not start: ' + e.message; });
