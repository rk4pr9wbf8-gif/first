import * as THREE from "three";
import { marsTime, localSolarTime, season, fmtHours } from "./marsTime.js";
import { SITES } from "./sites.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const MARS_RADIUS_KM = 3389.5;
const HEIGHT_MIN_KM = -8.5; // mars_height.png maps 0..255 to this range
const HEIGHT_RANGE_KM = 30;
const MOON_ENLARGE = 20; // Phobos and Deimos are drawn 20x larger than life
const MOONS = [
  // semi-axes km, orbit radius km, sidereal period hours, inclination deg
  { name: "Phobos", tex: "textures/phobos.jpg", axes: [13.0, 11.4, 9.1], a: 9376, period: 7.6533, inc: 1.08 },
  { name: "Deimos", tex: "textures/deimos.jpg", axes: [7.8, 6.0, 5.1], a: 23463, period: 30.312, inc: 1.79 },
];
const SUN_AZIMUTH = THREE.MathUtils.degToRad(40); // sunlight comes from front-right
const PHONE_CAMERA_FOV = 63; // long-axis field of view of a typical phone main camera
const isTouch = matchMedia("(pointer: coarse)").matches;

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const video = $("camera");
const canvas = $("scene");
const overlay = $("overlay");
const labelsEl = $("labels");

// ---------------------------------------------------------------------------
// Renderer, scene, camera
// ---------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.xr.enabled = true;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 2000);
scene.add(camera);
scene.add(new THREE.AmbientLight(0xffe8d6, 0.06));

// system: everything that moves together when you drag or pinch (Mars, Sun light, moons)
const system = new THREE.Group();
scene.add(system);
// body: Mars itself, spun about its pole to match the real time of day
const body = new THREE.Group();
system.add(body);

const sun = new THREE.DirectionalLight(0xfff4ea, 3.2);
system.add(sun, sun.target);

// ---------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------
const manager = new THREE.LoadingManager();
const loader = new THREE.TextureLoader(manager);
const maxAniso = renderer.capabilities.getMaxAnisotropy();
const colorMap = loader.load("textures/mars_color.jpg", (t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = maxAniso; });
const normalMap = loader.load("textures/mars_normal.jpg", (t) => { t.anisotropy = maxAniso; });
const heightMap = loader.load("textures/mars_height.png");

// CPU copy of the elevation map, for reading the height under a site
let heightData = null;
const heightImg = new Image();
heightImg.src = "textures/mars_height.png";
heightImg.decode().then(() => {
  const c = document.createElement("canvas");
  c.width = heightImg.width; c.height = heightImg.height;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(heightImg, 0, 0);
  heightData = { w: c.width, h: c.height, px: ctx.getImageData(0, 0, c.width, c.height).data };
  placeLabelAnchors();
}).catch(() => {});

function elevationKm(lon, lat) {
  if (!heightData) return 0;
  const { w, h, px } = heightData;
  const x = Math.floor((((lon + 180) % 360) + 360) % 360 / 360 * w) % w;
  const y = Math.min(h - 1, Math.max(0, Math.floor((90 - lat) / 180 * h)));
  return px[(y * w + x) * 4] / 255 * HEIGHT_RANGE_KM + HEIGHT_MIN_KM;
}

// ---------------------------------------------------------------------------
// Mars
// ---------------------------------------------------------------------------
const segs = isTouch ? [512, 256] : [1024, 512];
const marsMat = new THREE.MeshStandardMaterial({
  map: colorMap,
  normalMap,
  displacementMap: heightMap,
  roughness: 0.96,
  metalness: 0,
});
const mars = new THREE.Mesh(new THREE.SphereGeometry(1, segs[0], segs[1]), marsMat);
body.add(mars);

let relief = 10;
function applyRelief() {
  // height texel v (0..1) -> km = v*30 - 8.5 -> radius units, times exaggeration
  marsMat.displacementScale = (HEIGHT_RANGE_KM / MARS_RADIUS_KM) * relief;
  marsMat.displacementBias = (HEIGHT_MIN_KM / MARS_RADIUS_KM) * relief;
  marsMat.normalScale.setScalar(1 + relief * 0.04);
  placeLabelAnchors();
}

// Thin dusty atmosphere: a fresnel rim, brighter on the day side
const atmoUniforms = { uSun: { value: new THREE.Vector3(1, 0, 0) } };
const atmosphere = new THREE.Mesh(
  new THREE.SphereGeometry(1.03, 96, 48),
  new THREE.ShaderMaterial({
    uniforms: atmoUniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      varying vec3 vN; varying vec3 vP;
      void main() {
        vN = normalize(normalMatrix * normal);
        vec4 p = modelViewMatrix * vec4(position, 1.0);
        vP = p.xyz;
        gl_Position = projectionMatrix * p;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uSun; varying vec3 vN; varying vec3 vP;
      void main() {
        vec3 v = normalize(-vP);
        float rim = pow(1.0 - max(dot(vN, v), 0.0), 3.0);
        float day = smoothstep(-0.3, 0.5, dot(vN, uSun));
        vec3 col = mix(vec3(0.95, 0.55, 0.35), vec3(0.85, 0.72, 0.62), rim);
        gl_FragColor = vec4(col * rim * day * 0.85, 1.0);
      }`,
  })
);
system.add(atmosphere);

// ---------------------------------------------------------------------------
// Moons
// ---------------------------------------------------------------------------
const moonPivots = MOONS.map((m) => {
  const pivot = new THREE.Group();
  pivot.rotation.x = THREE.MathUtils.degToRad(m.inc);
  const spin = new THREE.Group();
  pivot.add(spin);
  const tex = loader.load(m.tex, (t) => { t.colorSpace = THREE.SRGBColorSpace; });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }));
  const k = MOON_ENLARGE / MARS_RADIUS_KM;
  mesh.scale.set(m.axes[0] * k, m.axes[2] * k, m.axes[1] * k); // long axis toward Mars
  mesh.position.x = m.a / MARS_RADIUS_KM;
  mesh.rotation.y = Math.PI; // 0° longitude (the sub-Mars point) faces Mars
  spin.add(mesh);
  system.add(pivot);
  return { ...m, pivot, spin };
});

// ---------------------------------------------------------------------------
// Background stars (only when the camera is off)
// ---------------------------------------------------------------------------
const stars = (() => {
  const n = 3000, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(900);
    pos.set([v.x, v.y, v.z], i * 3);
    const b = 0.35 + Math.pow(Math.random(), 3) * 0.65, warm = Math.random() * 0.15;
    col.set([b, b * (0.95 - warm * 0.3), b * (0.92 - warm)], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return new THREE.Points(g, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true }));
})();
scene.add(stars);

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------
// Direction from Mars' centre in body space. SphereGeometry puts 0° E at +X and 90° E at -Z.
function lonLatDir(lon, lat, out = new THREE.Vector3()) {
  const lo = THREE.MathUtils.degToRad(lon), la = THREE.MathUtils.degToRad(lat);
  return out.set(Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo));
}
const fmtLat = (lat) => `${Math.abs(lat).toFixed(2)}° ${lat >= 0 ? "N" : "S"}`;
const fmtLon = (lon) => `${Math.abs(lon).toFixed(2)}° ${lon >= 0 ? "E" : "W"}`;

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------
let simMs = Date.now();
let speed = 1;
let frozenPhaseMs = null; // in "Seasons" mode the planet stops spinning so it doesn't strobe
let mt = marsTime(new Date(simMs));

function updateSunAndSpin() {
  mt = marsTime(new Date(simMs));
  const phaseT = frozenPhaseMs != null ? marsTime(new Date(frozenPhaseMs)) : mt;
  const dec = THREE.MathUtils.degToRad(mt.subLat);
  // Sun direction in the system frame (pole = +Y), elevated by the subsolar latitude
  const L = new THREE.Vector3(Math.cos(dec) * Math.cos(SUN_AZIMUTH), Math.sin(dec), Math.cos(dec) * Math.sin(SUN_AZIMUTH));
  sun.position.copy(L).multiplyScalar(10);
  // Spin Mars so the subsolar longitude lies under the Sun
  const sunAz = Math.atan2(-L.z, L.x);
  const subLon = frozenPhaseMs != null ? phaseT.subLon : mt.subLon;
  body.rotation.y = sunAz - THREE.MathUtils.degToRad(subLon);
  // Moons advance along their orbits with the clock that drives the spin
  const tHours = (frozenPhaseMs ?? simMs) / 3.6e6;
  for (const m of moonPivots) m.spin.rotation.y = ((tHours / m.period) % 1) * Math.PI * 2;
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------
let labelsOn = true;
let selected = null;
const labelItems = SITES.map((s) => {
  const el = document.createElement("button");
  el.className = `label ${s.kind}`;
  el.type = "button";
  el.innerHTML = `<span class="pin"></span><span></span>`;
  el.lastChild.textContent = s.name;
  el.addEventListener("click", (e) => { e.stopPropagation(); selectSite(s); });
  el.addEventListener("beforexrselect", (e) => e.preventDefault());
  labelsEl.append(el);
  return { site: s, el, local: new THREE.Vector3(), normal: lonLatDir(s.lon, s.lat) };
});

function placeLabelAnchors() {
  for (const it of labelItems) {
    const r = 1 + (elevationKm(it.site.lon, it.site.lat) / MARS_RADIUS_KM) * relief + 0.004;
    it.local.copy(it.normal).multiplyScalar(r);
  }
}
placeLabelAnchors();
labelsEl.hidden = true; // shown once the HUD is up

const _w = new THREE.Vector3(), _n = new THREE.Vector3(), _toCam = new THREE.Vector3(), _camPos = new THREE.Vector3();
const _nm = new THREE.Matrix3();
function updateLabels(cam) {
  if (labelsEl.hidden) return;
  const w = overlay.clientWidth, h = overlay.clientHeight;
  cam.getWorldPosition(_camPos);
  _nm.getNormalMatrix(body.matrixWorld);
  for (const it of labelItems) {
    _w.copy(it.local).applyMatrix4(body.matrixWorld);
    _n.copy(it.normal).applyMatrix3(_nm).normalize();
    _toCam.subVectors(_camPos, _w).normalize();
    it.facing = _n.dot(_toCam);
    _w.project(cam);
    it.x = (_w.x * 0.5 + 0.5) * w;
    it.y = (-_w.y * 0.5 + 0.5) * h;
    it.visible = it.facing > 0.08 && _w.z < 1 && Math.abs(_w.x) < 1.1 && Math.abs(_w.y) < 1.1;
  }
  // Declutter: the selected site first, then the ones facing you most squarely
  const order = labelItems.filter((it) => it.visible).sort((a, b) => (b.site === selected) - (a.site === selected) || b.facing - a.facing);
  const boxes = [];
  for (const it of labelItems) it.shown = false;
  for (const it of order) {
    if (!it.w) it.w = it.el.offsetWidth;
    const box = { l: it.x - 8, t: it.y - 11, r: it.x - 8 + (it.w || 90), b: it.y + 11 };
    if (boxes.some((o) => box.l < o.r && box.r > o.l && box.t < o.b && box.b > o.t)) continue;
    boxes.push(box);
    it.shown = true;
  }
  for (const it of labelItems) {
    if (!it.shown) { it.el.style.opacity = "0"; it.el.style.pointerEvents = "none"; continue; }
    it.el.style.transform = `translate(${it.x - 8}px, ${it.y - 10}px)`;
    it.el.style.opacity = String(Math.min(1, (it.facing - 0.08) * 5));
    it.el.style.pointerEvents = "auto";
  }
}

function setLabels(on) {
  labelsOn = on;
  labelsEl.hidden = !on;
  $("btn-labels").setAttribute("aria-pressed", String(on));
}

// ---------------------------------------------------------------------------
// Site card
// ---------------------------------------------------------------------------
function selectSite(s) {
  selected = s;
  for (const it of labelItems) it.el.classList.toggle("active", it.site === s);
  const card = $("site-card");
  card.hidden = false;
  card.classList.toggle("lander", s.kind === "lander");
  $("site-kind").textContent = s.type;
  $("site-name").textContent = s.name;
  $("site-text").textContent = s.text;
  updateSiteCard();
}
function closeSite() {
  selected = null;
  $("site-card").hidden = true;
  for (const it of labelItems) it.el.classList.remove("active");
}

function sunElevationAt(lon, lat) {
  const H = THREE.MathUtils.degToRad((localSolarTime(mt, lon) - 12) * 15);
  const p = THREE.MathUtils.degToRad(lat), d = THREE.MathUtils.degToRad(mt.subLat);
  return THREE.MathUtils.radToDeg(Math.asin(Math.sin(p) * Math.sin(d) + Math.cos(p) * Math.cos(d) * Math.cos(H)));
}

function updateSiteCard() {
  if (!selected) return;
  const s = selected;
  const el = elevationKm(s.lon, s.lat);
  const sunEl = sunElevationAt(s.lon, s.lat);
  const rows = [
    ["Location", `${fmtLat(s.lat)}<br>${fmtLon(s.lon)}`],
    ["Local solar time", `${fmtHours(localSolarTime(mt, s.lon))}<br>${sunEl > 0 ? `Sun ${sunEl.toFixed(0)}° up` : "Night"}`],
    s.landed ? ["Landed", s.landed] : ["Elevation", `${el >= 0 ? "+" : "−"}${Math.abs(el).toFixed(1)} km`],
  ];
  $("site-data").innerHTML = rows.map(([k, v]) => `<div><dt>${k}</dt><dd class="mono">${v}</dd></div>`).join("");
}
$("site-close").addEventListener("click", closeSite);

// ---------------------------------------------------------------------------
// Readouts
// ---------------------------------------------------------------------------
function updateReadouts() {
  $("clock-mtc").textContent = fmtHours(mt.mtc);
  $("clock-sol").textContent = Math.floor(mt.msd).toLocaleString("en-US");
  $("ro-ls").textContent = `${mt.Ls.toFixed(1)}°`;
  $("ro-season").textContent = season(mt.Ls).north;
  $("ro-sub").textContent = `${fmtLat(mt.subLat).replace(/\.\d+/, (m) => m.slice(0, 2))}, ${fmtLon(mt.subLon).replace(/\.\d+/, (m) => m.slice(0, 2))}`;
  const d = new Date(simMs);
  $("ro-utc").textContent = `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} UTC`;
  updateSiteCard();
}

// ---------------------------------------------------------------------------
// Placement and device orientation
// ---------------------------------------------------------------------------
let mode = "intro"; // intro | camera | space | xr
let dist = 4;
const anchorDir = new THREE.Vector3(0, 0, -1);
const deviceQuat = new THREE.Quaternion();
let haveOrientation = false;
let ori = null;

const zee = new THREE.Vector3(0, 0, 1);
const qScreen = new THREE.Quaternion();
const qWorld = new THREE.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2); // camera looks out the back of the device
const euler = new THREE.Euler();
function orientationToQuat(o, out) {
  const d2r = THREE.MathUtils.DEG2RAD;
  const screenAngle = (screen.orientation?.angle ?? window.orientation ?? 0) * d2r;
  euler.set(o.beta * d2r, o.alpha * d2r, -o.gamma * d2r, "YXZ");
  out.setFromEuler(euler).multiply(qWorld).multiply(qScreen.setFromAxisAngle(zee, -screenAngle));
  return out;
}
function onOrientation(e) {
  if (e.alpha == null && e.beta == null) return;
  ori = { alpha: e.alpha ?? 0, beta: e.beta ?? 0, gamma: e.gamma ?? 0 };
  orientationToQuat(ori, deviceQuat);
  if (!haveOrientation) {
    haveOrientation = true;
    camera.quaternion.copy(deviceQuat);
    recenter();
  }
}

function fitDistance() {
  // place Mars so it fills about 60% of the narrower side of the screen
  const vfov = THREE.MathUtils.degToRad(camera.fov);
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
  return 1 / Math.sin(Math.min(vfov, hfov) * 0.3);
}

function recenter() {
  if (mode === "xr") { placeInFrontXR(); return; }
  camera.getWorldDirection(anchorDir);
  dist = fitDistance();
  system.position.copy(camera.position).addScaledVector(anchorDir, dist);
}

async function requestMotion() {
  if (typeof DeviceOrientationEvent === "undefined") return false;
  if (typeof DeviceOrientationEvent.requestPermission === "function") {
    try {
      if ((await DeviceOrientationEvent.requestPermission()) !== "granted") return false;
    } catch { return false; }
  }
  window.addEventListener("deviceorientation", onOrientation);
  return true;
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("insecure");
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
  });
  video.srcObject = stream;
  video.hidden = false;
  await video.play().catch(() => {});
}

// ---------------------------------------------------------------------------
// WebXR (room-scale AR on supported Android phones)
// ---------------------------------------------------------------------------
let xrHitSource = null;
let xrScale = 0.18; // Mars about 36 cm across
const reticle = new THREE.Mesh(
  new THREE.RingGeometry(0.06, 0.075, 40).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xe48a5c })
);
reticle.matrixAutoUpdate = false;
reticle.visible = false;
scene.add(reticle);

function placeInFrontXR() {
  const xrCam = renderer.xr.getCamera();
  const p = new THREE.Vector3(), d = new THREE.Vector3();
  xrCam.getWorldPosition(p);
  xrCam.getWorldDirection(d);
  d.y = 0;
  if (d.lengthSq() < 1e-4) d.set(0, 0, -1);
  d.normalize();
  system.position.copy(p).addScaledVector(d, 1.0);
  system.position.y = p.y - 0.1;
}

async function startXR() {
  const session = await navigator.xr.requestSession("immersive-ar", {
    requiredFeatures: ["local"],
    optionalFeatures: ["hit-test", "dom-overlay"],
    domOverlay: { root: overlay },
  });
  mode = "xr";
  document.body.classList.add("xr");
  renderer.xr.setReferenceSpaceType("local");
  await renderer.xr.setSession(session);
  stars.visible = false;
  system.scale.setScalar(xrScale);
  system.position.set(0, -0.1, -1.0);
  try {
    const viewer = await session.requestReferenceSpace("viewer");
    xrHitSource = await session.requestHitTestSource({ space: viewer });
  } catch { xrHitSource = null; }
  session.addEventListener("select", () => {
    if (gesture.moved || !reticle.visible) return;
    system.position.setFromMatrixPosition(reticle.matrix);
    system.position.y += xrScale * 1.15;
    toast("Mars placed. Walk around it.");
  });
  session.addEventListener("end", () => {
    xrHitSource = null;
    reticle.visible = false;
    document.body.classList.remove("xr");
    system.scale.setScalar(1);
    mode = "space";
    enterHud();
    stars.visible = true;
    camera.position.set(0, 0, 0);
    camera.quaternion.identity();
    recenter();
  });
  enterHud();
  $("hint").textContent = "Tap a surface to place Mars · drag to spin · pinch to resize";
  toast(xrHitSource ? "Point at the floor or a table, then tap to place." : "Mars is in front of you. Walk around it.");
}

// ---------------------------------------------------------------------------
// Gestures: one finger spins Mars, two fingers zoom
// ---------------------------------------------------------------------------
const gesture = { pts: new Map(), moved: false, startDist: 0, startZoom: 0, vx: 0, vy: 0 };
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _ax = new THREE.Vector3();

function viewCam() { return renderer.xr.isPresenting ? renderer.xr.getCamera() : camera; }

function spin(dx, dy) {
  const cam = viewCam();
  _ax.set(0, 1, 0).applyQuaternion(cam.getWorldQuaternion(_qb));
  _qa.setFromAxisAngle(_ax, dx * 0.006);
  system.quaternion.premultiply(_qa);
  _ax.set(1, 0, 0).applyQuaternion(_qb);
  _qa.setFromAxisAngle(_ax, dy * 0.006);
  system.quaternion.premultiply(_qa);
}

function setZoom(z) {
  if (mode === "xr") {
    xrScale = THREE.MathUtils.clamp(z, 0.04, 1.5);
    system.scale.setScalar(xrScale);
  } else {
    dist = THREE.MathUtils.clamp(z, 1.35, 30);
    system.position.copy(camera.position).addScaledVector(anchorDir, dist);
  }
}
const zoomValue = () => (mode === "xr" ? xrScale : dist);
const pinchSpan = () => { const [a, b] = [...gesture.pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };

function onDown(e) {
  if (e.target.closest(".sheet, header, .label, button")) return;
  gesture.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (gesture.pts.size === 1) gesture.moved = false;
  if (gesture.pts.size === 2) { gesture.startDist = pinchSpan(); gesture.startZoom = zoomValue(); }
  gesture.vx = gesture.vy = 0;
}
function onMove(e) {
  const p = gesture.pts.get(e.pointerId);
  if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  if (Math.abs(dx) + Math.abs(dy) > 2) gesture.moved = true;
  if (gesture.pts.size === 1) {
    spin(dx, dy);
    gesture.vx = dx; gesture.vy = dy;
  } else if (gesture.pts.size === 2) {
    const r = pinchSpan() / gesture.startDist;
    setZoom(mode === "xr" ? gesture.startZoom * r : gesture.startZoom / r);
  }
}
function onUp(e) {
  gesture.pts.delete(e.pointerId);
  if (gesture.pts.size === 2) { gesture.startDist = pinchSpan(); gesture.startZoom = zoomValue(); }
  setTimeout(() => { if (!gesture.pts.size) gesture.moved = false; }, 300);
}
for (const target of [canvas, overlay]) {
  target.addEventListener("pointerdown", onDown);
}
window.addEventListener("pointermove", onMove);
window.addEventListener("pointerup", onUp);
window.addEventListener("pointercancel", onUp);
canvas.addEventListener("wheel", (e) => { e.preventDefault(); setZoom(zoomValue() * Math.exp(e.deltaY * (mode === "xr" ? -0.001 : 0.001))); }, { passive: false });

// ---------------------------------------------------------------------------
// UI wiring
// ---------------------------------------------------------------------------
let toastTimer;
function toast(msg, ms = 3500) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}

function enterHud() {
  $("intro").hidden = true;
  $("hud-top").hidden = false;
  $("hud-bottom").hidden = false;
  labelsEl.hidden = !labelsOn;
  for (const el of document.querySelectorAll(".sheet, header")) el.addEventListener("beforexrselect", (e) => e.preventDefault());
}

$("btn-ar").addEventListener("click", async () => {
  const motion = requestMotion(); // must be the first call inside the tap on iOS
  let cameraOk = true;
  try { await startCamera(); } catch (err) { cameraOk = false; }
  const motionOk = await motion;
  mode = cameraOk ? "camera" : "space";
  stars.visible = !cameraOk;
  scene.background = null;
  enterHud();
  onResize();
  recenter();
  setTimeout(() => {
    if (!haveOrientation) toast(motionOk ? "No motion sensor found. Drag to spin Mars." : "Motion access was declined. Drag to spin Mars.", 4500);
  }, 1500);
  if (!cameraOk) toast(location.protocol === "https:" || location.hostname === "localhost"
    ? "Camera unavailable, showing Mars in space instead."
    : "The camera needs an https:// address. Showing Mars in space instead.", 4500);
});

$("btn-space").addEventListener("click", async () => {
  mode = "space";
  stars.visible = true;
  enterHud();
  onResize();
  recenter();
  if (isTouch) requestMotion();
});

$("btn-xr").addEventListener("click", () => startXR().catch((err) => toast(`Room-scale AR could not start: ${err.message}`)));

$("btn-labels").addEventListener("click", () => setLabels(!labelsOn));
$("btn-moons").addEventListener("click", (e) => {
  const on = e.currentTarget.getAttribute("aria-pressed") !== "true";
  e.currentTarget.setAttribute("aria-pressed", String(on));
  for (const m of moonPivots) m.pivot.visible = on;
  if (on) toast("Phobos and Deimos at true distance, drawn 20× larger. Deimos is far out: look around for it.", 5000);
});
$("btn-recenter").addEventListener("click", recenter);

for (const b of document.querySelectorAll(".seg button")) {
  b.addEventListener("click", () => {
    for (const o of document.querySelectorAll(".seg button")) o.setAttribute("aria-checked", String(o === b));
    speed = Number(b.dataset.speed);
    frozenPhaseMs = speed > 10000 ? simMs : null;
    if (speed === 1) simMs = Date.now();
  });
}

$("relief").addEventListener("input", (e) => {
  relief = Number(e.target.value);
  $("relief-val").textContent = `${relief}×`;
  applyRelief();
});

// ---------------------------------------------------------------------------
// Resize and render loop
// ---------------------------------------------------------------------------
function onResize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  if (mode === "camera") {
    // match the phone's camera so Mars sits naturally in the video
    camera.fov = w < h ? PHONE_CAMERA_FOV : THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(PHONE_CAMERA_FOV / 2)) / camera.aspect));
  } else {
    camera.fov = w < h ? 60 : 45;
  }
  camera.updateProjectionMatrix();
}
addEventListener("resize", onResize);
screen.orientation?.addEventListener?.("change", () => setTimeout(onResize, 200));

const _sunView = new THREE.Vector3();
let last = performance.now(), lastReadout = 0;
function tick(now, frame) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  simMs = speed === 1 ? Date.now() : simMs + dt * 1000 * speed;
  updateSunAndSpin();

  // spin inertia after a flick
  if (!gesture.pts.size && (Math.abs(gesture.vx) + Math.abs(gesture.vy) > 0.05)) {
    spin(gesture.vx, gesture.vy);
    gesture.vx *= 0.92; gesture.vy *= 0.92;
  }

  if (mode !== "xr" && haveOrientation) camera.quaternion.slerp(deviceQuat, 0.35);

  if (frame && xrHitSource) {
    const hits = frame.getHitTestResults(xrHitSource);
    const pose = hits.length ? hits[0].getPose(renderer.xr.getReferenceSpace()) : null;
    reticle.visible = !!pose;
    if (pose) reticle.matrix.fromArray(pose.transform.matrix);
  }

  // sun direction in view space for the atmosphere shader
  const cam = viewCam();
  cam.updateMatrixWorld();
  _sunView.copy(sun.position).normalize().transformDirection(system.matrixWorld).transformDirection(cam.matrixWorldInverse);
  atmoUniforms.uSun.value.copy(_sunView);

  renderer.render(scene, camera);
  updateLabels(renderer.xr.isPresenting ? (cam.cameras?.[0] ?? cam) : camera);

  if (now - lastReadout > 250 && mode !== "intro") { updateReadouts(); lastReadout = now; }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
applyRelief();
onResize();
camera.position.set(0, 0, 0);
recenter();
system.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.25); // tip the north pole slightly toward you
updateSunAndSpin();
$("intro-sol").textContent = Math.floor(mt.msd).toLocaleString("en-US");
$("intro-my").textContent = mt.marsYear;
scene.background = null;
renderer.setClearColor(0x000000, 0);
renderer.setAnimationLoop(tick);

const startButtons = [$("btn-ar"), $("btn-space"), $("btn-xr")];
startButtons.forEach((b) => (b.disabled = true));
manager.onProgress = (_url, done, total) => { $("load-status").textContent = `Loading Mars maps… ${done}/${total}`; };
manager.onLoad = () => {
  startButtons.forEach((b) => (b.disabled = false));
  $("load-status").hidden = true;
};
manager.onError = (url) => { $("load-status").textContent = `Could not load ${url}. Reload to try again.`; };

if (navigator.xr?.isSessionSupported) {
  navigator.xr.isSessionSupported("immersive-ar").then((ok) => { $("btn-xr").hidden = !ok; }).catch(() => {});
}
if (!window.isSecureContext) {
  $("intro-note").textContent = "Open this page over https:// to use the camera and motion sensors.";
}
