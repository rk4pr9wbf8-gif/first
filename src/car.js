// The car: a modelled crossover wagon with clear-coat paint plus a
// bicycle-model tyre simulation (slip angles, load transfer, handbrake
// drifts), airborne physics and wall / tree collisions.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FLAG_TUNNEL, FLAG_BRIDGE, ROAD_EDGE, TUBE_HALF } from './road.js';

const G = 9.81;
export const PAINTS = [0x9e0b0b, 0x0f3d2e, 0x0b2a5c, 0xe8e6e0, 0x141416, 0xd98a13, 0x5a5f66];

function bodyShape() {
  const s = new THREE.Shape();
  s.moveTo(-2.3, 0.36);
  s.lineTo(-2.36, 0.62);
  s.lineTo(-2.3, 1.02);
  s.lineTo(-1.2, 1.06);
  s.lineTo(1.2, 1.02);
  s.lineTo(2.02, 0.93);
  s.quadraticCurveTo(2.38, 0.88, 2.4, 0.62);
  s.lineTo(2.33, 0.36);
  s.lineTo(1.83, 0.36);
  s.absarc(1.36, 0.36, 0.47, 0, Math.PI, false);
  s.lineTo(-0.89, 0.36);
  s.absarc(-1.36, 0.36, 0.47, 0, Math.PI, false);
  s.lineTo(-2.3, 0.36);
  return s;
}

function cabinShape() {
  const s = new THREE.Shape();
  s.moveTo(-2.2, 1.0);
  s.lineTo(-2.02, 1.5);
  s.quadraticCurveTo(-1.9, 1.6, -1.6, 1.6);
  s.lineTo(0.35, 1.6);
  s.quadraticCurveTo(0.55, 1.58, 0.7, 1.45);
  s.lineTo(1.28, 1.02);
  s.lineTo(-2.2, 1.0);
  return s;
}

function extrudeSide(shape, width, bevel) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 4, curveSegments: 18 });
  g.translate(0, 0, -width / 2);
  g.rotateY(-Math.PI / 2); // shape x (forward) -> +z, extrusion -> x
  return g;
}

function makeWheel(tireMat, rimMat) {
  const w = new THREE.Group();
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.26, 28, 1), tireMat);
  tire.rotation.z = Math.PI / 2;
  const side = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.065, 8, 28), tireMat);
  side.rotation.y = Math.PI / 2; side.position.x = 0.11;
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.245, 0.245, 0.24, 20), rimMat);
  rim.rotation.z = Math.PI / 2; rim.position.x = 0.02;
  w.add(tire, side, rim);
  for (let k = 0; k < 6; k++) {
    const sp = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.42, 0.06), rimMat);
    sp.position.x = 0.14; sp.rotation.x = (k / 6) * Math.PI;
    w.add(sp);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 10), rimMat);
  hub.rotation.z = Math.PI / 2; hub.position.x = 0.16; w.add(hub);
  w.traverse(o => { o.castShadow = true; });
  return w;
}

export class Car {
  constructor(scene) {
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    scene.add(this.root);

    this.paint = new THREE.MeshPhysicalMaterial({ color: PAINTS[0], metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.1 });
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x0a0d10, metalness: 0.1, roughness: 0.04, clearcoat: 1, envMapIntensity: 1.6 });
    const trim = new THREE.MeshStandardMaterial({ color: 0x16171a, roughness: 0.65 });
    const chrome = new THREE.MeshStandardMaterial({ color: 0xdadde0, metalness: 1, roughness: 0.18 });
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9 });
    this.headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff3dc, emissiveIntensity: 0.4, roughness: 0.1 });
    this.tailMat = new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff1010, emissiveIntensity: 0.6, roughness: 0.3 });

    const lower = new THREE.Mesh(extrudeSide(bodyShape(), 1.74, 0.07), this.paint);
    const cabin = new THREE.Mesh(extrudeSide(cabinShape(), 1.5, 0.08), glass);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.07, 2.05), this.paint);
    roof.position.set(0, 1.66, -0.68);
    const bpillar = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.58, 0.14), this.paint);
    bpillar.position.set(0, 1.33, -0.35);
    const cpillar = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.5, 0.12), this.paint);
    cpillar.position.set(0, 1.28, -1.62); cpillar.rotation.x = -0.3;
    this.body.add(lower, cabin, roof, bpillar, cpillar);
    for (const sx of [-0.62, 0.62]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 1.9), chrome); rail.position.set(sx, 1.73, -0.7); this.body.add(rail);
      const mir = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.1), this.paint); mir.position.set(sx * 1.48, 1.12, 0.62); this.body.add(mir);
    }
    // cladding, bumpers, grille, lights, plate
    const clad = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.2, 4.55), trim); clad.position.set(0, 0.42, 0); this.body.add(clad);
    const fb = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.24, 0.22), trim); fb.position.set(0, 0.5, 2.33); this.body.add(fb);
    const rb = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.24, 0.2), trim); rb.position.set(0, 0.5, -2.36); this.body.add(rb);
    const grille = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.2, 0.06), trim); grille.position.set(0, 0.73, 2.41); this.body.add(grille);
    for (const sx of [-0.63, 0.63]) {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.11, 0.06), this.headMat); hl.position.set(sx, 0.82, 2.38); this.body.add(hl);
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.1, 0.06), this.tailMat); tl.position.set(sx, 0.97, -2.38); this.body.add(tl);
      const fog = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.05), this.headMat); fog.position.set(sx * 1.15, 0.5, 2.45); this.body.add(fog);
    }
    const plateTex = (() => {
      const c = document.createElement('canvas'); c.width = 256; c.height = 128;
      const x = c.getContext('2d');
      x.fillStyle = '#f2f0e6'; x.fillRect(0, 0, 256, 128);
      x.fillStyle = '#1d3e7a'; x.fillRect(0, 0, 256, 26);
      x.fillStyle = '#f2c230'; x.font = 'bold 18px sans-serif'; x.textAlign = 'center'; x.fillText('ALCAN', 128, 20);
      x.fillStyle = '#1d3e7a'; x.font = 'bold 60px sans-serif'; x.fillText('FALL 26', 128, 98);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
    })();
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.26), new THREE.MeshStandardMaterial({ map: plateTex, roughness: 0.5 }));
    plate.position.set(0, 0.62, -2.47); plate.rotation.y = Math.PI; this.body.add(plate);
    this.body.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

    this.wheels = [];
    const rimMat = chrome;
    for (const [x, z] of [[0.82, 1.36], [-0.82, 1.36], [0.82, -1.36], [-0.82, -1.36]]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.36, z);
      const w = makeWheel(tireMat, rimMat);
      if (x < 0) w.rotation.y = Math.PI;
      pivot.add(w);
      this.root.add(pivot);
      this.wheels.push({ pivot, w, front: z > 0 });
    }

    // headlights
    this.lights = [];
    for (const sx of [-0.6, 0.6]) {
      const sl = new THREE.SpotLight(0xfff1d8, 0, 160, 0.42, 0.5, 1.3);
      sl.position.set(sx, 0.85, 2.3);
      sl.target.position.set(sx * 1.5, 0, 30);
      this.root.add(sl, sl.target);
      this.lights.push(sl);
    }

    // physics state
    this.x = 0; this.z = 0; this.y = 0; this.vy = 0; this.th = 0;
    this.vx = 0; this.vyl = 0; this.w = 0; this.steer = 0;
    this.pitch = 0; this.roll = 0; this.bodyPitch = 0; this.bodyRoll = 0;
    this.air = false; this.onRoad = true; this.surface = 'road';
    this.wheelSpin = 0; this.ax = 0; this.ay = 0;
    this.impact = 0; this.slip = 0;
    this.paintIndex = 0;
  }

  // Swap the placeholder body for the detailed glTF supercar.
  async loadModel(url, envMap) {
    const gltf = await new GLTFLoader().loadAsync(url);
    const model = gltf.scene;
    const paint = this.paint = new THREE.MeshPhysicalMaterial({
      color: PAINTS[this.paintIndex], metalness: 0.65, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.03,
      envMapIntensity: 1.4,
    });
    const chrome = new THREE.MeshPhysicalMaterial({ color: 0xe8e8ea, metalness: 1, roughness: 0.12, envMapIntensity: 1.5 });
    const rim = new THREE.MeshPhysicalMaterial({ color: 0x47494e, metalness: 1, roughness: 0.3, clearcoat: 0.6, envMapIntensity: 1.3 });
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x0b0e12, metalness: 0.0, roughness: 0.02, clearcoat: 1, transparent: true, opacity: 0.55, envMapIntensity: 2.2, depthWrite: false });
    const tire = new THREE.MeshStandardMaterial({ color: 0x111112, roughness: 0.88 });
    this.headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2dc, emissiveIntensity: 0.4, roughness: 0.05, metalness: 0.2 });
    this.tailMat = new THREE.MeshStandardMaterial({ color: 0x500000, emissive: 0xff1208, emissiveIntensity: 0.6, roughness: 0.15 });
    const byName = (n) => model.getObjectByName(n);
    model.traverse((o) => {
      if (!o.isMesh) return;
      // the sun's shadow map is ~10 cm per texel: self-shadowing on curved
      // panels turns into acne, so the car only casts shadows
      o.castShadow = true; o.receiveShadow = false;
      const mn = (o.material?.name || '').toLowerCase();
      if (mn === 'body_color') o.material = paint;
      else if (mn === 'metal_chrome') o.material = chrome;
      else if (mn === 'tires') o.material = tire;
      else if (mn === 'glass_gray' || mn === 'projector_glass') o.material = glass;
      else if (mn === 'taillight_glass') o.material = this.tailMat;
      else if (mn === 'turn_signal_led') o.material = this.headMat;
      if (o.material && o.material !== glass) { o.material.envMapIntensity = o.material.envMapIntensity ?? 1; }
    });
    for (const n of ['rim_fl', 'rim_fr', 'rim_rl', 'rim_rr', 'trim']) byName(n)?.traverse(o => { if (o.isMesh) o.material = rim; });
    byName('glass')?.traverse(o => { if (o.isMesh) { o.material = glass; o.castShadow = false; } });
    byName('lights')?.traverse(o => { if (o.isMesh) o.material = this.headMat; });
    byName('lights_red')?.traverse(o => { if (o.isMesh) o.material = this.tailMat; });
    this.reflective = [paint, chrome, rim, glass, this.headMat];
    if (envMap) this.setEnvMap(envMap);
    // replace body + wheels
    this.body.clear();
    for (const wh of this.wheels) this.root.remove(wh.pivot);
    this.body.add(model);
    model.updateMatrixWorld(true);
    this.wheels = [];
    for (const [n, front] of [['wheel_fl', true], ['wheel_fr', true], ['wheel_rl', false], ['wheel_rr', false]]) {
      const w = byName(n);
      if (!w) continue;
      const pivot = new THREE.Group();
      const wp = new THREE.Vector3(); w.getWorldPosition(wp);
      this.root.worldToLocal(wp);
      pivot.position.copy(wp);
      this.root.add(pivot);
      pivot.updateMatrixWorld(true);
      pivot.attach(w);
      this.wheels.push({ pivot, w, front, base: w.rotation.x });
    }
    for (const l of this.lights) l.position.y = 0.68;
    this.isModel = true;
  }

  setEnvMap(tex) {
    for (const m of this.reflective || [this.paint]) { m.envMap = tex; m.needsUpdate = true; }
  }

  nextPaint() { this.paintIndex = (this.paintIndex + 1) % PAINTS.length; this.paint.color.setHex(PAINTS[this.paintIndex]); }

  place(x, z, th, y) { this.x = x; this.z = z; this.th = th; this.y = y; this.vy = 0; this.vx = 0; this.vyl = 0; this.w = 0; this.steer = 0; }

  setHeadlights(on, k = 1) {
    for (const l of this.lights) l.intensity = on ? 900 * k : 0;
    this.headMat.emissiveIntensity = on ? 4 : 0.4;
  }

  // ground height under (x,z) given the car's current altitude
  _ground(world, x, z) {
    const q = world.road.query(x, z, this.y);
    if (q && q.d < ROAD_EDGE + 0.9 && this.y > q.y - 2.5) {
      if (q.flag === FLAG_BRIDGE && q.d > 6.3) return world.ground.terrainHeight(x, z);
      return q.y + 0.02;
    }
    if (q && q.flag === FLAG_TUNNEL && this.y < q.y + 8 && q.d < TUBE_HALF + 4) return q.y + 0.02;
    return world.ground.terrainHeight(x, z);
  }

  update(dt, input, world) {
    const steps = Math.max(1, Math.ceil(dt / 0.006));
    const h = dt / steps;
    for (let s = 0; s < steps; s++) this._step(h, input, world);
    this._visual(dt, world);
  }

  _step(dt, input, world) {
    const m = 1450, I = 2300, a = 1.25, b = 1.45, L = a + b, hcg = 0.55;
    const sp = Math.abs(this.vx);
    const q = world.road.query(this.x, this.z, this.y);
    const onRoad = !!(q && q.d < ROAD_EDGE + 0.4 && Math.abs(this.y - q.y) < 1.5);
    this.onRoad = onRoad;
    this.surface = onRoad ? 'road' : 'dirt';
    const mu = onRoad ? 1.25 : 0.72;

    // steering
    const maxSteer = 0.6 / (1 + sp / 13);
    const target = input.steer * maxSteer;
    const rate = Math.abs(target) > Math.abs(this.steer) ? 3.2 : 5.5;
    this.steer += (target - this.steer) * Math.min(1, dt * rate);
    const d = this.steer;

    // longitudinal
    let Fx = 0;
    const thr = input.throttle, brk = input.brake;
    if (thr > 0) Fx += thr * Math.min(13500, 330000 / Math.max(sp, 1)) * (this.vx < -0.5 ? 0 : 1);
    if (brk > 0) {
      if (this.vx > 0.5) Fx -= brk * 19000;
      else if (this.vx > -9) Fx -= brk * 5200; // reverse
    }
    if (thr > 0 && this.vx < -0.5) Fx += thr * 15500;
    Fx -= 0.42 * this.vx * Math.abs(this.vx) + (onRoad ? 14 : 160) * this.vx;
    if (input.handbrake && Math.abs(this.vx) > 0.2) Fx -= Math.sign(this.vx) * 3800;

    // slope
    const fx = Math.cos(this.th), fz = Math.sin(this.th);
    const hf = this._ground(world, this.x + fx * 1.4, this.z + fz * 1.4);
    const hr = this._ground(world, this.x - fx * 1.4, this.z - fz * 1.4);
    const slope = (hf - hr) / 2.8;
    let latSlope = 0;
    if (!this.air) {
      Fx -= m * G * slope / Math.sqrt(1 + slope * slope);
      if (!onRoad) {
        const rx0 = -fz, rz0 = fx;
        const hl = this._ground(world, this.x - rx0 * 1.2, this.z - rz0 * 1.2);
        const hr2 = this._ground(world, this.x + rx0 * 1.2, this.z + rz0 * 1.2);
        latSlope = (hr2 - hl) / 2.4;
      }
    }

    // load transfer
    const dN = m * this.ax * hcg / L;
    const Nf = Math.max(0, m * G * b / L - dN), Nr = Math.max(0, m * G * a / L + dN);
    const vxs = Math.max(Math.abs(this.vx), 1.5);
    let af = Math.atan2(this.vyl + a * this.w, vxs) - d * Math.sign(this.vx || 1);
    let ar = Math.atan2(this.vyl - b * this.w, vxs);
    const Cf = 95000, Cr = 108000;
    const muR = input.handbrake ? mu * 0.55 : mu;
    let Fyf = Math.max(-mu * Nf, Math.min(mu * Nf, -Cf * af));
    let Fyr = Math.max(-muR * Nr, Math.min(muR * Nr, -Cr * ar));
    this.slip = Math.max(Math.abs(Fyr) / (muR * Nr + 1) * Math.min(1, sp / 8) * (Math.abs(ar) > 0.12 ? 1 : 0.2), input.handbrake && sp > 5 ? 0.8 : 0);
    if (this.air) { Fyf = 0; Fyr = 0; Fx *= 0.05; }

    let ax = (Fx - Fyf * Math.sin(d)) / m + this.vyl * this.w;
    let ay = (Fyr + Fyf * Math.cos(d)) / m - this.vx * this.w - G * latSlope / Math.sqrt(1 + latSlope * latSlope);
    let dw = (a * Fyf * Math.cos(d) - b * Fyr) / I;
    this.vx += ax * dt;
    this.vyl += ay * dt;
    this.w += dw * dt;
    // low-speed blend toward kinematic steering to avoid jitter
    const kin = 1 - Math.min(1, sp / 4);
    if (!this.air && kin > 0) {
      const wk = this.vx * Math.tan(d) / L;
      this.w += (wk - this.w) * kin * Math.min(1, dt * 20);
      this.vyl *= 1 - kin * Math.min(1, dt * 10);
    }
    if (this.air) this.w *= 1 - dt * 0.5;
    // gentle stability control: cap yaw rate near what the tyres can hold
    else if (!input.handbrake && sp > 6) {
      const wMax = mu * G / sp * 1.2;
      if (Math.abs(this.w) > wMax) this.w += (Math.sign(this.w) * wMax - this.w) * Math.min(1, dt * 3);
    }
    if (Math.abs(this.vx) < 0.05 && thr === 0 && brk === 0) this.vx = 0;
    this.ax = ax; this.ay = ay + this.vx * this.w;

    this.th += this.w * dt;
    const c = Math.cos(this.th), sn = Math.sin(this.th);
    const rx = -sn, rz = c;
    this.x += (c * this.vx + rx * this.vyl) * dt;
    this.z += (sn * this.vx + rz * this.vyl) * dt;

    // vertical: glued to the ground (suspension soaks up small changes);
    // only a drop steeper than ~40% lets the car take off.
    const gnd = this._ground(world, this.x, this.z);
    const vh = Math.hypot(this.vx, this.vyl);
    if (!this.air) {
      const dh = gnd - (this.prevGnd ?? gnd);
      if (dh < -(vh * dt * 0.4 + 0.03)) {
        this.air = true;
        this.vy = Math.min(this.vy, 0) * 0.5 + this.vy * 0.5;
        this.y += this.vy * dt;
      } else {
        this.y = gnd;
        this.vy = Math.max(-15, Math.min(8, dh / dt));
      }
    } else {
      this.vy -= G * dt;
      this.y += this.vy * dt;
      if (this.y <= gnd) {
        if (this.vy < -6) this.impact = Math.min(1, -this.vy / 15);
        this.y = gnd; this.vy = 0; this.air = false;
      }
    }
    this.prevGnd = gnd;

    // walls: tunnels, bridge parapets, guard rails
    const q2 = world.road.query(this.x, this.z, this.y);
    if (q2 && Math.abs(this.y - q2.y) < 3) {
      let lim = 99;
      const side = Math.sign(q2.side);
      if (q2.flag === FLAG_TUNNEL) lim = TUBE_HALF - 1.0;
      else if (q2.flag === FLAG_BRIDGE) lim = 5.6 - 0.95;
      else if ((side < 0 && q2.railL) || (side > 0 && q2.railR)) lim = 6.0 - 0.95;
      if (Math.abs(q2.side) > lim && (Math.abs(q2.side) < lim + 3 || (q2.flag === FLAG_TUNNEL && this.y < q2.y + 8))) {
        const pen = Math.abs(q2.side) - lim;
        const wx = -q2.hz * side, wz = q2.hx * side; // outward
        this.x -= wx * pen; this.z -= wz * pen;
        // velocity in world, remove outward component
        let vwx = c * this.vx + rx * this.vyl, vwz = sn * this.vx + rz * this.vyl;
        const vo = vwx * wx + vwz * wz;
        if (vo > 0) {
          this.impact = Math.max(this.impact, Math.min(1, vo / 12));
          vwx -= wx * vo * 1.25; vwz -= wz * vo * 1.25;
          vwx *= 0.985; vwz *= 0.985;
          this.vx = vwx * c + vwz * sn;
          this.vyl = vwx * rx + vwz * rz;
          this.w *= 0.6;
        }
      }
    }
    // trees & boulders
    const hit = world.veg.collide(this.x, this.z, 1.0);
    if (hit && this.y < (world.ground.terrainHeight(this.x, this.z) + 3)) {
      this.x += hit.nx * hit.pen; this.z += hit.nz * hit.pen;
      let vwx = c * this.vx + rx * this.vyl, vwz = sn * this.vx + rz * this.vyl;
      const vn = vwx * hit.nx + vwz * hit.nz;
      if (vn < 0) {
        this.impact = Math.max(this.impact, Math.min(1, -vn / 10));
        vwx -= hit.nx * vn * 1.4; vwz -= hit.nz * vn * 1.4;
        vwx *= 0.6; vwz *= 0.6;
        this.vx = vwx * c + vwz * sn; this.vyl = vwx * rx + vwz * rz;
        this.w += (Math.random() - 0.5) * 2;
      }
    }
  }

  _visual(dt, world) {
    const fx = Math.cos(this.th), fz = Math.sin(this.th), rx = -fz, rz = fx;
    let pitch = this.pitch, roll = this.roll;
    if (!this.air) {
      const hf = this._ground(world, this.x + fx * 1.36, this.z + fz * 1.36);
      const hb = this._ground(world, this.x - fx * 1.36, this.z - fz * 1.36);
      const hl = this._ground(world, this.x - rx * 0.82, this.z - rz * 0.82);
      const hrr = this._ground(world, this.x + rx * 0.82, this.z + rz * 0.82);
      pitch = Math.atan2(hf - hb, 2.72);
      roll = Math.atan2(hrr - hl, 1.64);
    }
    const k = Math.min(1, dt * 12);
    this.pitch += (pitch - this.pitch) * k;
    this.roll += (roll - this.roll) * k;
    this.bodyPitch += (-this.ax * 0.007 - this.bodyPitch) * Math.min(1, dt * 6);
    this.bodyRoll += (-this.ay * 0.009 - this.bodyRoll) * Math.min(1, dt * 6);
    this.root.position.set(this.x, this.y, this.z);
    // local +z = forward; yaw so that +z maps to (cos th, sin th)
    const e = new THREE.Euler(-this.pitch, Math.PI / 2 - this.th, -this.roll, 'YXZ');
    this.root.quaternion.setFromEuler(e);
    this.body.rotation.set(this.bodyPitch, 0, this.bodyRoll);
    this.wheelSpin += (this.vx / 0.36) * dt;
    for (const wh of this.wheels) {
      wh.pivot.rotation.y = wh.front ? -this.steer : 0;
      wh.w.rotation.x = (wh.base || 0) + this.wheelSpin;
    }
    this.impact *= Math.max(0, 1 - dt * 3);
  }
}
