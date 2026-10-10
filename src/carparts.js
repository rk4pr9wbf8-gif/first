// Procedural aftermarket parts, all in car space: +z forward, +y up,
// +x = the car's left. Dimensions are fitted to the 458 body via `fit`
// (surface heights measured by ray casts against the body shell).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const mats = {
  carbon: new THREE.MeshPhysicalMaterial({ color: 0x141518, metalness: 0.3, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.05 }),
  black: new THREE.MeshStandardMaterial({ color: 0x0d0d0f, roughness: 0.55 }),
  alu: new THREE.MeshStandardMaterial({ color: 0x9a9ca0, metalness: 1, roughness: 0.35 }),
  cage: new THREE.MeshPhysicalMaterial({ color: 0x1b1c1f, metalness: 0.6, roughness: 0.35, clearcoat: 0.6 }),
  harness: new THREE.MeshStandardMaterial({ color: 0xc8161d, roughness: 0.8 }),
};

const X = new THREE.Vector3(1, 0, 0);

// ------------------------------------------------------------------ wheels
// Built facing +x (outer face), centred on the hub.
export function makeRim(design, R = 0.27, W = 0.23, mat, darkMat) {
  const g = new THREE.Group();
  const parts = [];
  const inner = [];
  const push = (geo, m = 'face') => (m === 'face' ? parts : inner).push(geo);
  const dish = design === 'dish' ? 0.07 : design === 'mono' ? 0.03 : 0.015;
  const faceX = W / 2 - dish;
  // barrel + outer lip
  const barrel = new THREE.CylinderGeometry(R, R, W, 40, 1, true); barrel.rotateZ(Math.PI / 2);
  push(barrel, 'inner');
  const lip = new THREE.TorusGeometry(R - 0.004, 0.012, 8, 48); lip.rotateY(Math.PI / 2); lip.translate(W / 2, 0, 0);
  push(lip);
  if (dish > 0.03) { // polished step from lip to face
    const step = new THREE.CylinderGeometry(R - 0.005, R - 0.03, dish, 40, 1, true); step.rotateZ(Math.PI / 2); step.translate(W / 2 - dish / 2, 0, 0);
    push(step);
  }
  // spokes in the YZ plane
  const spoke = (ang, w0, w1, r0, r1, depth = 0.035, twist = 0, xoff = 0) => {
    const s = new THREE.Shape();
    s.moveTo(r0, -w0 / 2); s.lineTo(r1, -w1 / 2 + twist); s.lineTo(r1, w1 / 2 + twist); s.lineTo(r0, w0 / 2); s.closePath();
    const geo = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.005, bevelSegments: 2 });
    // shape x -> radial (y), shape y -> z, extrude -> x
    geo.rotateY(-Math.PI / 2); geo.rotateX(ang);
    geo.translate(faceX - depth + xoff, 0, 0);
    push(geo);
  };
  const hubR = design === 'center' ? 0.085 : 0.07;
  const n = { stock: 5, five: 5, ten: 10, mesh: 0, turbine: 14, dish: 6, y: 5, mono: 7, center: 10 }[design] ?? 5;
  const TAU = Math.PI * 2;
  if (design === 'stock') for (let i = 0; i < 5; i++) { spoke(i * TAU / 5, 0.07, 0.05, hubR, R - 0.01); spoke(i * TAU / 5 + 0.08, 0.012, 0.02, R * 0.55, R - 0.01, 0.03, 0.02, -0.004); }
  if (design === 'five') for (let i = 0; i < 5; i++) spoke(i * TAU / 5, 0.085, 0.062, hubR, R - 0.01, 0.045);
  if (design === 'ten') for (let i = 0; i < 5; i++) for (const o of [-0.13, 0.13]) spoke(i * TAU / 5 + o, 0.04, 0.034, hubR, R - 0.01, 0.035, 0);
  if (design === 'mono') for (let i = 0; i < 7; i++) spoke(i * TAU / 7, 0.07, 0.04, hubR, R - 0.01, 0.05);
  if (design === 'dish') for (let i = 0; i < 6; i++) spoke(i * TAU / 6, 0.06, 0.05, hubR, R - 0.03, 0.03);
  if (design === 'center') for (let i = 0; i < 10; i++) spoke(i * TAU / 10, 0.035, 0.028, hubR, R - 0.01, 0.03);
  if (design === 'turbine') for (let i = 0; i < 14; i++) spoke(i * TAU / 14, 0.03, 0.03, hubR, R - 0.01, 0.025, 0.05);
  if (design === 'y') for (let i = 0; i < 5; i++) {
    spoke(i * TAU / 5, 0.06, 0.05, hubR, R * 0.6, 0.04);
    spoke(i * TAU / 5 - 0.12, 0.03, 0.03, R * 0.55, R - 0.01, 0.035, -0.01);
    spoke(i * TAU / 5 + 0.12, 0.03, 0.03, R * 0.55, R - 0.01, 0.035, 0.01);
  }
  if (design === 'mesh') {
    for (let i = 0; i < 10; i++) {
      spoke(i * TAU / 10, 0.022, 0.022, hubR, R - 0.01, 0.022, 0.06);
      spoke(i * TAU / 10, 0.022, 0.022, hubR, R - 0.01, 0.022, -0.06, -0.012);
    }
    const ring = new THREE.TorusGeometry(R * 0.62, 0.008, 6, 40); ring.rotateY(Math.PI / 2); ring.translate(faceX - 0.01, 0, 0); push(ring);
  }
  // hub, nuts / centre lock
  const hub = new THREE.CylinderGeometry(hubR, hubR, 0.05, 24); hub.rotateZ(Math.PI / 2); hub.translate(faceX - 0.02, 0, 0); push(hub);
  if (design === 'center') {
    const nut = new THREE.CylinderGeometry(0.045, 0.045, 0.05, 6); nut.rotateZ(Math.PI / 2); nut.translate(faceX + 0.015, 0, 0); push(nut);
  } else for (let i = 0; i < 5; i++) {
    const nut = new THREE.CylinderGeometry(0.011, 0.011, 0.03, 6); nut.rotateZ(Math.PI / 2);
    nut.translate(faceX + 0.008, Math.cos(i * TAU / 5) * 0.048, Math.sin(i * TAU / 5) * 0.048); push(nut);
  }
  // inner face disc so you can't see through to the tyre bead
  const back = new THREE.CircleGeometry(R - 0.002, 40); back.rotateY(-Math.PI / 2); back.translate(-W / 2 + 0.02, 0, 0); push(back, 'inner');
  const face = new THREE.Mesh(mergeGeometries(parts.map(p => p.index ? p.toNonIndexed() : p).map(p => { p.deleteAttribute('uv'); return p; })), mat);
  const inn = new THREE.Mesh(mergeGeometries(inner.map(p => p.index ? p.toNonIndexed() : p).map(p => { p.deleteAttribute('uv'); return p; })), darkMat);
  face.castShadow = inn.castShadow = true;
  g.add(face, inn);
  return g;
}

export function makeCaliper(mat, R = 0.27) {
  const s = new THREE.Shape();
  s.absarc(0, 0, R * 0.86, Math.PI * 0.12, Math.PI * 0.62, false);
  s.absarc(0, 0, R * 0.58, Math.PI * 0.62, Math.PI * 0.12, true);
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 2, curveSegments: 12 });
  geo.rotateY(Math.PI / 2); geo.translate(-0.02, 0, 0);
  const m = new THREE.Mesh(geo, mat); m.castShadow = true;
  return m;
}

// ------------------------------------------------------------------ body kit
function extrudeAlongX(shape, len, mat, bevel = 0.004) {
  const geo = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 10 });
  geo.translate(0, 0, -len / 2); geo.rotateY(Math.PI / 2); // shape (z,y) profile, span along x
  const m = new THREE.Mesh(geo, mat); m.castShadow = true;
  return m;
}
// shape coordinates: (u = -z, v = y) after rotateY(+90°) maps shape x -> -z
const prof = (pts) => { const s = new THREE.Shape(); pts.forEach(([z, y], i) => (i ? s.lineTo(-z, y) : s.moveTo(-z, y))); s.closePath(); return s; };

function airfoil(chord, thick, camber = 0.04) {
  const s = new THREE.Shape(); const N = 14;
  const top = [], bot = [];
  for (let i = 0; i <= N; i++) {
    const x = i / N, t = 5 * thick * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1015 * x ** 4);
    const c = camber * 4 * x * (1 - x);
    top.push([x * chord, (c + t) * chord]); bot.push([x * chord, (c - t) * chord]);
  }
  // leading edge at +z (front), trailing toward -z; underside cambered (inverted wing)
  [...top].forEach(([x, y], i) => (i ? s.lineTo(-x, -y) : s.moveTo(-x, -y)));
  [...bot].reverse().forEach(([x, y]) => s.lineTo(-x, -y));
  s.closePath();
  return s;
}

export function buildKit(look, parts, fit) {
  const g = new THREE.Group();
  const W = fit.halfW;
  const front = parts.front, rear = parts.rear;
  // front: lip / splitter / canards
  if (front !== 'stock') {
    const ext = front === 'lip' ? 0.05 : 0.13;
    const z0 = fit.frontZ - 0.32, z1 = fit.frontZ + ext;
    const y = fit.frontLow + 0.005;
    const lip = extrudeAlongX(prof([[z0, y], [z1, y], [z1, y + 0.012], [z0 + 0.1, y + 0.03], [z0, y + 0.03]]), W * 2 * 0.86, mats.carbon);
    g.add(lip);
    if (front !== 'lip') {
      for (const sx of [-1, 1]) {
        const ep = extrudeAlongX(prof([[z0 + 0.15, y], [z1, y], [z1 - 0.02, y + 0.09], [z0 + 0.15, y + 0.11]]), 0.01, mats.carbon, 0);
        ep.position.x = sx * W * 0.86; g.add(ep);
      }
    }
    if (front === 'canards') for (const sx of [-1, 1]) for (const [dy, len] of [[0.12, 0.2], [0.22, 0.15]]) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.008, len), mats.carbon);
      c.position.set(sx * (W - 0.06), fit.frontLow + dy, fit.frontZ - 0.16);
      c.rotation.set(0.12, sx * 0.25, -sx * 0.18); c.castShadow = true;
      g.add(c);
    }
  }
  // side skirts
  if (parts.skirts === 'carbon') for (const sx of [-1, 1]) {
    const len = fit.wheelbase - 0.95;
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, len), mats.carbon);
    skirt.position.set(sx * (W - 0.035 + (look.widebody ? 0.05 : 0)), fit.sillY, fit.midZ);
    skirt.castShadow = true;
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.008, len * 0.92), mats.carbon);
    fin.position.set(sx * (W + 0.005 + (look.widebody ? 0.05 : 0)), fit.sillY - 0.03, fit.midZ);
    g.add(skirt, fin);
  }
  // diffuser
  if (parts.diffuser === 'race') {
    const z = fit.rearZ + 0.04;
    const plate = new THREE.Mesh(new THREE.BoxGeometry(W * 1.5, 0.012, 0.45), mats.carbon);
    plate.position.set(0, fit.rearLow + 0.02, z + 0.2); plate.rotation.x = -0.18;
    g.add(plate);
    for (let i = -3; i <= 3; i++) {
      const fin = extrudeAlongX(prof([[z + 0.42, fit.rearLow + 0.03], [z - 0.02, fit.rearLow + 0.12], [z - 0.02, fit.rearLow - 0.02], [z + 0.42, fit.rearLow - 0.0]]), 0.008, mats.carbon, 0);
      fin.position.x = i * W * 0.22; g.add(fin);
    }
  }
  // rear wing / spoiler
  const deckY = fit.deckY, deckZ = fit.deckZ;
  if (rear === 'ducktail') {
    const d = extrudeAlongX(prof([[deckZ + 0.12, deckY - 0.01], [deckZ - 0.08, deckY + 0.07], [deckZ - 0.1, deckY + 0.055], [deckZ + 0.1, deckY - 0.025]]), W * 1.55, mats.carbon);
    g.add(d);
  } else if (rear === 'gt' || rear === 'swan' || rear === 'attack') {
    const big = rear === 'attack';
    const h = big ? 0.48 : 0.38, chord = big ? 0.36 : 0.28, span = big ? W * 2.05 : W * 1.75;
    const wy = deckY + h, wz = deckZ - 0.12;
    const wing = extrudeAlongX(airfoil(chord, 0.11, 0.06), span, mats.carbon);
    wing.position.set(0, wy, wz + chord / 2); wing.rotation.x = -0.12;
    g.add(wing);
    if (big) { const flap = extrudeAlongX(airfoil(chord * 0.45, 0.08, 0.08), span, mats.carbon); flap.position.set(0, wy + 0.08, wz - chord * 0.42); flap.rotation.x = -0.45; g.add(flap); }
    for (const sx of [-1, 1]) {
      const ep = new THREE.Mesh(new THREE.BoxGeometry(0.008, big ? 0.32 : 0.2, chord * (big ? 1.8 : 1.35)), mats.carbon);
      ep.position.set(sx * span / 2, wy + 0.02, wz); ep.castShadow = true; g.add(ep);
      // uprights
      const upr = new THREE.Group();
      if (rear === 'swan') {
        const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, deckY - 0.02, deckZ + 0.15), new THREE.Vector3(0, wy + 0.1, deckZ + 0.05), new THREE.Vector3(0, wy + 0.06, wz - 0.02)]);
        const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.014, 6), mats.alu);
        tube.scale.set(1, 1, 1); upr.add(tube);
      } else {
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.012, h, 0.12), mats.alu);
        p.position.set(0, deckY + h / 2 - 0.02, wz + 0.04); p.rotation.x = 0.15; upr.add(p);
      }
      upr.position.x = sx * W * 0.42; upr.traverse(o => { o.castShadow = true; }); g.add(upr);
    }
  }
  // widebody fender flares
  if (look.widebody) for (const w of fit.wheels) {
    const r = fit.tireR + 0.06;
    const arc = new THREE.TorusGeometry(r, 0.05, 6, 24, Math.PI * 1.05);
    arc.rotateZ(-0.03 * Math.PI); arc.rotateY(Math.PI / 2);
    const m = new THREE.Mesh(arc, look.flareMat || mats.carbon);
    m.scale.set(1.6, 1, 1);
    m.position.set(w.x + Math.sign(w.x) * 0.05, w.y, w.z); m.castShadow = true;
    g.add(m);
  }
  return g;
}

// ------------------------------------------------------------------ interior
export function buildInterior(look, cage, fit, leatherMat) {
  const g = new THREE.Group();
  if (look.seats !== 'stock') {
    const shellMat = look.seats === 'carbon' ? mats.carbon : leatherMat;
    for (const sx of [-1, 1]) {
      const seat = new THREE.Group();
      const back = new THREE.Shape();
      back.moveTo(-0.26, 0); back.lineTo(0.26, 0); back.lineTo(0.24, 0.62); back.quadraticCurveTo(0.2, 0.72, 0.1, 0.74);
      back.lineTo(-0.1, 0.74); back.quadraticCurveTo(-0.2, 0.72, -0.24, 0.62); back.closePath();
      const hole = new THREE.Path(); hole.absellipse(0, 0.6, 0.06, 0.045, 0, Math.PI * 2); back.holes.push(hole);
      const bg = new THREE.ExtrudeGeometry(back, { depth: 0.07, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 3 });
      const bm = new THREE.Mesh(bg, shellMat); bm.rotation.x = -0.32; bm.position.set(0, 0.0, -0.12); seat.add(bm);
      for (const wx of [-1, 1]) { // side bolsters
        const bol = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.18), shellMat);
        bol.position.set(wx * 0.25, 0.28, -0.04); bol.rotation.x = -0.32; seat.add(bol);
      }
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.5), shellMat); base.position.set(0, 0.0, 0.16); seat.add(base);
      if (look.harness) for (const hx of [-0.09, 0.09]) {
        const strap = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.62, 0.012), mats.harness);
        strap.position.set(hx, 0.3, -0.02); strap.rotation.x = -0.32; seat.add(strap);
      }
      seat.position.set(sx * fit.seatX, fit.seatY, fit.seatZ);
      seat.traverse(o => { o.castShadow = true; });
      g.add(seat);
    }
  }
  if (cage) {
    const R = 0.022;
    const tube = (pts) => { const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p))), 24, R, 8), mats.cage); m.castShadow = true; g.add(m); };
    const z = fit.seatZ - 0.42, y0 = 0.3, top = fit.hoopY;
    tube([[-0.68, y0, z], [-0.62, top - 0.08, z], [-0.45, top, z], [0.45, top, z], [0.62, top - 0.08, z], [0.68, y0, z]]);
    tube([[-0.6, top - 0.12, z], [0.62, y0 + 0.05, z - 0.02]]);
    tube([[0.66, y0 + 0.25, z], [0.66, y0 + 0.2, z + 0.9]]); tube([[-0.66, y0 + 0.25, z], [-0.66, y0 + 0.2, z + 0.9]]);
    tube([[0.5, top - 0.02, z], [0.4, y0 + 0.2, z - 0.7]]); tube([[-0.5, top - 0.02, z], [-0.4, y0 + 0.2, z - 0.7]]);
  }
  return g;
}

// soft coloured light pool under the car
export function makeUnderglow(color) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  const grd = x.createRadialGradient(64, 64, 4, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,0.9)'); grd.addColorStop(0.5, 'rgba(255,255,255,0.35)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = grd; x.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 5.6), new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(color).multiplyScalar(2.5), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.03; m.renderOrder = 3;
  return m;
}

// ray casts against the body shell to find where parts should sit
export function measureBody(body, wheels) {
  const rc = new THREE.Raycaster();
  const hitY = (x, z, fromTop = true) => {
    rc.set(new THREE.Vector3(x, fromTop ? 3 : -1, z), new THREE.Vector3(0, fromTop ? -1 : 1, 0));
    const h = rc.intersectObject(body, true)[0];
    return h ? h.point.y : null;
  };
  const box = new THREE.Box3().setFromObject(body);
  const frontZ = box.max.z, rearZ = box.min.z, halfW = box.max.x;
  // deck: highest surface point near the tail on the centre line
  let deckZ = rearZ + 0.32, deckY = hitY(0, deckZ) ?? 0.98;
  // the shell is hollow underneath, so upward rays can hit the inside of
  // the deck: clamp to the real bumper/sill heights of the 458
  const cl = (v, a, b, d) => (v == null || v < a || v > b ? d : v);
  const frontLow = cl(hitY(0, frontZ - 0.12, false), 0.1, 0.26, 0.17);
  const rearLow = cl(hitY(0, rearZ + 0.2, false), 0.12, 0.3, 0.22);
  const sill = cl(hitY(halfW - 0.08, 0, false), 0.1, 0.28, 0.18);
  deckY = cl(deckY, 0.8, 1.15, 0.98);
  const fw = wheels.filter(w => w.front), rw = wheels.filter(w => !w.front);
  const fz = fw.length ? fw[0].z : 1.15, rz = rw.length ? rw[0].z : -1.5;
  return {
    frontZ, rearZ, halfW, deckY, deckZ, frontLow, rearLow, sillY: sill + 0.04, midZ: (fz + rz) / 2, wheelbase: fz - rz,
    wheels, tireR: 0.358, seatX: 0.36, seatY: 0.28, seatZ: -0.12, hoopY: 1.16,
  };
}
