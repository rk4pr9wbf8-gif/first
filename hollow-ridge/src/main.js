// Hollow Ridge: boot, input, UI and the main loop.
import * as THREE from 'three';
import { S } from './state.js';
import { U, installFog } from './shaders.js';
import { WATER, getH, buildTerrain, updateWater, nearestRiverPoint, LAKE, river, paintPasture } from './world.js';
import { createSky, applyTime, updateSky, setShadowSize, sun } from './sky.js';
import { chooseSites, spawn, farm } from './sites.js';
import { buildFlora, updateLOD, updateLeaves, updateMotes, updateMist, setGrassDensity } from './flora.js';
import { DEFS, makePiece, pieces, pieceRoot, pieceBox, addPiece, removePiece, clearPieces, loadPieces, buildHomestead, overlapsPlayer, initLights, updateLights, updateFires, MAT } from './build.js';
import { buildFauna, updateFauna, tryPet, animals, faunaCounts } from './fauna.js';
import { player, updatePlayer } from './player.js';
import { setupComposer, resizeComposer, updatePost } from './post.js';
import { sfx } from './audio.js';
import { clamp, lerp } from './noise.js';

const $ = (id) => document.getElementById(id);
const nextFrame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
const store = { get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } } };

// ---------------------------------------------------------------- renderer & scene
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xb8c4d4, 0.00072);
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.1, 9000);
Object.assign(S, { scene, camera, renderer, player });
installFog(WATER - 2);
scene.add(pieceRoot);

// ---------------------------------------------------------------- quality
const QUALITY = {
  low: { pr: 0.75, shadow: 1024, msaa: 0, rays: 24, grass: 0.45, label: 'Low' },
  high: { pr: Math.min(devicePixelRatio, 1.5), shadow: 2048, msaa: 4, rays: 40, grass: 1, label: 'High' },
  ultra: { pr: Math.min(devicePixelRatio, 2), shadow: 4096, msaa: 4, rays: 64, grass: 1, label: 'Ultra' },
};
const params = new URLSearchParams(location.search);
let quality = params.has('lowtest') ? 'low' : store.get('hr.quality', 'high');
let autoQuality = store.get('hr.autoQuality', true) && !params.has('lowtest');
let lastMsaa = -1;
function applyQuality(name, announce) {
  quality = QUALITY[name] ? name : 'high';
  const q = QUALITY[quality];
  renderer.setPixelRatio(params.has('lowtest') ? 0.5 : q.pr);
  setShadowSize(q.shadow);
  if (q.msaa !== lastMsaa) { setupComposer(renderer, scene, camera, q.msaa); lastMsaa = q.msaa; }
  else resizeComposer();
  setGrassDensity(q.grass);
  store.set('hr.quality', quality);
  document.querySelectorAll('[data-q]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.q === (autoQuality ? 'auto' : quality))));
  if (announce) toast(`${q.label} graphics`);
}
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); resizeComposer();
});

// ---------------------------------------------------------------- UI
const bar = $('bar');
DEFS.forEach((d, i) => {
  const s = document.createElement('div'); s.className = 'slot';
  s.innerHTML = `<span class="k">${i < 9 ? i + 1 : i === 9 ? 0 : ''}</span><i style="background:${d.swatch}"></i>${d.name}`;
  bar.appendChild(s);
});
let selected = 0, rotIdx = 0, buildMode = true, hudHidden = false, dreamTarget = 0, timeFlow = true;
function refreshBar() { [...bar.children].forEach((s, i) => s.classList.toggle('on', i === selected)); bar.classList.toggle('off', !buildMode); }
let toastT = 0;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 1900); }
S.toast = toast;
function fmtTime(h) { const hh = Math.floor(h) % 24, mm = Math.floor((h % 1) * 60); return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${hh >= 12 ? 'pm' : 'am'}`; }
const DREAM_STEPS = [0, 0.35, 0.7, 1];
const dreamName = v => v < 0.05 ? '' : v < 0.5 ? ' · drifting' : v < 0.85 ? ' · dreaming' : ' · deep dream';

let dragMode = false, dragging = false, dragMoved = 0, lastMX = 0, lastMY = 0;
function showGame() { S.playing = true; $('overlay').classList.add('gone'); $('hud').classList.toggle('hidden', hudHidden); startFpsProbe(); }
function enterGame() {
  sfx.start();
  try {
    const r = canvas.requestPointerLock();
    if (r && r.catch) r.catch(() => { dragMode = true; showGame(); });
  } catch (e) { dragMode = true; showGame(); }
  setTimeout(() => { if (!document.pointerLockElement && !S.playing) { dragMode = true; showGame(); } }, 400);
}
function pause() {
  S.playing = false;
  $('go').textContent = 'Back to the woods';
  $('tod').value = S.timeOfDay.toFixed(2); $('dream').value = dreamTarget;
  $('overlay').classList.remove('gone'); $('hud').classList.add('hidden');
}
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === canvas) { dragMode = false; showGame(); }
  else if (S.playing && !dragMode) pause();
});
document.addEventListener('pointerlockerror', () => { dragMode = true; showGame(); });
$('go').addEventListener('click', enterGame);
let clearArmed = false;
$('clear').addEventListener('click', () => {
  if (!clearArmed) { clearArmed = true; $('clear').textContent = 'Click again to clear everything'; setTimeout(() => { clearArmed = false; $('clear').textContent = 'Clear my builds'; }, 3000); return; }
  clearArmed = false; $('clear').textContent = `Cleared ${clearPieces()} pieces`;
});
$('dream').addEventListener('input', e => { dreamTarget = +e.target.value; });
$('tod').addEventListener('input', e => { S.timeOfDay = +e.target.value; applyTime(); });
$('vol').value = store.get('hr.volume', 0.7);
sfx.setVolume(+$('vol').value);
$('vol').addEventListener('input', e => { sfx.setVolume(+e.target.value); store.set('hr.volume', +e.target.value); });
document.querySelectorAll('[data-q]').forEach(b => b.addEventListener('click', () => {
  autoQuality = b.dataset.q === 'auto'; store.set('hr.autoQuality', autoQuality);
  applyQuality(autoQuality ? quality : b.dataset.q, false);
}));

addEventListener('mousemove', e => {
  if (!S.playing) return;
  let dx = 0, dy = 0;
  if (document.pointerLockElement === canvas) { dx = e.movementX; dy = e.movementY; }
  else if (dragMode && dragging) { dx = e.clientX - lastMX; dy = e.clientY - lastMY; dragMoved += Math.abs(dx) + Math.abs(dy); lastMX = e.clientX; lastMY = e.clientY; dx *= 1.6; dy *= 1.6; }
  player.yaw -= dx * 0.0022; player.pitch = clamp(player.pitch - dy * 0.0022, -1.5, 1.5);
});
function primary() { camera.getWorldDirection(aimDir); if (tryPet(camera.position, aimDir)) return; unplace(); }
canvas.addEventListener('mousedown', e => {
  if (!S.playing) return;
  if (dragMode) { if (e.button === 0) { dragging = true; dragMoved = 0; lastMX = e.clientX; lastMY = e.clientY; } else if (e.button === 2) place(); return; }
  if (e.button === 0) primary(); else if (e.button === 2) place();
});
addEventListener('mouseup', e => { if (dragMode && dragging && e.button === 0) { dragging = false; if (dragMoved < 5) primary(); } });
canvas.addEventListener('contextmenu', e => e.preventDefault());
addEventListener('wheel', e => { if (!S.playing) return; selected = (selected + (e.deltaY > 0 ? 1 : -1) + DEFS.length) % DEFS.length; refreshBar(); }, { passive: true });
const keys = {};
addEventListener('keydown', e => {
  keys[e.code] = true;
  if (!S.playing) return;
  if (e.code === 'Space') e.preventDefault();
  if (/^Digit[0-9]$/.test(e.code)) { const n = +e.code.slice(5); selected = n === 0 ? 9 : n - 1; refreshBar(); }
  if (e.code === 'KeyR') rotIdx = (rotIdx + 1) % 4;
  if (e.code === 'KeyF') { player.fly = !player.fly; toast(player.fly ? 'Flying' : 'Walking'); }
  if (e.code === 'KeyB') { buildMode = !buildMode; refreshBar(); toast(buildMode ? 'Building' : 'Just wandering'); }
  if (e.code === 'KeyH') { hudHidden = !hudHidden; $('hud').classList.toggle('hidden', hudHidden); }
  if (e.code === 'KeyM') { sfx.setMusic(!sfx.musicOn); toast(sfx.musicOn ? 'Music on' : 'Music off'); }
  if (e.code === 'KeyV') { const i = DREAM_STEPS.findIndex(v => v > dreamTarget + 0.01); dreamTarget = i < 0 ? 0 : DREAM_STEPS[i]; toast(dreamTarget ? `Dream ${Math.round(dreamTarget * 100)}%` : 'Clear-eyed'); }
  if (e.code === 'KeyT') { timeFlow = !timeFlow; toast(timeFlow ? 'Time flowing' : 'Time held still'); }
  if (e.code === 'KeyG') { autoQuality = false; store.set('hr.autoQuality', false); applyQuality({ low: 'high', high: 'ultra', ultra: 'low' }[quality], true); }
  if (e.code === 'Escape' && dragMode) pause();
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

// automatic quality: step down once if the first few seconds run slowly
let fpsProbe = null;
function startFpsProbe() { if (autoQuality && !fpsProbe) fpsProbe = { t: 0, n: 0, done: false }; }
function probeFps(dt) {
  if (!fpsProbe || fpsProbe.done || !S.playing) return;
  fpsProbe.t += dt; fpsProbe.n++;
  if (fpsProbe.t > 6) {
    const fps = fpsProbe.n / fpsProbe.t;
    if (fps < 32 && quality !== 'low') { applyQuality(quality === 'ultra' ? 'high' : 'low', false); toast(`Switched to ${QUALITY[quality].label} graphics for smoother walking`); fpsProbe = { t: 0, n: 0, done: false }; }
    else if (fps > 58 && quality === 'high' && devicePixelRatio <= 1.5) { applyQuality('ultra', false); fpsProbe.done = true; }
    else fpsProbe.done = true;
  }
}

// ---------------------------------------------------------------- aim + placement
const ray = new THREE.Raycaster(); ray.far = 9;
const tmpV = new THREE.Vector3(), aimDir = new THREE.Vector3();
let ghost = null, ghostType = -1, aim = null;
function terrainHit(o, d, maxD) {
  let prev = 0;
  for (let t = 0.2; t <= maxD; t += 0.15) {
    const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
    if (y < getH(x, z)) {
      let a = prev, b = t;
      for (let k = 0; k < 8; k++) { const m = (a + b) / 2; if (o.y + d.y * m < getH(o.x + d.x * m, o.z + d.z * m)) b = m; else a = m; }
      const px = o.x + d.x * b, pz = o.z + d.z * b, e = 0.3;
      const n = new THREE.Vector3(getH(px - e, pz) - getH(px + e, pz), 2 * e, getH(px, pz - e) - getH(px, pz + e)).normalize();
      return { dist: b, point: new THREE.Vector3(px, o.y + d.y * b, pz), normal: n, piece: null };
    }
    prev = t;
  }
  return null;
}
function snapPos(def, x, z, rot) {
  const even = v => Math.round(v / 2) * 2, odd = v => Math.round((v - 1) / 2) * 2 + 1;
  switch (def.snap) {
    case 'tile': return [even(x), even(z)];
    case 'corner': return [odd(x), odd(z)];
    case 'edge': return rot % 2 === 0 ? [even(x), odd(z)] : [odd(x), even(z)];
    case 'cell': return [Math.floor(x) + 0.5, Math.floor(z) + 0.5];
    default: return [Math.round(x * 4) / 4, Math.round(z * 4) / 4];
  }
}
function updateAim() {
  aim = null;
  camera.getWorldDirection(aimDir);
  ray.set(camera.position, aimDir);
  const hits = ray.intersectObjects(pieceRoot.children, true).filter(h => h.object.isMesh);
  let best = terrainHit(camera.position, aimDir, 9);
  if (hits.length && (!best || hits[0].distance < best.dist)) {
    const h = hits[0];
    best = { dist: h.distance, point: h.point.clone(), normal: h.face.normal.clone().transformDirection(h.object.matrixWorld), piece: h.object.userData.piece };
  }
  if (!best || !buildMode) { if (ghost) ghost.visible = false; return; }
  const def = DEFS[selected];
  const [sx, sy, sz] = def.size, swap = rotIdx % 2 === 1;
  const ex = (swap ? sz : sx) / 2, ez = (swap ? sx : sz) / 2;
  const p = best.point.clone(), n = best.normal;
  let baseY;
  if (n.y > 0.5) { baseY = p.y; if (!best.piece) baseY = Math.round(baseY * 4) / 4 - 0.02; }
  else {
    const hn = tmpV.set(n.x, 0, n.z).normalize();
    p.addScaledVector(hn, (Math.abs(hn.x) > Math.abs(hn.z) ? ex : ez) + 0.02);
    baseY = best.piece ? best.piece.y : p.y - sy / 2;
    if (n.y < -0.5 && best.piece) baseY = best.piece.y - sy;
  }
  const [x, z] = snapPos(def, p.x, p.z, rotIdx);
  const box = pieceBox(selected, x, baseY, z, rotIdx);
  const ok = !overlapsPlayer(box) && !pieces.some(q => q.type === selected && Math.abs(q.x - x) < 0.01 && Math.abs(q.z - z) < 0.01 && Math.abs(q.y - baseY) < 0.05 && q.rot % 2 === rotIdx % 2);
  aim = { hit: best, x, y: baseY, z, ok };
  if (ghostType !== selected) {
    if (ghost) scene.remove(ghost);
    ghost = makePiece(selected, true); ghostType = selected; scene.add(ghost);
  }
  ghost.visible = true;
  ghost.position.set(x, baseY + 0.005, z); ghost.rotation.y = rotIdx * Math.PI / 2;
  ghost.traverse(o => { if (o.isMesh) o.material = ok ? MAT.ghostOk : MAT.ghostBad; });
}
function place() { if (buildMode && aim && aim.ok) addPiece(selected, aim.x, aim.y, aim.z, rotIdx); }
function unplace() { if (buildMode && aim && aim.hit.piece) removePiece(aim.hit.piece); }

// ---------------------------------------------------------------- loop
const clock = new THREE.Clock();
let elapsed = 0, riverTick = 0;
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  elapsed += dt;
  U.uTime.value = elapsed;
  S.dream = U.uDream.value = lerp(U.uDream.value, dreamTarget, 1 - Math.exp(-dt * 0.8));
  if (S.playing) {
    if (keys.KeyQ) { S.timeOfDay = (S.timeOfDay - dt * 2 + 24) % 24; applyTime(); }
    else if (keys.KeyE) { S.timeOfDay = (S.timeOfDay + dt * 2) % 24; applyTime(); }
    else if (timeFlow) { S.timeOfDay = (S.timeOfDay + dt / 240) % 24; applyTime(); }
    updatePlayer(dt, keys, camera);
    updateAim();
    probeFps(dt);
  } else {
    player.yaw += dt * 0.02;
    camera.position.set(player.pos.x, player.pos.y + player.eye, player.pos.z);
    camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
  }
  const P = player.pos;
  updateLOD(P.x, P.z, false);
  updateLeaves(dt, elapsed, P.x, P.y, P.z);
  updateMotes(dt, elapsed, P.x, P.y, P.z);
  updateFauna(dt, elapsed, P);
  updateLights(dt, elapsed, camera.position);
  updateFires(dt, camera.position);
  updateMist(elapsed, camera, scene.fog.color);
  updateSky(camera, P);
  updateWater(elapsed, S.dream);
  riverTick -= dt; if (riverTick < 0) { riverTick = 0.25; sfx.river(nearestRiverPoint(P.x, P.z)); }
  sfx.listener(camera);
  $('clock').textContent = fmtTime(S.timeOfDay);
  $('mode').textContent = (player.fly ? 'Flying' : 'Walking') + (buildMode ? ' · building' : '') + dreamName(S.dream);
  updatePost(camera, elapsed, QUALITY[quality].rays);
}

// ---------------------------------------------------------------- boot
const statusEl = $('status');
(async function init() {
  statusEl.textContent = 'Raising the ridges…'; await nextFrame();
  buildTerrain(scene);
  chooseSites();
  paintPasture([{ x: farm.penX, z: farm.penZ, r: farm.penR + 12 }, { x: farm.x, z: farm.z, r: 28 }]);
  statusEl.textContent = 'Turning the leaves…'; await nextFrame();
  createSky(scene, renderer);
  buildFlora(scene);
  updateLOD(spawn.x, spawn.z, true);
  statusEl.textContent = 'Waking the animals…'; await nextFrame();
  buildHomestead(scene);
  initLights(scene);
  buildFauna(scene);
  statusEl.textContent = 'Lighting the sky…'; await nextFrame();
  applyQuality(quality, false);
  applyTime();
  player.pos.set(spawn.x, getH(spawn.x, spawn.z), spawn.z);
  player.yaw = spawn.yaw;
  loadPieces();
  refreshBar();
  frame();
  statusEl.textContent = 'Ready when you are';
  $('go').disabled = false;
  window.__hr = { player, camera, S, applyTime, farm, spawn, LAKE, river, WATER, getH, addPiece, pieces: () => pieces, animals, faunaCounts, setTime: (h) => { S.timeOfDay = h; applyTime(); }, setDream: (d) => { dreamTarget = d; U.uDream.value = d; }, applyQuality };
})().catch(err => { statusEl.textContent = 'Something went wrong while building the world: ' + err.message; console.error(err); });
