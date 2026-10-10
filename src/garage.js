// Showroom garage: upgrades, tuning and customisation for the car.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { CATALOG, PAINTS, FINISHES, RIMS, defaultBuild, buildSpec, performance, buildCost, engineTorque, boostTarget, saveBuild } from './spec.js';

const $ = (s, el = document) => el.querySelector(s);
const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
};
const money = (n) => '$' + Math.round(n).toLocaleString('en-US');

const TUNE = [
  { group: 'Tires', key: 'tires', items: [
    ['pressF', 'Pressure front', 1.4, 3.0, 0.05, 'bar'], ['pressR', 'Pressure rear', 1.4, 3.0, 0.05, 'bar']] },
  { group: 'Alignment', key: 'align', lock: 'Needs sport suspension or coilovers', items: [
    ['camberF', 'Camber front', -5, 1, 0.1, '°'], ['camberR', 'Camber rear', -5, 1, 0.1, '°'], ['toeF', 'Toe front', -1, 1, 0.05, '°'], ['toeR', 'Toe rear', -1, 1, 0.05, '°']] },
  { group: 'Springs & ride height', key: 'springs', lock: 'Needs coilovers', items: [
    ['springF', 'Springs front', 50, 220, 1, 'N/mm'], ['springR', 'Springs rear', 50, 240, 1, 'N/mm'], ['heightF', 'Ride height front', -40, 60, 1, 'mm', 'height'], ['heightR', 'Ride height rear', -40, 60, 1, 'mm', 'height']] },
  { group: 'Damping', key: 'damp', lock: 'Needs race coilovers', items: [
    ['bumpF', 'Bump front', 1, 20, 0.5, ''], ['bumpR', 'Bump rear', 1, 20, 0.5, ''], ['reboundF', 'Rebound front', 1, 20, 0.5, ''], ['reboundR', 'Rebound rear', 1, 20, 0.5, '']] },
  { group: 'Anti-roll bars', key: 'arb', lock: 'Needs adjustable anti-roll bars', items: [
    ['arbF', 'Front', 1, 65, 0.5, ''], ['arbR', 'Rear', 1, 65, 0.5, '']] },
  { group: 'Gearing', key: 'final', lock: 'Needs a close-ratio or race transmission', items: [
    ['final', 'Final drive', 2.8, 5.6, 0.01, ':1']], gears: true },
  { group: 'Aero', key: 'aerof', lock: 'Needs an adjustable splitter / wing', items: [
    ['aeroF', 'Front downforce', 0, 1, 0.01, '', 'aerof'], ['aeroR', 'Rear wing angle', 0, 1, 0.01, '', 'aeror']] },
  { group: 'Brakes', key: 'brake', lock: 'Needs sport or race brakes', items: [
    ['brakeBias', 'Balance (front)', 40, 70, 0.5, '%'], ['brakePress', 'Pressure', 70, 150, 1, '%']] },
  { group: 'Differential', key: 'diff', lock: 'Needs a limited-slip differential', items: [
    ['diffAccel', 'Acceleration lock', 0, 100, 1, '%'], ['diffDecel', 'Deceleration lock', 0, 100, 1, '%']] },
  { group: 'Engine', key: 'engine', items: [
    ['boost', 'Boost (of kit max)', 0.4, 1.2, 0.01, '×', 'boost'], ['steerLock', 'Steering lock', 0.6, 1.3, 0.01, '×']] },
];

const STYLE_TABS = ['Paint', 'Livery', 'Wheels', 'Body kit', 'Stance', 'Lights', 'Interior'];
const CAMS = {
  default: [5.6, 1.9, 6.4], engine: [-4.2, 2.6, -5.6], induction: [-4.2, 2.6, -5.6], drivetrain: [-5, 1.0, -3], chassis: [6.5, 0.9, 1.5],
  brakes: [3.2, 0.7, 2.8], tires: [3.2, 0.7, 2.8], aero: [-5.2, 2.2, -5.4], Paint: [5.6, 1.9, 6.4], Livery: [0.01, 7, 0.5], Wheels: [3.0, 0.6, 2.6],
  'Body kit': [-5.6, 1.6, -5.2], Stance: [0.01, 0.6, 7.5], Lights: [0.5, 1.1, 6.4], Interior: [0.4, 3.2, -1.2], Tuning: [6.5, 1.4, 2], Assists: [5.6, 1.9, 6.4],
};

export class Garage {
  constructor(renderer, car, build, onChange) {
    this.renderer = renderer; this.car = car; this.build = build; this.onChange = onChange;
    this.open = false; this.tab = 'engine'; this.section = 'Upgrades';
    RectAreaLightUniformsLib.init();
    const S = this.scene = new THREE.Scene();
    const pm = new THREE.PMREMGenerator(renderer);
    this.env = pm.fromScene(new RoomEnvironment(renderer), 0.04).texture;
    S.environment = this.env;
    S.background = new THREE.Color(0x0e0f11);
    const floorMat = new THREE.MeshPhysicalMaterial({ color: 0x15161a, roughness: 0.5, metalness: 0.0, clearcoat: 0.7, clearcoatRoughness: 0.25 });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 64), floorMat);
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; S.add(floor);
    const turntable = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.6, 0.04, 96), new THREE.MeshPhysicalMaterial({ color: 0x17181b, roughness: 0.3, metalness: 0.6, clearcoat: 1 }));
    turntable.position.y = -0.015; turntable.receiveShadow = true; S.add(turntable);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.62, 0.012, 6, 128), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.7, 0.5) }));
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.01; S.add(ring);
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(18, 18, 9, 64, 1, true), new THREE.MeshStandardMaterial({ color: 0x131416, roughness: 0.9, side: THREE.BackSide }));
    wall.position.y = 4.5; S.add(wall);
    for (const [x, z, w, d] of [[0, 0, 6, 1.2], [0, 3.5, 6, 0.8], [0, -3.5, 6, 0.8]]) {
      const l = new THREE.RectAreaLight(0xfff6ea, 3.2, w, d); l.position.set(x, 5.2, z); l.lookAt(x, 0, z); S.add(l);
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.9, 2.7) }));
      panel.position.copy(l.position); panel.rotation.x = Math.PI / 2; S.add(panel);
    }
    const key = new THREE.SpotLight(0xffffff, 60, 30, 0.6, 0.6, 1.2);
    key.position.set(3, 9, 4); key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0002;
    S.add(key, key.target);
    S.add(new THREE.HemisphereLight(0xbfc8d8, 0x202020, 0.6));
    this.cam = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.05, 200);
    this.cam.position.set(...CAMS.default);
    this.controls = new OrbitControls(this.cam, renderer.domElement);
    this.controls.target.set(0, 0.55, 0); this.controls.enableDamping = true; this.controls.minDistance = 2.2; this.controls.maxDistance = 12;
    this.controls.maxPolarAngle = Math.PI * 0.495; this.controls.enabled = false; this.controls.autoRotateSpeed = 0.6;
    this.camGoal = null;
    this.root = $('#garage');
    this.stockPerf = performance(buildSpec(defaultBuild()));
    this._ui();
  }

  enter() {
    const car = this.car;
    this.saved = { parent: car.root.parent, pos: car.root.position.clone(), quat: car.root.quaternion.clone(), visible: car.root.visible };
    this.scene.add(car.root);
    car.root.position.set(0, 0, 0); car.root.quaternion.identity();
    car.body.rotation.set(0, 0, 0);
    for (const w of car.wheels) w.pivot.rotation.y = 0;
    car.setEnvMap(this.env);
    car.root.visible = true;
    this.open = true;
    this.controls.enabled = true;
    this.root.hidden = false;
    document.body.classList.add('in-garage');
    this.render();
    this.resize();
  }

  exit() {
    const car = this.car, s = this.saved;
    s.parent.add(car.root); car.root.position.copy(s.pos); car.root.quaternion.copy(s.quat);
    this.open = false; this.controls.enabled = false; this.root.hidden = true;
    document.body.classList.remove('in-garage');
    this.onExit?.();
  }

  frame(dt) {
    if (this.camGoal) {
      this.cam.position.lerp(this.camGoal, Math.min(1, dt * 3));
      if (this.cam.position.distanceTo(this.camGoal) < 0.05) this.camGoal = null;
    }
    this.controls.update();
    this.car.root.position.y = 0;
    this.car.body.position.y = this.car.rideOffset || 0;
    this.car.body.rotation.set(this.car.rakeOffset || 0, 0, 0);
    if (this.car.stripePatched) { this.car.body.updateMatrixWorld(true); this.car.stripe.inv.value.copy(this.car.body.matrixWorld).invert(); }
    this.renderer.render(this.scene, this.cam);
  }

  // keep the car centred in the open area between the side panels
  resize() {
    const W = innerWidth, H = innerHeight;
    this.cam.aspect = W / H;
    const panel = this.root.querySelector('.g-panel'), stats = this.root.querySelector('.g-stats');
    let cx = W / 2, cy = H / 2;
    if (panel && stats && W > 960 && !this.root.hidden) {
      const a = panel.getBoundingClientRect().right, b = stats.getBoundingClientRect().left;
      cx = (a + b) / 2; cy = H * 0.55;
    } else if (W <= 960) cy = H * 0.36;
    this.cam.setViewOffset(W, H, W / 2 - cx, H / 2 - cy, W, H);
    this.cam.updateProjectionMatrix();
    document.documentElement.style.setProperty('--free-x', cx + 'px');
  }

  focus(name) {
    const p = CAMS[name] || CAMS.default;
    this.camGoal = new THREE.Vector3(...p);
    if (window.matchMedia('(max-width: 960px)').matches) this.camGoal.multiplyScalar(innerWidth < innerHeight ? 1.7 : 1.3);
  }

  // ---------------------------------------------------------------- state
  commit(rebuildList = true) {
    saveBuild(this.build);
    this.onChange(this.build);
    if (rebuildList) this.render(); else this.renderStats();
  }

  // ---------------------------------------------------------------- UI
  _ui() {
    const r = this.root;
    r.innerHTML = '';
    this.nav = h('nav', { class: 'g-nav', 'aria-label': 'Garage sections' });
    this.list = h('div', { class: 'g-list' });
    this.stats = h('aside', { class: 'g-stats' });
    const top = h('header', { class: 'g-top' },
      h('div', { class: 'g-title' }, h('span', { class: 'g-eyebrow' }, 'Garage'), h('strong', {}, '458 Spider')),
      this.badge = h('div', { class: 'g-badge' }),
      this.spent = h('div', { class: 'g-spent' }),
      h('button', { class: 'g-btn ghost', onclick: () => { if (this.confirmReset) { this.build = Object.assign(this.build, defaultBuild()); this.confirmReset = false; this.commit(); } else { this.confirmReset = true; this.render(); setTimeout(() => { this.confirmReset = false; this.render(); }, 3000); } } }, ''),
      h('button', { class: 'g-btn primary', onclick: () => this.exit() }, 'Drive'));
    this.resetBtn = top.querySelectorAll('button')[0];
    r.append(top, h('div', { class: 'g-panel' }, this.nav, this.list), this.stats);
    this.render();
  }

  render() {
    this.resetBtn.textContent = this.confirmReset ? 'Tap again to reset' : 'Reset to stock';
    // nav
    this.nav.innerHTML = '';
    const sec = (title, items) => {
      this.nav.append(h('div', { class: 'g-sec' }, title));
      for (const [id, label] of items) this.nav.append(h('button', { class: 'g-tab' + (this.tab === id ? ' on' : ''), onclick: () => { this.tab = id; this.focus(id); this.render(); } }, label));
    };
    sec('Upgrades', Object.entries(CATALOG).map(([k, v]) => [k, v.title]));
    sec('Tuning', [['Tuning', 'Setup'], ['Assists', 'Assists & gearbox']]);
    sec('Style', STYLE_TABS.map(t => [t, t]));
    // list
    this.list.innerHTML = '';
    if (CATALOG[this.tab]) this._parts(CATALOG[this.tab]);
    else if (this.tab === 'Tuning') this._tuning();
    else if (this.tab === 'Assists') this._assists();
    else this._style(this.tab);
    this.renderStats();
  }

  _parts(cat) {
    const spec0 = buildSpec(this.build), p0 = performance(spec0);
    this.list.append(h('h2', {}, cat.title));
    for (const slot of cat.slots) {
      const box = h('section', { class: 'g-slot' }, h('h3', {}, slot.name));
      const grid = h('div', { class: 'g-opts' });
      for (const o of slot.options) {
        const on = this.build.parts[slot.id] === o.id;
        let delta = '';
        if (!on) {
          const b2 = JSON.parse(JSON.stringify(this.build)); b2.parts[slot.id] = o.id;
          const p = performance(buildSpec(b2));
          const chips = [];
          const dHp = p.hp - p0.hp, dKg = p.kg - p0.kg, dPi = p.pi - p0.pi;
          if (Math.abs(dHp) >= 1) chips.push(h('span', { class: dHp > 0 ? 'up' : 'dn' }, `${dHp > 0 ? '+' : ''}${dHp.toFixed(0)} hp`));
          if (Math.abs(dKg) >= 1) chips.push(h('span', { class: dKg < 0 ? 'up' : 'dn' }, `${dKg > 0 ? '+' : ''}${dKg.toFixed(0)} kg`));
          if (dPi) chips.push(h('span', { class: dPi > 0 ? 'up' : 'dn' }, `${dPi > 0 ? '+' : ''}${dPi} PI`));
          delta = h('div', { class: 'g-delta' }, chips);
        }
        grid.append(h('button', { class: 'g-opt' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false', onclick: () => { this.build.parts[slot.id] = o.id; this.commit(); } },
          h('div', { class: 'g-opt-top' }, h('span', { class: 'g-opt-name' }, o.name), h('span', { class: 'g-price' }, on ? 'Installed' : (o.price ? money(o.price) : 'Stock'))),
          o.desc ? h('p', {}, o.desc) : null, delta));
      }
      box.append(grid);
      this.list.append(box);
    }
  }

  _slider(obj, key, label, min, max, step, unit, locked, onInput) {
    const val = obj[key];
    const out = h('output', {}, fmt(val, step) + (unit ? ' ' + unit : ''));
    const inp = h('input', { type: 'range', min, max, step, value: val, disabled: locked, id: 'g-' + key, oninput: (e) => {
      obj[key] = +e.target.value; out.textContent = fmt(obj[key], step) + (unit ? ' ' + unit : '');
      onInput ? onInput() : this._live();
    }, onchange: () => this.commit(false) });
    return h('label', { class: 'g-slider' + (locked ? ' locked' : ''), for: 'g-' + key }, h('span', {}, label), inp, out);
  }

  _live() {
    // throttle expensive re-application while dragging
    if (this.pending) return;
    this.pending = requestAnimationFrame(() => { this.pending = 0; this.onChange(this.build); this.renderStats(); });
  }

  _tuning() {
    const spec = buildSpec(this.build), t = this.build.tune;
    this.list.append(h('h2', {}, 'Setup'), h('p', { class: 'g-note' }, 'Adjustable settings unlock as you fit the matching parts. Changes apply on the road immediately.'));
    for (const g of TUNE) {
      const box = h('section', { class: 'g-slot' }, h('h3', {}, g.group));
      const groupLocked = g.key !== 'tires' && g.key !== 'engine' && !spec.adj[g.key] && !(g.key === 'aerof' && spec.adj.aeror);
      if (groupLocked && g.lock) box.append(h('p', { class: 'g-lock' }, g.lock));
      for (const [k, label, mn, mx, st, unit, need] of g.items) {
        let locked = groupLocked;
        if (need === 'height') locked = !spec.adj.height;
        if (need === 'aerof') locked = !spec.adj.aerof;
        if (need === 'aeror') locked = !spec.adj.aeror;
        if (need === 'boost') locked = !spec.boostMax;
        box.append(this._slider(t, k, label, mn, mx, st, unit, locked));
      }
      if (g.gears) {
        const locked = !spec.adj.gears;
        if (locked) box.append(h('p', { class: 'g-lock' }, 'Individual ratios need the race sequential gearbox'));
        const base = this.build.parts.gearbox === 'seq' ? 6 : 7;
        for (let i = 0; i < base; i++) box.append(this._slider(t.gearScale, i, `Gear ${i + 1} (×)`, 0.7, 1.3, 0.01, '', locked));
        if (!locked) box.append(this._slider(t, 'limiter', 'Shift limiter (0 = max)', 0, 10500, 100, 'rpm', false));
      }
      this.list.append(box);
    }
  }

  _assists() {
    const A = this.build.assists;
    const box = h('section', { class: 'g-slot' });
    const chips = (label, key, opts) => h('div', { class: 'g-row' }, h('span', {}, label), h('div', { class: 'g-chips' },
      opts.map(([v, l]) => h('button', { class: 'g-chip' + (A[key] === v ? ' on' : ''), onclick: () => { A[key] = v; this.commit(); } }, l))));
    box.append(chips('Gearbox', 'gearbox', [['auto', 'Automatic'], ['manual', 'Manual (E / Z)']]),
      chips('ABS', 'abs', [[true, 'On'], [false, 'Off']]),
      chips('Traction control', 'tc', [[2, 'Full'], [1, 'Sport'], [0, 'Off']]),
      chips('Stability control', 'sc', [[true, 'On'], [false, 'Off']]));
    this.list.append(h('h2', {}, 'Assists & gearbox'), box,
      h('p', { class: 'g-note' }, 'With ABS off, heavy braking locks the wheels; with traction control off the rear tyres spin up under power. N fires nitrous if fitted.'));
  }

  _colors(label, current, list, set) {
    const row = h('div', { class: 'g-colors' });
    for (const [name, hex] of list) row.append(h('button', { class: 'g-sw' + (current.toLowerCase() === hex.toLowerCase() ? ' on' : ''), title: name, 'aria-label': name, style: `--c:${hex}`, onclick: () => { set(hex); this.commit(); } }));
    const custom = h('input', { type: 'color', value: current, 'aria-label': label + ' custom colour', oninput: (e) => { set(e.target.value); this._live(); }, onchange: () => this.commit() });
    row.append(h('label', { class: 'g-custom' }, custom, 'Custom'));
    return h('div', { class: 'g-row col' }, h('span', {}, label), row);
  }

  _chips(label, cur, opts, set) {
    return h('div', { class: 'g-row' }, h('span', {}, label), h('div', { class: 'g-chips' },
      opts.map(([v, l]) => h('button', { class: 'g-chip' + (cur === v ? ' on' : ''), onclick: () => { set(v); this.commit(); } }, l))));
  }

  _style(tab) {
    const L = this.build.look;
    this.list.append(h('h2', {}, tab));
    const box = h('section', { class: 'g-slot' });
    const NEUTRAL = [['Gunmetal', '#3a3c41'], ['Silver', '#b8bbc0'], ['Gloss black', '#0e0e10'], ['Bronze', '#8a6a3b'], ['Gold', '#b8902c'], ['White', '#e8e8e4'], ['Red', '#b5120e'], ['Yellow', '#e6b800']];
    if (tab === 'Paint') {
      box.append(this._colors('Body colour', L.paint, PAINTS, v => (L.paint = v)),
        this._chips('Finish', L.finish, Object.entries(FINISHES).map(([k, f]) => [k, f.name]), v => (L.finish = v)));
    } else if (tab === 'Livery') {
      box.append(this._chips('Stripes', L.stripes, [['none', 'None'], ['dual', 'Twin racing stripes'], ['center', 'Centre stripe'], ['side', 'Side stripe'], ['twotone', 'Two-tone upper']], v => (L.stripes = v)),
        this._colors('Stripe colour', L.stripeColor, [['White', '#f2f0e8'], ['Black', '#0e0e10'], ['Yellow', '#f2c200'], ['Red', '#b5120e'], ['Blue', '#1c3b8a'], ['Silver', '#a9adb3']], v => (L.stripeColor = v)),
        this._slider(L, 'tint', 'Window tint', 0, 1, 0.01, '', false));
    } else if (tab === 'Wheels') {
      box.append(this._chips('Design', L.rim, Object.entries(RIMS), v => (L.rim = v)),
        this._colors('Rim colour', L.rimColor, NEUTRAL, v => (L.rimColor = v)),
        this._chips('Rim finish', L.rimFinish, [['metal', 'Polished'], ['gloss', 'Gloss paint'], ['matte', 'Matte']], v => (L.rimFinish = v)),
        this._slider(L, 'rimSize', 'Rim diameter', 19, 21, 1, 'in', false, () => { this._live(); }),
        this._colors('Brake calipers', L.caliper, [['Giallo', '#d4a017'], ['Rosso', '#b5120e'], ['Black', '#111113'], ['Silver', '#a0a3a8'], ['Blue', '#1c4fa0'], ['Green', '#2f7d3b'], ['Orange', '#e2601a']], v => (L.caliper = v)));
    } else if (tab === 'Body kit') {
      box.append(h('p', { class: 'g-note' }, 'Aero parts change downforce and drag as well as the look. Prices and stats are in Upgrades → Aero.'));
      for (const slot of CATALOG.aero.slots) box.append(this._chips(slot.name, this.build.parts[slot.id], slot.options.map(o => [o.id, o.name]), v => (this.build.parts[slot.id] = v)));
      box.append(this._chips('Widebody fender flares', L.widebody, [[false, 'Off'], [true, 'Carbon flares (+50 mm track)']], v => (L.widebody = v)));
    } else if (tab === 'Stance') {
      const spec = buildSpec(this.build);
      box.append(this._slider(this.build.tune, 'heightF', 'Ride height front', -40, 60, 1, 'mm', !spec.adj.height),
        this._slider(this.build.tune, 'heightR', 'Ride height rear', -40, 60, 1, 'mm', !spec.adj.height),
        !spec.adj.height ? h('p', { class: 'g-lock' }, 'Ride height needs coilovers (Upgrades → Chassis)') : null,
        this._slider(L, 'spacers', 'Wheel spacers', 0, 30, 1, 'mm', false),
        this._slider(L, 'camberLook', 'Static camber (look)', 0, 8, 0.1, '°', false));
    } else if (tab === 'Lights') {
      box.append(this._chips('Headlights', L.headlight, [['#ffd9a0', 'Halogen'], ['#fff4e0', 'Xenon 4300K'], ['#eef4ff', 'LED 6000K'], ['#bcd6ff', 'Ice blue'], ['#ffd24a', 'Selective yellow']], v => (L.headlight = v)),
        this._chips('Tail lights', L.smokedTails, [[false, 'Factory'], [true, 'Smoked']], v => (L.smokedTails = v)),
        this._chips('Underglow', L.underglow, [['none', 'None'], ['#ff2a2a', 'Red'], ['#2a6bff', 'Blue'], ['#2aff6b', 'Green'], ['#a12aff', 'Purple'], ['#ffffff', 'White'], ['#ff8a1a', 'Orange']], v => (L.underglow = v)));
    } else if (tab === 'Interior') {
      box.append(this._chips('Seats', L.seats, [['stock', 'Factory sport'], ['leather', 'Leather race buckets'], ['carbon', 'Carbon race buckets']], v => (L.seats = v)),
        this._chips('Harnesses', L.harness, [[false, 'Factory belts'], [true, '6-point harnesses']], v => (L.harness = v)),
        this._colors('Leather', L.leather, [['Nero', '#1a1a1c'], ['Cuoio', '#7a4a26'], ['Rosso', '#7d1416'], ['Beige', '#c9b28c'], ['Blu', '#1e2a4a'], ['Grigio', '#5a5c60'], ['Bianco', '#e6e2d8']], v => (L.leather = v)),
        this._colors('Accent & stitching', L.accent, [['Rosso', '#b5120e'], ['Giallo', '#e6b800'], ['Bianco', '#e6e2d8'], ['Nero', '#1a1a1c'], ['Blu', '#1c3b8a']], v => (L.accent = v)),
        this._chips('Dash & console', L.carbonTrim, [[true, 'Carbon fibre'], [false, 'Leather wrapped']], v => (L.carbonTrim = v)),
        this._colors('Carpet', L.carpet, [['Black', '#1c1c1e'], ['Charcoal', '#34353a'], ['Tan', '#8a6a48'], ['Red', '#5a1214']], v => (L.carpet = v)),
        h('p', { class: 'g-note' }, 'A roll cage is in Upgrades → Chassis → Chassis bracing.'));
    }
    this.list.append(box);
  }

  renderStats() {
    const spec = buildSpec(this.build), p = performance(spec), s0 = this.stockPerf;
    this.badge.innerHTML = '';
    this.badge.append(h('span', { class: 'cls cls-' + p.cls }, p.cls), h('span', { class: 'pi' }, p.pi));
    this.spent.textContent = money(buildCost(this.build)) + ' invested';
    const st = this.stats; st.innerHTML = '';
    const row = (label, val, base, better = 'up', unit = '') => {
      const d = val - base, good = better === 'up' ? d > 0 : d < 0;
      return h('div', { class: 'g-stat' }, h('span', {}, label), h('strong', {}, val.toFixed(unit === 's' || unit === 'g' ? 2 : 0) + (unit ? ' ' + unit : '')),
        Math.abs(d) > (unit === 's' || unit === 'g' ? 0.005 : 0.5) ? h('em', { class: good ? 'up' : 'dn' }, (d > 0 ? '+' : '') + d.toFixed(unit === 's' || unit === 'g' ? 2 : 0)) : h('em', {}, ''));
    };
    st.append(h('h3', {}, 'Performance'),
      row('Power', p.hp, s0.hp, 'up', 'hp'), row('Torque', p.nm, s0.nm, 'up', 'Nm'), row('Weight', p.kg, s0.kg, 'dn', 'kg'),
      row('0–100 km/h', p.t100 || 0, s0.t100, 'dn', 's'), row('0–200 km/h', p.t200 || 0, s0.t200, 'dn', 's'), row('¼ mile', p.tq || 0, s0.tq, 'dn', 's'),
      row('Top speed', p.top, s0.top, 'up', 'km/h'), row('100–0 km/h', p.brake100, s0.brake100, 'dn', 'm'), row('Lateral grip', p.latG, s0.latG, 'up', 'g'));
    const bars = h('div', { class: 'g-bars' });
    for (const [k, l] of [['speed', 'Speed'], ['handling', 'Handling'], ['accel', 'Acceleration'], ['launch', 'Launch'], ['braking', 'Braking']]) {
      bars.append(h('div', { class: 'g-bar' }, h('span', {}, l), h('div', { class: 'track' }, h('i', { class: 'base', style: `width:${s0.bars[k] * 10}%` }), h('i', { class: 'now', style: `width:${p.bars[k] * 10}%` })), h('b', {}, p.bars[k].toFixed(1))));
    }
    st.append(bars);
    const cv = h('canvas', { width: 560, height: 300, class: 'g-dyno', 'aria-label': 'Dyno chart of torque and power against rpm' });
    st.append(h('h3', {}, 'Dyno'), cv, h('p', { class: 'g-legend' }, h('i', { class: 'tq' }), 'Torque ', h('i', { class: 'pw' }), 'Power ', h('i', { class: 'st' }), 'Stock'));
    drawDyno(cv, spec, buildSpec(defaultBuild()));
  }
}

function fmt(v, step) { const d = step >= 1 ? 0 : step >= 0.1 ? 1 : 2; return (+v).toFixed(d); }

function drawDyno(cv, spec, stock) {
  const c = cv.getContext('2d'), W = cv.width, H = cv.height, pad = 40;
  c.clearRect(0, 0, W, H);
  const maxR = Math.max(spec.limiter, stock.limiter) + 200;
  const curve = (s) => { const pts = []; for (let r = 1000; r <= s.limiter; r += 100) { const T = engineTorque(s, r, boostTarget(s, r, 1)); pts.push([r, T, T * r / 9549 * 1.341]); } return pts; };
  const A = curve(spec), B = curve(stock);
  const maxT = Math.max(...A.map(p => p[1]), ...B.map(p => p[1])) * 1.1, maxP = Math.max(...A.map(p => p[2]), ...B.map(p => p[2])) * 1.1;
  const X = (r) => pad + (r - 1000) / (maxR - 1000) * (W - pad * 2), Yt = (t) => H - pad - t / maxT * (H - pad * 1.6), Yp = (p) => H - pad - p / maxP * (H - pad * 1.6);
  c.strokeStyle = 'rgba(255,255,255,0.08)'; c.lineWidth = 1; c.font = '18px "Overpass Mono", monospace'; c.fillStyle = 'rgba(230,226,216,0.6)';
  for (let r = 2000; r <= maxR; r += 2000) { c.beginPath(); c.moveTo(X(r), pad * 0.6); c.lineTo(X(r), H - pad); c.stroke(); c.fillText(r / 1000 + 'k', X(r) - 12, H - 12); }
  const line = (pts, y, col, dash) => { c.setLineDash(dash ? [6, 6] : []); c.strokeStyle = col; c.lineWidth = dash ? 2 : 3.5; c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(X(p[0]), y(p)) : c.moveTo(X(p[0]), y(p)))); c.stroke(); };
  line(B, p => Yt(p[1]), 'rgba(242,194,48,0.45)', true); line(B, p => Yp(p[2]), 'rgba(240,240,232,0.45)', true);
  line(A, p => Yt(p[1]), '#f2c230', false); line(A, p => Yp(p[2]), '#f0f0e8', false);
  c.setLineDash([]);
  c.fillStyle = '#f2c230'; c.fillText(Math.round(Math.max(...A.map(p => p[1]))) + ' Nm', pad, 26);
  c.fillStyle = '#f0f0e8'; c.fillText(Math.round(Math.max(...A.map(p => p[2]))) + ' hp', pad + 150, 26);
}
