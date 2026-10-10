// Natural terrain: the landscape before any road is cut into it.
// Two blended "biomes" drive the look of the land:
//   0 = Cascadia (Douglas fir, vine maple, stratovolcanoes, lower relief)
//   1 = Alaska   (spruce & birch, glaciated ranges, fjords, low snowline)
import { noise2, fbm, ridged, hash2, smoothstep, clamp, lerp } from './noise.js';

export const SEA_LEVEL = 0;

export function biomeAt(x, z) {
  const n = fbm(x * 0.000026 + 11.3, z * 0.000026 - 7.1, 2) + 0.08;
  return smoothstep(-0.16, 0.16, n);
}

const VCELL = 15000;
function volcanoes(x, z) {
  const ci = Math.floor(x / VCELL), cj = Math.floor(z / VCELL);
  let h = 0;
  for (let di = -1; di <= 1; di++) {
    for (let dj = -1; dj <= 1; dj++) {
      const i = ci + di, j = cj + dj;
      if (hash2(i, j, 1) > 0.42) continue;
      const cx = (i + 0.2 + 0.6 * hash2(i, j, 2)) * VCELL;
      const cz = (j + 0.2 + 0.6 * hash2(i, j, 3)) * VCELL;
      const H = 1700 + 1500 * hash2(i, j, 4);
      const R = H * 2.3;
      const dx = x - cx, dz = z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= R * R) continue;
      const d = Math.sqrt(d2);
      const t = 1 - d / R;
      // radial gullies carved by glaciers and lahars
      const inv = 1 / (d + 1);
      const gully = ridged(dx * inv * 3 + i * 7.1 + d * 0.0011, dz * inv * 3 + j * 3.3 + d * 0.0011, 3);
      const prof = Math.pow(t, 2.4);
      const crater = smoothstep(0.955, 1.0, t) * 0.035;
      h += H * (prof - crater) * (1 - 0.22 * gully * Math.min(1, t * 2.5) * (1 - t));
    }
  }
  return h;
}

export function baseHeight(x, z) {
  const a = biomeAt(x, z);
  const wx = x + 700 * noise2(x * 0.00019 + 3.1, z * 0.00019 + 1.7);
  const wz = z + 700 * noise2(x * 0.00019 - 8.2, z * 0.00019 + 4.4);
  const mask = smoothstep(-0.55, 0.4, fbm(x * 0.00011 + 40, z * 0.00011 - 12, 2));
  const r = ridged(wx * 0.00023, wz * 0.00023, 6);
  const massif = 0.4 + 0.5 * fbm(x * 0.00017 + 70, z * 0.00017 - 30, 3);
  const peaks = (Math.pow(r, 1.65) * 0.75 + massif * massif * 0.25) * (1500 + 1000 * a) * (0.2 + 0.8 * mask);
  const lowland = 150 + 170 * noise2(x * 0.00005 + 5.5, z * 0.00005 + 9.1)
    - a * (110 + 190 * Math.max(0, noise2(x * 0.00007 - 3, z * 0.00007 + 2)));
  const hills = fbm(x * 0.0017 + 7, z * 0.0017 - 3, 3) * 34;
  // drainage gullies scored into the mountain flanks
  const mount = smoothstep(150, 900, peaks);
  const gully = mount > 0.01 ? Math.pow(1 - Math.abs(noise2(wx * 0.0021 + 13, wz * 0.0021 - 7)), 6) * 32 * mount
    + Math.pow(1 - Math.abs(noise2(wx * 0.0053 - 4, wz * 0.0053 + 9)), 8) * 12 * mount : 0;
  const detail = noise2(x * 0.011, z * 0.011) * 2.6 + noise2(x * 0.04, z * 0.04) * 0.6;
  return lowland + peaks + hills - gully + detail + volcanoes(x, z);
}

export function treeline(x, z, a) {
  return lerp(1650, 780, a) + 140 * noise2(x * 0.0021, z * 0.0021);
}

export function snowline(x, z, a) {
  return lerp(1900, 1050, a) + 160 * noise2(x * 0.0013, z * 0.0013);
}

// 0..1 forest cover. slope = 1 - normal.y
export function forestDensity(x, z, h, slope, a) {
  if (h < SEA_LEVEL + 1.2) return 0;
  let d = 0.8 + 0.7 * fbm(x * 0.0024 + 31, z * 0.0024 - 17, 2);
  const tl = treeline(x, z, a);
  d *= 1 - smoothstep(tl - 260, tl, h);
  d *= 1 - smoothstep(0.5, 0.78, slope);
  return clamp(d, 0, 1);
}

// Fraction of broadleaf (fall-colour) trees.
export function deciduousFraction(x, z, h, a) {
  const n = noise2(x * 0.0019 - 51, z * 0.0019 + 23);
  let f = 0.26 + 0.3 * n + 0.12 * a;
  f *= 1 - smoothstep(350, 1250, h) * 0.8;
  return clamp(f, 0.02, 0.95);
}

// 0 = crimson stands, 1 = golden stands
export function foliageHue(x, z, a) {
  return clamp(0.5 + 0.7 * noise2(x * 0.004 + 9, z * 0.004 - 4) + 0.35 * a, 0, 1);
}

const CASCADIA = [
  'North Cascades', 'Skagit Valley', 'Mount Baker Wilderness', 'Stevens Pass',
  'Gifford Pinchot', 'Olympic Foothills', 'Mount Hood Corridor', 'Snoqualmie Pass',
  'Rainy Pass', 'Hoh Valley', 'Columbia Gorge', 'Glacier Peak',
];
const ALASKA = [
  'Chugach Range', 'Turnagain Arm', 'Kenai Peninsula', 'Thompson Pass',
  'Hatcher Pass', 'Denali Highway', 'Matanuska Valley', 'Wrangell Foothills',
  'Prince William Sound', 'Kachemak Bay', 'Seward Highway', 'Alaska Range',
];

export function regionAt(x, z) {
  const a = biomeAt(x, z);
  const C = 7000;
  const i = Math.floor((x + 1500 * noise2(x * 0.0002, z * 0.0002)) / C);
  const j = Math.floor((z + 1500 * noise2(x * 0.0002 + 5, z * 0.0002 - 5)) / C);
  const list = a > 0.5 ? ALASKA : CASCADIA;
  const name = list[Math.floor(hash2(i, j, 77) * list.length)];
  return { name, state: a > 0.5 ? 'ALASKA' : (hash2(i, j, 78) < 0.75 ? 'WASHINGTON' : 'OREGON'), alaska: a > 0.5 };
}
