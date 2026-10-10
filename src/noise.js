// Seeded 2D simplex noise, fractal helpers and small math utilities.
// Everything in the world is derived from these functions, so the same
// seed always produces the same mountains, roads and forests.

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const GX = new Float32Array([1, -1, 1, -1, 1, -1, 1, -1, 0, 0, 0, 0]);
const GY = new Float32Array([1, 1, -1, -1, 0, 0, 0, 0, 1, -1, 1, -1]);
const perm = new Uint8Array(512);
const permMod12 = new Uint8Array(512);

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedNoise(seed) {
  const rnd = mulberry32(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  for (let i = 0; i < 512; i++) {
    perm[i] = p[i & 255];
    permMod12[i] = perm[i] % 12;
  }
}
seedNoise(1337);

export function noise2(xin, yin) {
  const s = (xin + yin) * F2;
  const i = Math.floor(xin + s);
  const j = Math.floor(yin + s);
  const t = (i + j) * G2;
  const x0 = xin - (i - t);
  const y0 = yin - (j - t);
  let i1, j1;
  if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }
  const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
  const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
  const ii = i & 255, jj = j & 255;
  let n = 0;
  let t0 = 0.5 - x0 * x0 - y0 * y0;
  if (t0 > 0) { const g = permMod12[ii + perm[jj]]; t0 *= t0; n += t0 * t0 * (GX[g] * x0 + GY[g] * y0); }
  let t1 = 0.5 - x1 * x1 - y1 * y1;
  if (t1 > 0) { const g = permMod12[ii + i1 + perm[jj + j1]]; t1 *= t1; n += t1 * t1 * (GX[g] * x1 + GY[g] * y1); }
  let t2 = 0.5 - x2 * x2 - y2 * y2;
  if (t2 > 0) { const g = permMod12[ii + 1 + perm[jj + 1]]; t2 *= t2; n += t2 * t2 * (GX[g] * x2 + GY[g] * y2); }
  return 70 * n;
}

// Fractal Brownian motion, roughly in [-1, 1].
export function fbm(x, y, oct) {
  let sum = 0, amp = 1, norm = 0, f = 1;
  for (let o = 0; o < oct; o++) {
    sum += noise2(x * f + o * 17.3, y * f - o * 9.1) * amp;
    norm += amp; amp *= 0.5; f *= 2.02;
  }
  return sum / norm;
}

// Ridged multifractal in [0, 1]: sharp crests, broad valleys.
export function ridged(x, y, oct) {
  let sum = 0, amp = 0.5, f = 1, w = 1, norm = 0;
  for (let o = 0; o < oct; o++) {
    let n = 1 - Math.abs(noise2(x * f + o * 31.7, y * f - o * 11.3));
    n *= n; n *= w;
    w = n * 1.7; if (w > 1) w = 1; else if (w < 0) w = 0;
    sum += n * amp; norm += amp;
    f *= 2.05; amp *= 0.46;
  }
  return sum / norm;
}

export function hash2(i, j, k = 0) {
  let h = Math.imul(i | 0, 374761393) ^ Math.imul(j | 0, 668265263) ^ Math.imul(k | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export function smoothstep(a, b, x) {
  let t = (x - a) / (b - a);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}
