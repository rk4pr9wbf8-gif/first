// Parts catalogue, tuning setup and the physics/performance derivation for
// the one car. Base figures are the real 458 Spider: 4497 cc flat-plane V8,
// 419 kW @ 9000 rpm, 540 Nm @ 6000 rpm, 1505 kg, 7-speed DCT.

export const BASE = {
  mass: 1505, frontWeight: 0.42, cgH: 0.46, wheelR: 0.343,
  idle: 950, limiter: 9000,
  gears: [3.08, 2.19, 1.63, 1.29, 1.03, 0.84, 0.69], final: 4.44,
  CdA: 0.66, ClA: 0.28,
};

// Nm vs rpm, stock F136 FB
const TQ = [[800, 260], [1000, 300], [2000, 360], [3000, 420], [4000, 470], [5000, 510], [6000, 540], [7000, 535], [8000, 510], [9000, 445], [10000, 360], [10500, 300]];
function table(rpm) {
  if (rpm <= TQ[0][0]) return TQ[0][1];
  for (let i = 1; i < TQ.length; i++) if (rpm <= TQ[i][0]) {
    const [r0, t0] = TQ[i - 1], [r1, t1] = TQ[i];
    return t0 + (t1 - t0) * (rpm - r0) / (r1 - r0);
  }
  return TQ[TQ.length - 1][1];
}
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ------------------------------------------------------------------ catalogue
// Each slot lists options; option 0 is the factory part. `fx` is applied by
// buildSpec. Prices are rough real-world parts + labour in USD.
export const CATALOG = {
  engine: { title: 'Engine', slots: [
    { id: 'intake', name: 'Air intake', options: [
      { id: 'stock', name: 'Factory airbox', price: 0, desc: 'Paper elements in the twin airboxes.' },
      { id: 'sport', name: 'High-flow filters', price: 650, desc: 'Cotton-gauze elements. More induction roar.', fx: { top: 0.02, intake: 0.3 } },
      { id: 'carbon', name: 'Carbon cold-air plenum', price: 4800, desc: 'Sealed carbon plenum fed from the side intakes.', fx: { top: 0.04, mid: 0.01, kg: -3, intake: 0.6 } },
    ] },
    { id: 'exhaust', name: 'Exhaust', options: [
      { id: 'stock', name: 'Factory valved', price: 0, desc: 'Bypass valves open above 3,000 rpm.' },
      { id: 'sport', name: 'Sport valved cat-back', price: 6200, desc: 'Larger mufflers with full-time open valves.', fx: { top: 0.03, loud: 0.25, pops: 0.25, exhaust: 'sport' } },
      { id: 'titanium', name: 'Titanium race system', price: 14500, desc: 'Inconel headers to titanium tips. Shrieks at 9,000.', fx: { top: 0.06, mid: 0.02, kg: -11, loud: 0.5, pops: 0.6, exhaust: 'race' } },
      { id: 'straight', name: 'Straight pipes (track only)', price: 3900, desc: 'No cats, no mufflers. Very loud, crackles on lift-off.', fx: { top: 0.07, mid: 0.02, low: -0.02, kg: -14, loud: 0.85, pops: 1, exhaust: 'straight' } },
    ] },
    { id: 'headers', name: 'Headers', options: [
      { id: 'stock', name: 'Factory manifolds', price: 0, desc: '4-into-1 cast manifolds.' },
      { id: 'equal', name: 'Equal-length headers', price: 5400, desc: 'Tuned primaries for a cleaner scavenging pulse.', fx: { top: 0.03, mid: 0.02, rasp: 0.2 } },
    ] },
    { id: 'cams', name: 'Camshafts', options: [
      { id: 'stock', name: 'Factory', price: 0, desc: 'Variable timing on all four cams.' },
      { id: 'street', name: 'Street profile', price: 3800, desc: 'More lift and duration. Mild idle lope.', fx: { top: 0.03, low: -0.01, lope: 0.3 } },
      { id: 'race', name: 'Race profile', price: 7600, desc: 'Big overlap. Lumpy idle, loses bottom end.', fx: { top: 0.08, mid: 0.02, low: -0.06, lope: 0.8 } },
    ] },
    { id: 'valvetrain', name: 'Valvetrain', options: [
      { id: 'stock', name: 'Factory', price: 0, desc: 'Limiter at 9,000 rpm.' },
      { id: 'titanium', name: 'Titanium valves & springs', price: 6900, desc: 'Raises the limiter to 9,500 rpm.', fx: { limiter: 9500 } },
      { id: 'pneumatic', name: 'Race valvetrain', price: 18500, desc: 'Lightweight valves and stiffer springs. Limiter at 10,000 rpm.', fx: { limiter: 10000, top: 0.02 } },
    ] },
    { id: 'internals', name: 'Bottom end', options: [
      { id: 'stock', name: 'Factory', price: 0, desc: 'Safe to about 0.6 bar of boost.' },
      { id: 'forged', name: 'Forged pistons & rods', price: 12500, desc: 'Takes up to 1.6 bar of boost.', fx: { boostCap: 1.6, kg: -2 } },
    ] },
    { id: 'displacement', name: 'Displacement', options: [
      { id: 'stock', name: '4.5 L', price: 0, desc: '4,497 cc.' },
      { id: 'stroker', name: '4.9 L stroker kit', price: 21000, desc: 'Longer stroke crank. Much more torque everywhere.', fx: { low: 0.1, mid: 0.09, top: 0.05 } },
    ] },
    { id: 'flywheel', name: 'Flywheel', options: [
      { id: 'stock', name: 'Factory', price: 0, desc: '' },
      { id: 'light', name: 'Lightweight steel', price: 1200, desc: 'Revs build faster.', fx: { inertia: -0.25, kg: -3 } },
      { id: 'race', name: 'Race aluminium', price: 2100, desc: 'Razor-sharp throttle response.', fx: { inertia: -0.45, kg: -5 } },
    ] },
    { id: 'ecu', name: 'ECU tune', options: [
      { id: 'stock', name: 'Factory map', price: 0, desc: '' },
      { id: 's1', name: 'Stage 1 map', price: 1800, desc: 'Ignition and fuel re-map on 98 octane.', fx: { all: 0.04, pops: 0.15 } },
      { id: 's2', name: 'Stage 2 map', price: 3200, desc: 'Needs intake and exhaust for full gains.', fx: { all: 0.07, pops: 0.35 } },
      { id: 's3', name: 'Stage 3 race map', price: 5600, desc: 'Aggressive timing, anti-lag crackle map.', fx: { all: 0.1, pops: 0.6 } },
    ] },
    { id: 'fuel', name: 'Fuel system', options: [
      { id: 'stock', name: 'Factory', price: 0, desc: 'Supports up to 1.0 bar.' },
      { id: 'race', name: 'Race pumps & injectors', price: 4300, desc: 'Needed for more than 1.0 bar of boost.', fx: { fuelCap: 2 } },
    ] },
  ] },
  induction: { title: 'Forced induction', slots: [
    { id: 'aspiration', name: 'Aspiration', options: [
      { id: 'na', name: 'Naturally aspirated', price: 0, desc: 'Instant response, linear power.' },
      { id: 'centrifugal', name: 'Centrifugal supercharger', price: 16500, desc: 'Boost rises with rpm, whines at the top.', fx: { boost: 'centrifugal', boostMax: 0.6 } },
      { id: 'roots', name: 'Twin-screw supercharger', price: 19500, desc: 'Full boost from idle. Loud blower whine.', fx: { boost: 'roots', boostMax: 0.5, kg: 22 } },
      { id: 'twin', name: 'Twin-turbo kit', price: 32000, desc: 'Two ball-bearing turbos. Lag below 3,500 rpm, then a wall of torque.', fx: { boost: 'turbo', boostMax: 0.9, kg: 28 } },
      { id: 'twinbig', name: 'Big twin-turbo kit', price: 48000, desc: 'Larger housings: more lag, enormous top end.', fx: { boost: 'turboBig', boostMax: 1.4, kg: 34 } },
    ] },
    { id: 'intercooler', name: 'Intercooler', options: [
      { id: 'stock', name: 'None / basic', price: 0, desc: '' },
      { id: 'race', name: 'Race front-mount', price: 3400, desc: 'Cooler charge, more power per bar.', fx: { ic: 0.15, kg: 6 } },
    ] },
    { id: 'bov', name: 'Blow-off valve', options: [
      { id: 'recirc', name: 'Recirculating', price: 0, desc: 'Quiet.' },
      { id: 'atmo', name: 'Atmospheric (vent)', price: 450, desc: 'That pssh on every lift.', fx: { bov: 1 } },
    ] },
    { id: 'nitrous', name: 'Nitrous oxide', options: [
      { id: 'none', name: 'None', price: 0, desc: '' },
      { id: 'n50', name: 'Wet kit, 50 shot', price: 1900, desc: '+50 hp while held (N). 15 s bottle.', fx: { nos: 50, nosCap: 15 } },
      { id: 'n100', name: 'Wet kit, 100 shot', price: 2600, desc: '+100 hp. 12 s bottle.', fx: { nos: 100, nosCap: 12 } },
      { id: 'n150', name: 'Direct port, 150 shot', price: 5200, desc: '+150 hp. 10 s bottle.', fx: { nos: 150, nosCap: 10 } },
    ] },
  ] },
  drivetrain: { title: 'Drivetrain', slots: [
    { id: 'clutch', name: 'Clutch', options: [
      { id: 'stock', name: 'Factory twin wet clutch', price: 0, desc: '' },
      { id: 'race', name: 'Race clutch packs', price: 7200, desc: 'Harder launches, quicker shifts.', fx: { launch: 1500, shift: -0.03 } },
    ] },
    { id: 'gearbox', name: 'Transmission', options: [
      { id: 'stock', name: '7-speed DCT', price: 0, desc: '150 ms shifts.' },
      { id: 'close', name: 'Close-ratio 7-speed', price: 9800, desc: 'Tighter ratios. Adjustable final drive.', fx: { gears: [3.08, 2.3, 1.82, 1.48, 1.22, 1.03, 0.88], shift: -0.04, adjFinal: 1 } },
      { id: 'seq', name: 'Race 6-speed sequential', price: 28000, desc: 'Straight-cut, fully adjustable, 40 ms shifts. Whines.', fx: { gears: [2.92, 2.12, 1.66, 1.35, 1.12, 0.94], shift: -0.11, adjFinal: 1, adjGears: 1, whine: 1, kg: -12 } },
    ] },
    { id: 'diff', name: 'Differential', options: [
      { id: 'stock', name: 'E-Diff (factory)', price: 0, desc: 'Electronic slip control.' },
      { id: 'sport', name: 'Sport LSD', price: 3600, desc: 'Plated limited slip. Adjustable lock.', fx: { adjDiff: 1, diff: 0.45 } },
      { id: 'race', name: 'Race LSD', price: 6800, desc: 'Wide adjustment range. Loves drifting.', fx: { adjDiff: 1, diff: 0.65 } },
    ] },
    { id: 'driveline', name: 'Driveline', options: [
      { id: 'stock', name: 'Factory', price: 0, desc: '' },
      { id: 'carbon', name: 'Carbon half-shafts', price: 4100, desc: 'Less rotating mass.', fx: { kg: -6, eff: 0.01 } },
    ] },
  ] },
  chassis: { title: 'Chassis & suspension', slots: [
    { id: 'suspension', name: 'Suspension', options: [
      { id: 'stock', name: 'Magnetorheological dampers', price: 0, desc: 'Comfortable and composed.' },
      { id: 'sport', name: 'Sport springs & dampers', price: 3900, desc: '25 mm lower, less roll. Adjustable alignment.', fx: { grip: 0.03, roll: -0.25, lower: 25, adjAlign: 1 } },
      { id: 'coil', name: 'Street coilovers', price: 6400, desc: 'Adjustable height, springs and alignment.', fx: { grip: 0.045, roll: -0.35, adjAlign: 1, adjHeight: 1, adjSprings: 1 } },
      { id: 'race', name: 'Race coilovers (2-way)', price: 11800, desc: 'Full adjustment including damping.', fx: { grip: 0.07, roll: -0.5, adjAlign: 1, adjHeight: 1, adjSprings: 1, adjDamp: 1 } },
      { id: 'rally', name: 'Rally long-travel', price: 9500, desc: 'Raised, soft and tough. Big gain off-road.', fx: { grip: -0.02, roll: 0.25, lower: -60, offroad: 0.35, adjHeight: 1, adjSprings: 1 } },
    ] },
    { id: 'arb', name: 'Anti-roll bars', options: [
      { id: 'stock', name: 'Factory', price: 0, desc: '' },
      { id: 'adj', name: 'Adjustable sport bars', price: 1700, desc: 'Tune the handling balance.', fx: { adjArb: 1, roll: -0.15 } },
    ] },
    { id: 'bracing', name: 'Chassis bracing', options: [
      { id: 'stock', name: 'Factory', price: 0, desc: '' },
      { id: 'brace', name: 'Strut & floor braces', price: 2400, desc: 'Sharper response.', fx: { grip: 0.015, resp: 0.1, kg: 8 } },
      { id: 'cage', name: 'FIA roll cage', price: 9800, desc: 'Bolted-in 6-point cage. Much stiffer.', fx: { grip: 0.03, resp: 0.2, kg: 32, cage: 1 } },
    ] },
    { id: 'weight', name: 'Weight reduction', options: [
      { id: 'stock', name: 'None', price: 0, desc: '' },
      { id: 's1', name: 'Stage 1', price: 2500, desc: 'Lithium battery, lighter glazing.', fx: { kg: -38 } },
      { id: 's2', name: 'Stage 2', price: 9000, desc: 'Strip sound deadening and trim.', fx: { kg: -82 } },
      { id: 's3', name: 'Stage 3 race', price: 24000, desc: 'Carbon doors, polycarbonate windows, no A/C.', fx: { kg: -135 } },
    ] },
    { id: 'panels', name: 'Carbon panels', options: [
      { id: 'stock', name: 'Aluminium', price: 0, desc: '' },
      { id: 'hood', name: 'Carbon front lid', price: 5200, desc: '', fx: { kg: -8 } },
      { id: 'full', name: 'Carbon lid, deck & doors', price: 21000, desc: '', fx: { kg: -26 } },
    ] },
  ] },
  brakes: { title: 'Brakes', slots: [
    { id: 'brakes', name: 'Brake system', options: [
      { id: 'stock', name: 'Carbon-ceramic (factory)', price: 0, desc: '398 / 360 mm discs.' },
      { id: 'sport', name: 'Sport pads & lines', price: 1600, desc: 'More bite, adjustable balance.', fx: { brake: 0.1, adjBrake: 1 } },
      { id: 'race', name: 'Race 6-piston calipers', price: 14000, desc: 'Bigger discs, monoblock calipers.', fx: { brake: 0.25, adjBrake: 1, kg: -4 } },
    ] },
  ] },
  tires: { title: 'Tires', slots: [
    { id: 'compound', name: 'Compound', options: [
      { id: 'street', name: 'All-season', price: 0, desc: 'Durable, modest grip.', fx: { mu: 1.0, cs: 0.9, off: 0.72 } },
      { id: 'sport', name: 'Summer performance (factory)', price: 1400, desc: 'The car as delivered.', fx: { mu: 1.12, cs: 1.0, off: 0.68 } },
      { id: 'semi', name: 'Semi-slick (Trofeo R)', price: 2600, desc: 'Track-focused, street legal.', fx: { mu: 1.25, cs: 1.12, off: 0.6 } },
      { id: 'slick', name: 'Race slick', price: 3800, desc: 'Maximum dry grip. Hopeless off-road.', fx: { mu: 1.4, cs: 1.25, off: 0.45 } },
      { id: 'rally', name: 'Gravel rally', price: 1900, desc: 'Grips on dirt, slides on tarmac.', fx: { mu: 0.95, cs: 0.85, off: 0.95 } },
    ] },
    { id: 'width', name: 'Tire width', options: [
      { id: 'stock', name: '235 / 295', price: 0, desc: 'Factory sizes.' },
      { id: 'wide', name: '255 / 315', price: 900, desc: 'More grip, a little drag.', fx: { grip: 0.04, cd: 0.01, kg: 4 } },
      { id: 'xwide', name: '275 / 345 (needs widebody)', price: 1500, desc: 'Huge contact patch.', fx: { grip: 0.08, cd: 0.025, kg: 8 } },
    ] },
  ] },
  aero: { title: 'Aero', slots: [
    { id: 'front', name: 'Front aero', options: [
      { id: 'stock', name: 'Factory bumper', price: 0, desc: 'Flexible winglets.' },
      { id: 'lip', name: 'Carbon lip', price: 1800, desc: 'Small front downforce gain.', fx: { clF: 0.14, cd: 0.01 } },
      { id: 'splitter', name: 'Race splitter', price: 4200, desc: 'Adjustable front downforce.', fx: { clF: 0.3, cd: 0.02, adjAeroF: 1 } },
      { id: 'canards', name: 'Race splitter + canards', price: 5600, desc: 'Most front downforce.', fx: { clF: 0.45, cd: 0.035, adjAeroF: 1 } },
    ] },
    { id: 'rear', name: 'Rear wing', options: [
      { id: 'stock', name: 'Factory deck', price: 0, desc: '' },
      { id: 'ducktail', name: 'Ducktail spoiler', price: 2200, desc: 'Cleans up rear lift.', fx: { clR: 0.18, cd: 0.005 } },
      { id: 'gt', name: 'GT wing', price: 5800, desc: 'Adjustable angle.', fx: { clR: 0.6, cd: 0.045, adjAeroR: 1 } },
      { id: 'swan', name: 'Swan-neck wing', price: 7900, desc: 'Clean underside, very efficient.', fx: { clR: 0.75, cd: 0.04, adjAeroR: 1 } },
      { id: 'attack', name: 'Time-attack wing', price: 11000, desc: 'Enormous downforce, enormous drag.', fx: { clR: 1.15, cd: 0.09, adjAeroR: 1 } },
    ] },
    { id: 'diffuser', name: 'Diffuser', options: [
      { id: 'stock', name: 'Factory', price: 0, desc: '' },
      { id: 'race', name: 'Race diffuser', price: 3600, desc: 'Downforce with almost no drag.', fx: { clR: 0.18, clF: 0.05 } },
    ] },
    { id: 'skirts', name: 'Side skirts', options: [
      { id: 'stock', name: 'Factory', price: 0, desc: '' },
      { id: 'carbon', name: 'Carbon side skirts', price: 1900, desc: '', fx: { clF: 0.03, clR: 0.03 } },
    ] },
  ] },
};

// Visual / cosmetic options (no physics), used by the garage UI
export const PAINTS = [
  ['Rosso Corsa', '#b5120e'], ['Rosso Scuderia', '#d01a10'], ['Giallo Modena', '#f2c200'], ['Blu Pozzi', '#13285e'],
  ['Blu Tour de France', '#1c3b8a'], ['Nero Daytona', '#0c0c0f'], ['Bianco Avus', '#ecebe6'], ['Grigio Silverstone', '#6f7378'],
  ['Grigio Titanio', '#4a4d52'], ['Verde British', '#163a2a'], ['Arancio Borealis', '#e2601a'], ['Viola Hong Kong', '#3d1a4a'],
  ['Azzurro California', '#7fb4d8'], ['Argento Nürburgring', '#a9adb3'], ['Burgundy', '#5a0f18'], ['Forest Green', '#1f4a2c'],
];
export const FINISHES = {
  gloss: { name: 'Gloss', metalness: 0.15, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.02 },
  metallic: { name: 'Metallic', metalness: 0.7, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.03 },
  pearl: { name: 'Pearlescent', metalness: 0.5, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.03, iridescence: 0.8 },
  satin: { name: 'Satin', metalness: 0.4, roughness: 0.5, clearcoat: 0.3, clearcoatRoughness: 0.4 },
  matte: { name: 'Matte', metalness: 0.2, roughness: 0.72, clearcoat: 0, clearcoatRoughness: 1 },
  chrome: { name: 'Chrome wrap', metalness: 1, roughness: 0.06, clearcoat: 0.5, clearcoatRoughness: 0.05 },
};
export const RIMS = {
  stock: 'Factory 5-spoke', five: 'Forged 5-spoke', ten: 'Split 10-spoke', mesh: 'Cross-spoke mesh',
  turbine: 'Turbine', dish: 'Deep-dish 6-spoke', y: 'Y-spoke', mono: 'Monoblock 7-spoke', center: 'Center-lock race',
};

export function defaultBuild() {
  const parts = {};
  for (const cat of Object.values(CATALOG)) for (const s of cat.slots) parts[s.id] = s.id === 'compound' ? 'sport' : s.options[0].id;
  return {
    v: 1, parts,
    tune: {
      pressF: 2.1, pressR: 2.0, camberF: -1.2, camberR: -1.0, toeF: 0, toeR: 0.1,
      arbF: 30, arbR: 25, springF: 95, springR: 110, heightF: 0, heightR: 0, bumpF: 6, bumpR: 6, reboundF: 8, reboundR: 8,
      aeroF: 0.5, aeroR: 0.5, brakeBias: 58, brakePress: 100, diffAccel: 45, diffDecel: 20,
      final: 4.44, gearScale: [1, 1, 1, 1, 1, 1, 1], boost: 1.0, limiter: 0, steerLock: 1.0,
    },
    assists: { abs: true, tc: 1, sc: true, gearbox: 'auto' },
    look: {
      paint: '#b5120e', finish: 'gloss', rim: 'stock', rimColor: '#3a3c41', rimFinish: 'metal', rimSize: 20,
      caliper: '#d4a017', stripes: 'none', stripeColor: '#f2f0e8', tint: 0.55,
      kitFront: 'auto', kitRear: 'auto', widebody: false, ride: 0, camberLook: 0, spacers: 0,
      headlight: '#fff4e0', underglow: 'none', smokedTails: false, exhaustTips: 'stock',
      leather: '#1a1a1c', accent: '#b5120e', carbonTrim: true, seats: 'stock', carpet: '#1c1c1e', harness: false,
      plate: 'ALCAN',
    },
  };
}

export function optionOf(build, slotId) {
  for (const cat of Object.values(CATALOG)) for (const s of cat.slots) if (s.id === slotId) return s.options.find(o => o.id === build.parts[slotId]) || s.options[0];
  return null;
}

// ------------------------------------------------------------------ spec
export function buildSpec(build) {
  const t = build.tune;
  const s = {
    mass: BASE.mass, frontWeight: BASE.frontWeight, cgH: BASE.cgH, wheelR: BASE.wheelR, idle: BASE.idle,
    limiter: BASE.limiter, low: 1, mid: 1, top: 1, all: 1, inertia: 1,
    boost: 'none', boostMax: 0, boostCap: 0.6, fuelCap: 1.0, ic: 0.75, bov: 0,
    nos: 0, nosCap: 0,
    gears: BASE.gears.slice(), final: BASE.final, shift: 0.15, launch: 3500, eff: 0.88,
    diff: 0.3, adj: {},
    CdA: BASE.CdA, clF: BASE.ClA * 0.45, clR: BASE.ClA * 0.55,
    mu: 1.12, cs: 1.0, off: 0.68, grip: 0, roll: 1, resp: 0, offroad: 0, lower: 0,
    brake: 1.0, cage: 0,
    sound: { exhaust: 'stock', loud: 0, pops: 0.1, intake: 0, lope: 0, rasp: 0, whine: 0 },
  };
  for (const cat of Object.values(CATALOG)) for (const slot of cat.slots) {
    const o = slot.options.find(x => x.id === build.parts[slot.id]) || slot.options[0];
    const f = o.fx || {};
    for (const k of ['low', 'mid', 'top', 'all']) if (f[k]) s[k] += f[k];
    if (f.kg) s.mass += f.kg;
    if (f.limiter) s.limiter = Math.max(s.limiter, f.limiter);
    if (f.inertia) s.inertia += f.inertia;
    if (f.boost) { s.boost = f.boost; s.boostMax = f.boostMax; }
    if (f.boostCap) s.boostCap = f.boostCap;
    if (f.fuelCap) s.fuelCap = f.fuelCap;
    if (f.ic) s.ic += f.ic;
    if (f.bov) s.bov = 1;
    if (f.nos) { s.nos = f.nos; s.nosCap = f.nosCap; }
    if (f.gears) s.gears = f.gears.slice();
    if (f.shift) s.shift += f.shift;
    if (f.launch) s.launch += f.launch;
    if (f.eff) s.eff += f.eff;
    if (f.diff) s.diff = f.diff;
    if (f.cd) s.CdA += f.cd;
    if (f.clF) s.clF += f.clF;
    if (f.clR) s.clR += f.clR;
    if (f.mu) { s.mu = f.mu; s.cs = f.cs; s.off = f.off; }
    if (f.grip) s.grip += f.grip;
    if (f.roll) s.roll += f.roll;
    if (f.resp) s.resp += f.resp;
    if (f.offroad) s.offroad += f.offroad;
    if (f.lower) s.lower += f.lower;
    if (f.brake) s.brake += f.brake;
    if (f.cage) s.cage = 1;
    for (const k of Object.keys(f)) if (k.startsWith('adj')) s.adj[k.slice(3).toLowerCase()] = 1;
    if (f.exhaust) s.sound.exhaust = f.exhaust;
    if (f.loud) s.sound.loud = Math.max(s.sound.loud, f.loud);
    if (f.pops) s.sound.pops += f.pops;
    if (f.intake) s.sound.intake = Math.max(s.sound.intake, f.intake);
    if (f.lope) s.sound.lope = f.lope;
    if (f.rasp) s.sound.rasp += f.rasp;
    if (f.whine) s.sound.whine = 1;
  }
  if (build.parts.aspiration !== 'na') s.sound.turbo = s.boost;
  // tuning (only what the installed parts allow)
  if (s.adj.final) s.final = t.final;
  if (s.adj.gears) s.gears = s.gears.map((g, i) => g * (t.gearScale[i] ?? 1));
  if (s.boostMax) s.boostMax = Math.min(s.boostMax * t.boost, s.boostCap, s.fuelCap);
  if (t.limiter && s.adj.gears) s.limiter = Math.min(s.limiter, Math.max(7000, t.limiter));
  // aero: adjustable parts scale with the wing / splitter angle
  if (s.adj.aerof) s.clF *= 0.6 + 0.8 * t.aeroF;
  if (s.adj.aeror) { s.clR *= 0.6 + 0.8 * t.aeroR; s.CdA += 0.04 * (t.aeroR - 0.5); }
  // tires & alignment
  const pressF = 1 - 0.12 * (t.pressF - 2.05) ** 2, pressR = 1 - 0.12 * (t.pressR - 2.0) ** 2;
  const camF = s.adj.align ? 1 + 0.035 - 0.025 * (t.camberF + 1.6) ** 2 : 1, camR = s.adj.align ? 1 + 0.025 - 0.025 * (t.camberR + 1.1) ** 2 : 1;
  const arbBal = s.adj.arb ? (t.arbF - t.arbR) / 65 : (30 - 25) / 65;
  const springBal = s.adj.springs ? (t.springF - t.springR) / 200 : -0.075;
  const bal = arbBal * 0.12 + springBal * 0.08; // + = understeer
  s.muF = s.mu * (1 + s.grip) * pressF * camF * (1 - bal);
  s.muR = s.mu * (1 + s.grip) * pressR * camR * (1 + bal) * (1 + (s.adj.align ? t.toeR * 0.03 : 0.003));
  s.csF = 95000 * s.cs * (0.85 + 0.075 * t.pressF) * (1 + s.resp) * (1 + (s.adj.align ? -t.toeF * 0.08 : 0));
  s.csR = 152000 * s.cs * (0.85 + 0.075 * t.pressR) * (1 + s.resp);
  s.offMu = s.off + s.offroad;
  s.rideF = -s.lower / 1000 + (s.adj.height ? t.heightF / 1000 : 0);
  s.rideR = -s.lower / 1000 + (s.adj.height ? t.heightR / 1000 : 0);
  // lower car = more downforce, less drag
  const lowAvg = -(s.rideF + s.rideR) / 2;
  s.clF *= 1 + lowAvg * 4; s.clR *= 1 + lowAvg * 4; s.CdA *= 1 - lowAvg * 1.5;
  s.cgH = BASE.cgH + (s.rideF + s.rideR) / 2 - (s.cage ? 0.0 : 0);
  s.rollK = s.roll * (s.adj.springs ? 200 / (t.springF + t.springR) : 1) * (s.adj.arb ? 55 / (t.arbF + t.arbR) : 1);
  s.damp = s.adj.damp ? (t.bumpF + t.bumpR + t.reboundF + t.reboundR) / 28 : 1;
  s.brakeForce = 21000 * s.brake * (s.adj.brake ? t.brakePress / 100 : 1);
  s.brakeBias = s.adj.brake ? t.brakeBias / 100 : 0.58;
  s.diffAccel = s.adj.diff ? t.diffAccel / 100 : s.diff;
  s.diffDecel = s.adj.diff ? t.diffDecel / 100 : 0.2;
  s.steerLock = t.steerLock;
  s.assists = { ...build.assists };
  return s;
}

// engine torque (Nm) at rpm with a given boost (bar)
export function engineTorque(s, rpm, boost = 0) {
  let k = s.all;
  k += (s.low - 1) * (1 - sm(3000, 5500, rpm));
  k += (s.mid - 1) * sm(2500, 4500, rpm) * (1 - sm(6500, 8500, rpm));
  k += (s.top - 1) * sm(5500, 8000, rpm);
  // the factory map tails off hard beyond 9,000; better valvetrain carries it
  let r = rpm;
  if (rpm > 9000) r = 9000 + (rpm - 9000) * (s.limiter > 9500 ? 0.45 : s.limiter > 9000 ? 0.7 : 1);
  return table(r) * k * (1 + boost * 0.82 * s.ic);
}

// steady-state boost target for a given rpm/throttle
export function boostTarget(s, rpm, thr) {
  if (!s.boostMax) return 0;
  const rr = rpm / s.limiter;
  if (s.boost === 'centrifugal') return s.boostMax * rr * rr * (0.4 + 0.6 * thr);
  if (s.boost === 'roots') return s.boostMax * Math.min(1, rpm / 2200) * (0.3 + 0.7 * thr);
  const on = s.boost === 'turboBig' ? sm(4200, 6500, rpm) : sm(2800, 4800, rpm);
  return s.boostMax * on * thr;
}

// ------------------------------------------------------------------ performance
// Straight-line simulation using the same drivetrain model as the car.
export function performance(s) {
  const g = 9.81, rho = 1.225;
  let v = 0.01, t = 0, gear = 0, x = 0, boost = 0, shiftT = 0;
  let t100 = null, t200 = null, tq = null, vq = 0, top = 0, rpm = s.launch;
  const n = s.gears.length;
  for (let k = 0; k < 120000 && t < 90; k++) {
    const dt = 0.005;
    const ratio = s.gears[gear] * s.final;
    rpm = Math.max(v / s.wheelR * ratio * 60 / (2 * Math.PI), v < 8 ? s.launch * (1 - v / 8) + v / s.wheelR * ratio * 9.55 * (v / 8) : 0);
    if (rpm >= s.limiter * 0.985 && gear < n - 1 && shiftT <= 0) { gear++; shiftT = s.shift; continue; }
    const cut = rpm >= s.limiter;
    rpm = Math.min(rpm, s.limiter);
    const tb = boostTarget(s, rpm, 1);
    boost += (tb - boost) * Math.min(1, dt * (s.boost?.startsWith?.('turbo') ? 2.2 : 20));
    let T = engineTorque(s, rpm, boost);
    let F = shiftT > 0 || cut ? 0 : T * ratio * s.eff / s.wheelR;
    const down = 0.5 * rho * v * v * (s.clF + s.clR);
    const Nr = s.mass * g * (1 - s.frontWeight) + down * s.clR / (s.clF + s.clR) + (F / s.mass) * s.mass * s.cgH / 2.65;
    F = Math.min(F, s.muR * Nr * 1.02);
    const drag = 0.5 * rho * s.CdA * v * v + 0.012 * s.mass * g;
    const a = (F - drag) / s.mass;
    shiftT -= dt;
    v += a * dt; x += v * dt; t += dt;
    if (!t100 && v >= 27.78) t100 = t;
    if (!t200 && v >= 55.56) t200 = t;
    if (!tq && x >= 402.3) { tq = t; vq = v; }
    top = Math.max(top, v);
    if (t > 20 && a < 0.004 && gear === n - 1) break;
    if (t > 20 && a < 0.002) break;
  }
  // power peak
  let hp = 0, hpRpm = 0, nm = 0, nmRpm = 0;
  for (let r = 1000; r <= s.limiter; r += 100) {
    const T = engineTorque(s, r, boostTarget(s, r, 1));
    const p = T * r / 9549 * 1.341;
    if (p > hp) { hp = p; hpRpm = r; }
    if (T > nm) { nm = T; nmRpm = r; }
  }
  if (s.nos) hp += s.nos;
  const down100 = 0.5 * rho * 27.78 ** 2 * (s.clF + s.clR);
  const muAvg = (s.muF * 0.45 + s.muR * 0.55);
  const latG = muAvg * (s.mass * g + down100) / (s.mass * g) * 0.92;
  const decel = Math.min(s.brakeForce / s.mass, muAvg * g * (1 + down100 / (s.mass * g)) * (s.assists.abs ? 0.96 : 0.9));
  const brake100 = 27.78 ** 2 / (2 * decel);
  const accel = Math.min(10, 10 * 2.0 / (t100 || 9));
  const speed = Math.min(10, top * 3.6 / 40);
  const handling = Math.min(10, latG / 1.75 * 10);
  const braking = Math.min(10, 10 * 26 / brake100);
  const launch = Math.min(10, 10 * 1.4 / Math.max(0.5, (t100 || 9) - 1.6) * 0.75);
  const pi = Math.round(Math.max(100, Math.min(999, 100 + 900 * ((accel * 0.32 + speed * 0.18 + handling * 0.34 + braking * 0.16) / 10 + 0.517) / 1.489)));
  const cls = pi > 998 ? 'X' : pi > 900 ? 'S2' : pi > 800 ? 'S1' : pi > 700 ? 'A' : pi > 600 ? 'B' : pi > 500 ? 'C' : 'D';
  return {
    hp, hpRpm, kw: hp / 1.341, nm, nmRpm, kg: s.mass, pwr: hp / (s.mass / 1000),
    t100, t200, tq, vq: vq * 3.6, top: top * 3.6, brake100, latG,
    bars: { speed, handling, accel, launch, braking }, pi, cls,
  };
}

export function buildCost(build) {
  let sum = 0;
  for (const cat of Object.values(CATALOG)) for (const s of cat.slots) {
    const o = s.options.find(x => x.id === build.parts[s.id]);
    if (o && !(s.id === 'compound' && o.id === 'sport')) sum += o.price;
  }
  const L = build.look;
  if (L.paint !== '#b5120e' || L.finish !== 'gloss') sum += L.finish === 'chrome' ? 7500 : L.finish === 'pearl' ? 12000 : 6500;
  if (L.rim !== 'stock') sum += 5200;
  if (L.stripes !== 'none') sum += 1400;
  if (L.widebody) sum += 18000;
  if (L.underglow !== 'none') sum += 450;
  if (L.seats !== 'stock') sum += L.seats === 'carbon' ? 9800 : 4200;
  if (L.harness) sum += 1100;
  return sum;
}

const KEY = 'alcan-build-v1';
export function loadBuild() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const b = JSON.parse(raw), d = defaultBuild();
      return { ...d, ...b, parts: { ...d.parts, ...b.parts }, tune: { ...d.tune, ...b.tune }, assists: { ...d.assists, ...b.assists }, look: { ...d.look, ...b.look } };
    }
  } catch (e) { /* storage blocked */ }
  return defaultBuild();
}
export function saveBuild(b) { try { localStorage.setItem(KEY, JSON.stringify(b)); } catch (e) { /* ignore */ } }
