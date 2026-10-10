// The car: a modelled crossover wagon with clear-coat paint plus a
// bicycle-model tyre simulation (slip angles, load transfer, handbrake
// drifts), airborne physics and wall / tree collisions.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { makeRim, makeCaliper, buildKit, buildInterior, makeUnderglow, measureBody } from './carparts.js';
import { FINISHES, engineTorque, boostTarget } from './spec.js';
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
    this.stripe = { mode: { value: 0 }, color: { value: new THREE.Color(1, 1, 1) }, inv: { value: new THREE.Matrix4() } };
    this.rideOffset = 0; this.rakeOffset = 0;
    // drivetrain state
    this.gear = 1; this.rpm = 950; this.boost = 0; this.shiftT = 0; this.revT = 0;
    this.nosLeft = 0; this.nosOn = false; this.wheelspin = 0; this.limiterHit = false; this.engineLoad = 0;
    this.events = { shift: 0, bov: 0, pop: 0 };
    this.prevThr = 0; this.lockF = false; this.lockR = false;
  }

  // Swap the placeholder body for the detailed glTF supercar.
  async loadModel(url, envMap) {
    const loader = new GLTFLoader();
    let gltf;
    if (url.endsWith('.txt')) {
      // base64-encoded .glb, for hosts that only serve text and images
      const b64 = (await (await fetch(url)).text()).trim();
      const bin = atob(b64), buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      gltf = await loader.parseAsync(buf.buffer, '');
    } else gltf = await loader.loadAsync(url);
    const model = gltf.scene;
    // the model's nose points down -z; the physics drives toward +z
    const flip = new THREE.Group();
    flip.rotation.y = Math.PI;
    flip.add(model);
    this.M = {
      paint: new THREE.MeshPhysicalMaterial({ color: 0xb5120e, metalness: 0.15, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.4 }),
      chrome: new THREE.MeshPhysicalMaterial({ color: 0xe8e8ea, metalness: 1, roughness: 0.12, envMapIntensity: 1.5 }),
      rim: new THREE.MeshPhysicalMaterial({ color: 0x3a3c41, metalness: 1, roughness: 0.3, clearcoat: 0.6, envMapIntensity: 1.3 }),
      rimInner: new THREE.MeshStandardMaterial({ color: 0x1a1b1d, metalness: 0.8, roughness: 0.5 }),
      caliper: new THREE.MeshPhysicalMaterial({ color: 0xd4a017, roughness: 0.35, clearcoat: 1 }),
      glass: new THREE.MeshPhysicalMaterial({ color: 0x0b0e12, metalness: 0.0, roughness: 0.02, clearcoat: 1, transparent: true, opacity: 0.55, envMapIntensity: 2.2, depthWrite: false }),
      tire: new THREE.MeshStandardMaterial({ color: 0x111112, roughness: 0.88 }),
      leather: new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.62 }),
      accent: new THREE.MeshStandardMaterial({ color: 0xb5120e, roughness: 0.55 }),
      trim: new THREE.MeshPhysicalMaterial({ color: 0x141518, metalness: 0.3, roughness: 0.3, clearcoat: 1 }),
      carpet: new THREE.MeshStandardMaterial({ color: 0x1c1c1e, roughness: 0.95 }),
    };
    this.paint = this.M.paint;
    this.headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2dc, emissiveIntensity: 0.4, roughness: 0.05, metalness: 0.2 });
    this.tailMat = new THREE.MeshStandardMaterial({ color: 0x500000, emissive: 0xff1208, emissiveIntensity: 0.6, roughness: 0.15 });
    const M = this.M;
    const byName = (n) => model.getObjectByName(n);
    model.traverse((o) => {
      if (!o.isMesh) return;
      // the sun's shadow map is ~10 cm per texel: self-shadowing on curved
      // panels turns into acne, so the car only casts shadows
      o.castShadow = true; o.receiveShadow = false;
      const mn = (o.material?.name || '').toLowerCase();
      const map = { body_color: M.paint, metal_chrome: M.chrome, tires: M.tire, glass_gray: M.glass, projector_glass: M.glass,
        taillight_glass: this.tailMat, turn_signal_led: this.headMat, leather: M.leather, leather_red: M.accent, carpet: M.carpet };
      if (map[mn]) o.material = map[mn];
    });
    for (const n of ['carbon_fibre_trim', 'carbon_fibre', 'steering_carbon']) byName(n)?.traverse(o => { if (o.isMesh) o.material = M.trim; });
    for (const n of ['rim_fl', 'rim_fr', 'rim_rl', 'rim_rr']) byName(n)?.traverse(o => { if (o.isMesh) o.material = M.rim; });
    byName('glass')?.traverse(o => { if (o.isMesh) { o.material = M.glass; o.castShadow = false; } });
    byName('lights')?.traverse(o => { if (o.isMesh) o.material = this.headMat; });
    byName('brakes')?.traverse(o => { if (o.isMesh) o.material = this.tailMat; });
    this.reflective = [M.paint, M.chrome, M.rim, M.glass, this.headMat, M.caliper];
    if (envMap) this.setEnvMap(envMap);
    this.body.clear();
    for (const wh of this.wheels) this.root.remove(wh.pivot);
    this.body.add(flip);
    this.root.updateMatrixWorld(true);
    // wheels: pivot (steer) -> spinner (roll) -> model wheel
    this.wheels = [];
    for (const [n, front] of [['wheel_fl', true], ['wheel_fr', true], ['wheel_rl', false], ['wheel_rr', false]]) {
      const w = byName(n);
      if (!w) continue;
      const box = new THREE.Box3().setFromObject(w);
      const c = box.getCenter(new THREE.Vector3());
      this.root.worldToLocal(c);
      const pivot = new THREE.Group(); pivot.position.copy(c);
      const spinner = new THREE.Group();
      pivot.add(spinner); this.root.add(pivot);
      this.root.updateMatrixWorld(true);
      spinner.attach(w);
      const rim = w.getObjectByName(n.replace('wheel_', 'rim_'));
      this.wheels.push({ pivot, spinner, w, front, base: c.clone(), side: Math.sign(c.x), stockRim: rim });
    }
    // steering wheel turns about its column
    const sw = byName('steering_wheel');
    if (sw) {
      const c = new THREE.Box3().setFromObject(sw).getCenter(new THREE.Vector3());
      const holder = new THREE.Group();
      sw.parent.worldToLocal(c);
      holder.position.copy(c);
      sw.parent.add(holder);
      holder.updateMatrixWorld(true);
      holder.attach(sw);
      this.steeringWheel = holder;
      this.steerAxis = new THREE.Vector3(0, 0.42, 1).normalize();
    }
    const bodyMesh = byName('body');
    this.fit = measureBody(bodyMesh || model, this.wheels.map(w => ({ x: w.base.x, y: w.base.y, z: w.base.z, front: w.front })));
    this.kit = new THREE.Group(); this.root.add(this.kit);
    this.interior = new THREE.Group(); this.body.add(this.interior);
    this.extras = new THREE.Group(); this.body.add(this.extras);
    for (const l of this.lights) l.position.set(l.position.x, 0.68, 2.2);
    this.isModel = true;
    if (this.build) this.applyBuild(this.build, this.spec);
  }

  setEnvMap(tex) {
    for (const m of this.reflective || [this.paint]) { m.envMap = tex; m.needsUpdate = true; }
  }

  // Visual side of a build: paint, wheels, kit, interior, lights, stance.
  applyBuild(build, spec) {
    this.build = build; this.spec = spec;
    if (!this.isModel) return;
    const L = build.look, M = this.M;
    const F = FINISHES[L.finish] || FINISHES.gloss;
    M.paint.color.set(L.paint);
    M.paint.metalness = F.metalness; M.paint.roughness = F.roughness;
    M.paint.clearcoat = F.clearcoat; M.paint.clearcoatRoughness = F.clearcoatRoughness;
    M.paint.iridescence = F.iridescence || 0; M.paint.iridescenceIOR = 1.6;
    this.stripe.mode.value = ['none', 'dual', 'center', 'side', 'twotone'].indexOf(L.stripes);
    this.stripe.color.value.set(L.stripeColor);
    if (!this.stripePatched) this._patchStripes(M.paint);
    M.rim.color.set(L.rimColor);
    M.rim.metalness = L.rimFinish === 'gloss' ? 0.2 : 1; M.rim.roughness = L.rimFinish === 'matte' ? 0.6 : L.rimFinish === 'gloss' ? 0.25 : 0.28;
    M.caliper.color.set(L.caliper);
    M.glass.opacity = 0.35 + L.tint * 0.55;
    M.leather.color.set(L.leather); M.accent.color.set(L.accent); M.carpet.color.set(L.carpet);
    M.trim.color.set(L.carbonTrim ? 0x141518 : L.leather);
    this.headMat.emissive.set(L.headlight);
    for (const l of this.lights) l.color.set(L.headlight);
    this.tailMat.color.set(L.smokedTails ? 0x120202 : 0x500000);
    // wheels: replace stock rims with a procedural design
    const rimScale = 1 + (L.rimSize - 20) * 0.04;
    const track = (L.spacers + (L.widebody ? 50 : 0)) / 1000;
    for (const wh of this.wheels) {
      if (wh.custom) { wh.spinner.remove(wh.custom); wh.custom = null; }
      if (wh.caliper) { wh.pivot.remove(wh.caliper); wh.caliper = null; }
      const useStock = L.rim === 'stock';
      if (wh.stockRim) wh.stockRim.visible = useStock;
      if (!useStock) {
        const r = makeRim(L.rim, 0.27 * rimScale, 0.22, M.rim, M.rimInner);
        if (wh.side < 0) r.rotation.y = Math.PI; // face outward
        wh.spinner.add(r); wh.custom = r;
      }
      const cal = makeCaliper(M.caliper, 0.27 * Math.min(1, rimScale));
      cal.position.x = wh.side * -0.02;
      if (wh.side < 0) cal.rotation.y = Math.PI;
      if (!wh.front) cal.rotation.x = Math.PI * 0.85;
      wh.pivot.add(cal); wh.caliper = cal;
      wh.pivot.position.x = wh.base.x + wh.side * track;
      wh.pivot.rotation.z = wh.side * (L.camberLook || 0) * Math.PI / 180;
    }
    // ride height: body sits lower/higher; wheels stay on the ground
    this.rideOffset = ((spec.rideF + spec.rideR) / 2) + L.ride / 1000;
    this.rakeOffset = (spec.rideR - spec.rideF) / 2.65;
    // kit + interior
    this.kit.clear(); this.interior.clear(); this.extras.clear();
    this.kit.add(buildKit(L, build.parts, this.fit));
    this.interior.add(buildInterior(L, spec.cage, this.fit, M.leather));
    if (L.underglow !== 'none') this.extras.add(makeUnderglow(L.underglow));
    this.kit.traverse(o => { if (o.isMesh) o.castShadow = true; });
    this.onLook?.();
  }

  _patchStripes(mat) {
    this.stripePatched = true;
    const U = this.stripe;
    const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = (sh, r) => {
      if (prev) prev.call(mat, sh, r);
      sh.uniforms.uStripeMode = U.mode; sh.uniforms.uStripeCol = U.color; sh.uniforms.uCarInv = U.inv;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform mat4 uCarInv; varying vec3 vCarPos; varying vec3 vCarNrm;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCarPos = (uCarInv * modelMatrix * vec4(position, 1.0)).xyz; vCarNrm = normalize(mat3(uCarInv * modelMatrix) * normal);');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform int uStripeMode; uniform vec3 uStripeCol; varying vec3 vCarPos; varying vec3 vCarNrm;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          float st = 0.0; vec3 cp = vCarPos;
          float topF = smoothstep(0.25, 0.5, vCarNrm.y);
          if (uStripeMode == 1) st = (step(0.07, abs(cp.x)) - step(0.25, abs(cp.x))) * topF;
          if (uStripeMode == 2) st = (1.0 - step(0.2, abs(cp.x))) * topF;
          if (uStripeMode == 3) st = (step(0.48, cp.y) - step(0.56, cp.y)) * smoothstep(0.5, 0.8, abs(vCarNrm.x));
          if (uStripeMode == 4) st = step(0.86, cp.y);
          diffuseColor.rgb = mix(diffuseColor.rgb, uStripeCol, st);`);
    };
    const pk = mat.customProgramCacheKey;
    mat.customProgramCacheKey = () => (pk ? pk.call(mat) : '') + '|stripes';
    mat.needsUpdate = true;
  }

  nextPaint() {
    this.paintIndex = (this.paintIndex + 1) % PAINTS.length;
    if (this.build) { this.build.look.paint = '#' + new THREE.Color(PAINTS[this.paintIndex]).getHexString(); this.applyBuild(this.build, this.spec); }
    else this.paint.color.setHex(PAINTS[this.paintIndex]);
  }

  place(x, z, th, y) { this.x = x; this.z = z; this.th = th; this.y = y; this.vy = 0; this.vx = 0; this.vyl = 0; this.w = 0; this.steer = 0; this.gear = 1; this.rpm = this.spec ? this.spec.idle : 950; this.boost = 0; this.wheelspin = 0; }

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
    const S = this.spec;
    const m = S.mass, I = m * 1.6, L = 2.65, a = L * (1 - S.frontWeight), b = L * S.frontWeight, hcg = S.cgH;
    const sp = Math.abs(this.vx);
    const q = world.road.query(this.x, this.z, this.y);
    const onRoad = !!(q && q.d < ROAD_EDGE + 0.4 && Math.abs(this.y - q.y) < 1.5);
    this.onRoad = onRoad;
    this.surface = onRoad ? 'road' : 'dirt';
    const surf = onRoad ? 1 : S.offMu / S.mu;
    const rho = 1.225, v2 = this.vx * this.vx;
    const downF = this.air ? 0 : 0.5 * rho * v2 * S.clF, downR = this.air ? 0 : 0.5 * rho * v2 * S.clR;

    // steering
    const maxSteer = 0.6 * S.steerLock / (1 + sp / 13);
    const target = input.steer * maxSteer;
    const rate = (Math.abs(target) > Math.abs(this.steer) ? 3.2 : 5.5) * (1 + S.resp);
    this.steer += (target - this.steer) * Math.min(1, dt * rate);
    const d = this.steer;

    // ---------------- drivetrain
    const n = S.gears.length;
    let thr = input.throttle, brk = input.brake;
    // reverse: hold brake at a standstill
    if (this.gear > 0 && this.vx < 0.4 && brk > 0 && thr === 0) { this.revT += dt; if (this.revT > 0.35) { this.gear = -1; this.revT = 0; } }
    else if (this.gear < 0 && thr > 0 && this.vx > -0.4) this.gear = 1;
    else this.revT = 0;
    const rev = this.gear < 0;
    if (rev) { const t = thr; thr = brk; brk = t; }
    const ratio = (rev ? 2.9 : S.gears[Math.min(n, this.gear) - 1]) * S.final;
    const wheelRpm = Math.abs(this.vx) / S.wheelR * 9.549;
    const geared = wheelRpm * ratio;
    // clutch slips at low speed so the engine can rev for a launch
    const slipRpm = thr > 0.05 ? S.idle + (S.launch - S.idle) * Math.min(1, thr * 1.2) : S.idle;
    let rpmT = Math.max(geared, geared < slipRpm ? slipRpm : 0, S.idle);
    // traction control & wheelspin raise rpm above road speed
    rpmT += this.wheelspin * 2200;
    const inertia = 0.12 * S.inertia;
    this.rpm += (rpmT - this.rpm) * Math.min(1, dt / Math.max(0.02, geared >= slipRpm && this.wheelspin < 0.1 ? 0.02 : inertia));
    this.limiterHit = this.rpm >= S.limiter - 20;
    if (this.limiterHit) this.rpm = S.limiter - 60 * Math.random();
    // shifting
    if (this.shiftT > 0) this.shiftT -= dt;
    if (!rev && this.shiftT <= 0) {
      const manual = S.assists.gearbox === 'manual';
      const nextRpm = this.gear < n ? geared / S.gears[this.gear - 1] * S.gears[this.gear] : 0;
      const up = manual ? input.shiftUp : ((this.rpm > S.limiter * 0.965 && thr > 0.2) || (thr < 0.35 && brk === 0 && this.rpm > S.limiter * 0.42 && nextRpm > S.limiter * 0.25));
      const downRpm = this.gear > 1 ? geared / S.gears[this.gear - 1] * S.gears[this.gear - 2] : 1e9;
      const down = manual ? input.shiftDown : (this.gear > 1 && (
        (brk > 0.2 && this.rpm < S.limiter * 0.55 && downRpm < S.limiter * 0.85) ||
        (thr < 0.35 && this.rpm < S.limiter * 0.2) ||
        (thr >= 0.35 && this.rpm < S.limiter * 0.38 && downRpm < S.limiter * 0.8) ||
        (thr > 0.9 && downRpm < S.limiter * 0.78 && this.rpm < S.limiter * 0.55)));
      if (up && this.gear < n) { this.gear++; this.shiftT = S.shift; this.events.shift = 1; if (thr > 0.5) this.events.pop = 1; }
      else if (down && this.gear > 1) { this.gear--; this.shiftT = S.shift * 0.8; this.events.shift = -1; this.rpm = Math.min(S.limiter, downRpm); }
    }
    input.shiftUp = input.shiftDown = false;
    // boost
    const bT = boostTarget(S, this.rpm, thr);
    const spool = S.boost === 'turboBig' ? 1.1 : S.boost === 'turbo' ? 1.9 : 18;
    this.boost += (bT - this.boost) * Math.min(1, dt * (bT > this.boost ? spool : 6));
    if (this.prevThr > 0.6 && thr < 0.2 && this.boost > 0.3 && S.boost.startsWith?.('turbo')) this.events.bov = this.boost;
    if (this.prevThr > 0.6 && thr < 0.15 && this.rpm > 4500) this.events.pop = Math.max(this.events.pop, 0.7);
    this.prevThr = thr;
    // nitrous
    this.nosOn = !!(input.nos && S.nos && this.nosLeft > 0 && thr > 0.5 && !rev);
    if (this.nosOn) this.nosLeft = Math.max(0, this.nosLeft - dt);
    else if (S.nosCap) this.nosLeft = Math.min(S.nosCap, this.nosLeft + dt * 0.04);
    // engine torque
    let T = this.limiterHit || this.shiftT > 0 ? 0 : engineTorque(S, this.rpm, this.boost) * thr;
    if (this.nosOn) T += S.nos * 745.7 / (this.rpm * Math.PI / 30);
    const engBrake = (1 - thr) * (25 + this.rpm * 0.011) * (this.shiftT > 0 ? 0 : 1);
    this.engineLoad = thr;
    let Fdrive = (T - (geared >= S.idle * 0.9 ? engBrake : 0)) * ratio * S.eff / S.wheelR * (rev ? -1 : 1);

    // ---------------- loads
    const dN = m * this.ax * hcg / L;
    const Nf = Math.max(0, m * G * S.frontWeight + downF - dN), Nr = Math.max(0, m * G * (1 - S.frontWeight) + downR + dN);
    const muF = S.muF * surf, muRb = S.muR * surf;
    // open diffs lose drive on the unloaded inside wheel in corners
    const latLoad = Math.min(1, Math.abs(this.ay) / (G * 1.2));
    const diffK = 1 - (1 - S.diffAccel) * 0.35 * latLoad;
    // rear traction circle shared with cornering
    const FrMax = muRb * Nr;
    let tc = 1;
    if (Math.abs(Fdrive) > FrMax * diffK && thr > 0) {
      if (S.assists.tc > 0) { tc = FrMax * diffK / Math.abs(Fdrive) * (S.assists.tc > 1 ? 0.95 : 1.02); Fdrive *= tc; this.wheelspin += (0 - this.wheelspin) * Math.min(1, dt * 8); }
      else {
        const excess = Math.abs(Fdrive) / (FrMax * diffK) - 1;
        this.wheelspin += (Math.min(1, excess) - this.wheelspin) * Math.min(1, dt * 6);
        Fdrive = Math.sign(Fdrive) * FrMax * diffK * 0.92;
      }
    } else this.wheelspin += (0 - this.wheelspin) * Math.min(1, dt * 5);
    // brakes
    let FbF = 0, FbR = 0;
    this.lockF = this.lockR = false;
    if (brk > 0 && Math.abs(this.vx) > 0.3) {
      const Fb = brk * S.brakeForce;
      FbF = Fb * S.brakeBias; FbR = Fb * (1 - S.brakeBias);
      if (S.assists.abs) { FbF = Math.min(FbF, muF * Nf * 0.98); FbR = Math.min(FbR, muRb * Nr * 0.98); }
      else {
        if (FbF > muF * Nf) { FbF = muF * Nf * 0.8; this.lockF = true; }
        if (FbR > muRb * Nr) { FbR = muRb * Nr * 0.8; this.lockR = true; }
      }
    }
    if (input.handbrake && Math.abs(this.vx) > 0.2) { FbR = Math.max(FbR, muRb * Nr * 0.75); this.lockR = true; }
    const sgn = Math.sign(this.vx);
    let Fx = Fdrive - (FbF + FbR) * sgn;
    Fx -= 0.5 * rho * S.CdA * this.vx * Math.abs(this.vx);
    Fx -= (onRoad ? 0.013 : 0.06) * m * G * Math.max(-1, Math.min(1, this.vx / 1.5));

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

    // ---------------- tyres (lateral), friction circle
    const vxs = Math.max(Math.abs(this.vx), 1.5);
    const af = Math.atan2(this.vyl + a * this.w, vxs) - d * Math.sign(this.vx || 1);
    const ar = Math.atan2(this.vyl - b * this.w, vxs);
    const Nf0 = m * G * S.frontWeight, Nr0 = m * G * (1 - S.frontWeight);
    const Cf = S.csF * Math.pow(Math.max(0.2, Nf / Nf0), 0.8), Cr = S.csR * Math.pow(Math.max(0.2, Nr / Nr0), 0.8);
    const fLatF = this.lockF ? 0.35 : Math.sqrt(Math.max(0, 1 - (FbF / (muF * Nf + 1)) ** 2));
    const usedR = Math.abs(Fdrive) + FbR;
    const fLatR = this.lockR ? (input.handbrake ? 0.5 : 0.35) : Math.sqrt(Math.max(0.05, 1 - (usedR / (muRb * Nr + 1)) ** 2)) * (1 - this.wheelspin * 0.5);
    let Fyf = Math.max(-muF * Nf * fLatF, Math.min(muF * Nf * fLatF, -Cf * af));
    let Fyr = Math.max(-muRb * Nr * fLatR, Math.min(muRb * Nr * fLatR, -Cr * ar));
    this.slip = Math.max(Math.abs(Fyr) / (muRb * Nr * fLatR + 1) * Math.min(1, sp / 8) * (Math.abs(ar) > 0.1 ? 1 : 0.2),
      Math.abs(Fyf) / (muF * Nf + 1) * Math.min(1, sp / 8) * (Math.abs(af) > 0.14 ? 0.8 : 0), this.wheelspin, this.lockF || this.lockR ? Math.min(1, sp / 6) : 0);
    if (this.air) { Fyf = 0; Fyr = 0; Fx *= 0.05; }

    let ax = (Fx - Fyf * Math.sin(d)) / m + this.vyl * this.w;
    let ay = (Fyr + Fyf * Math.cos(d)) / m - this.vx * this.w - G * latSlope / Math.sqrt(1 + latSlope * latSlope);
    let dw = (a * Fyf * Math.cos(d) - b * Fyr) / I;
    // locked diff pushes the nose wide under power / tightens on lift
    if (!this.air && sp > 4) dw += Math.sign(this.w) * Math.min(1, Math.abs(this.w) * 3) * (S.diffAccel * thr * Math.abs(Fdrive) * 0.18 - S.diffDecel * (1 - thr) * 600) / I;
    this.vx += ax * dt;
    this.vyl += ay * dt;
    this.w += dw * dt;
    const kin = 1 - Math.min(1, sp / 4);
    if (!this.air && kin > 0) {
      const wk = this.vx * Math.tan(d) / L;
      this.w += (wk - this.w) * kin * Math.min(1, dt * 20);
      this.vyl *= 1 - kin * Math.min(1, dt * 10);
    }
    if (this.air) this.w *= 1 - dt * 0.5;
    else if (S.assists.sc && !input.handbrake && sp > 6) {
      const wMax = (muF + muRb) / 2 * G / sp * 1.2;
      if (Math.abs(this.w) > wMax) this.w += (Math.sign(this.w) * wMax - this.w) * Math.min(1, dt * 3);
    }
    if (Math.abs(this.vx) < 0.05 && thr === 0 && brk === 0) this.vx = 0;
    if (brk > 0 && !rev && this.vx < 0.3 && this.vx > -0.3 && input.throttle === 0) this.vx *= 0.5;
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
    const rk = this.spec ? this.spec.rollK : 1, dk = this.spec ? 6 * this.spec.damp : 6;
    this.bodyPitch += (-this.ax * 0.005 * rk - this.bodyPitch) * Math.min(1, dt * dk);
    this.bodyRoll += (-this.ay * 0.007 * rk - this.bodyRoll) * Math.min(1, dt * dk);
    this.root.position.set(this.x, this.y, this.z);
    // local +z = forward; yaw so that +z maps to (cos th, sin th)
    const e = new THREE.Euler(-this.pitch, Math.PI / 2 - this.th, -this.roll, 'YXZ');
    this.root.quaternion.setFromEuler(e);
    this.body.rotation.set(this.bodyPitch + (this.rakeOffset || 0), 0, this.bodyRoll);
    this.body.position.y = this.rideOffset || 0;
    if (this.steeringWheel) this.steeringWheel.quaternion.setFromAxisAngle(this.steerAxis, -this.steer * 13);
    if (this.stripePatched) { this.body.updateMatrixWorld(true); this.stripe.inv.value.copy(this.body.matrixWorld).invert(); }
    this.wheelSpin += (this.vx / 0.36) * dt;
    const spinRate = this.vx / 0.343 + (this.wheelspin * 40);
    this.wheelSpin += (spinRate - this.vx / 0.343) * dt;
    for (const wh of this.wheels) {
      wh.pivot.rotation.y = wh.front ? -this.steer : 0;
      if (wh.spinner) wh.spinner.rotation.x = this.lockF && wh.front ? wh.spinner.rotation.x : (!wh.front && this.lockR ? wh.spinner.rotation.x : this.wheelSpin);
      else wh.w.rotation.x = this.wheelSpin;
    }
    this.impact *= Math.max(0, 1 - dt * 3);
  }
}
