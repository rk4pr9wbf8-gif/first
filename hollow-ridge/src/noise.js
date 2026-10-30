// Seeded simplex noise and helpers shared by world generation.
export function mulberry32(a) {
  return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export const SEED = 1031;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const lerp = (a, b, t) => a + (b - a) * t;
export const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
export function smin(a, b, k) { const h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1); return lerp(b, a, h) - k * h * (1 - h); }

const perm = new Uint8Array(512);
{
  const r = mulberry32(SEED); const p = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
}
const GX = [1, -1, 1, -1, 1, -1, 0, 0], GY = [1, 1, -1, -1, 0, 0, 1, -1];
const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
export function N(xin, yin) {
  let n0 = 0, n1 = 0, n2 = 0;
  const s = (xin + yin) * F2, i = Math.floor(xin + s), j = Math.floor(yin + s);
  const t = (i + j) * G2, x0 = xin - (i - t), y0 = yin - (j - t);
  const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
  const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
  const ii = i & 255, jj = j & 255;
  let t0 = 0.5 - x0 * x0 - y0 * y0; if (t0 > 0) { t0 *= t0; const g = perm[ii + perm[jj]] & 7; n0 = t0 * t0 * (GX[g] * x0 + GY[g] * y0); }
  let t1 = 0.5 - x1 * x1 - y1 * y1; if (t1 > 0) { t1 *= t1; const g = perm[ii + i1 + perm[jj + j1]] & 7; n1 = t1 * t1 * (GX[g] * x1 + GY[g] * y1); }
  let t2 = 0.5 - x2 * x2 - y2 * y2; if (t2 > 0) { t2 *= t2; const g = perm[ii + 1 + perm[jj + 1]] & 7; n2 = t2 * t2 * (GX[g] * x2 + GY[g] * y2); }
  return 70 * (n0 + n1 + n2);
}
export function fbm(x, z, oct, freq) {
  let a = 1, f = freq, s = 0, n = 0;
  for (let o = 0; o < oct; o++) { s += a * N(x * f + o * 13.7, z * f - o * 7.3); n += a; a *= 0.5; f *= 2.03; }
  return s / n;
}
// Derivative-damped fbm: detail fades on steep ground, which reads like water-carved gullies and spurs.
export function eroded(x, z, oct, freq) {
  let a = 1, f = freq, s = 0, n = 0, dx = 0, dz = 0;
  const e = 0.02;
  for (let o = 0; o < oct; o++) {
    const px = x * f + o * 17.3, pz = z * f - o * 9.1;
    const v = N(px, pz), gx = (N(px + e, pz) - v) / e, gz = (N(px, pz + e) - v) / e;
    dx += gx * a; dz += gz * a;
    s += a * v / (1 + (dx * dx + dz * dz) * 0.6);
    n += a; a *= 0.5; f *= 2.0;
  }
  return s / n;
}
