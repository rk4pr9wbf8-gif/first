// Procedurally painted, seamlessly tiling textures (no image downloads).
import * as THREE from 'three';
import { mulberry32 } from './noise.js';

function tileValueNoise(size, period, seed) {
  const rnd = mulberry32(seed);
  const g = new Float32Array(period * period);
  for (let i = 0; i < g.length; i++) g[i] = rnd();
  const out = new Float32Array(size * size);
  const sc = period / size;
  for (let y = 0; y < size; y++) {
    const fy = y * sc, y0 = Math.floor(fy), ty = fy - y0, sy = ty * ty * (3 - 2 * ty);
    const ya = (y0 % period) * period, yb = ((y0 + 1) % period) * period;
    for (let x = 0; x < size; x++) {
      const fx = x * sc, x0 = Math.floor(fx), tx = fx - x0, sx = tx * tx * (3 - 2 * tx);
      const xa = x0 % period, xb = (x0 + 1) % period;
      const a = g[ya + xa] + (g[ya + xb] - g[ya + xa]) * sx;
      const b = g[yb + xa] + (g[yb + xb] - g[yb + xa]) * sx;
      out[y * size + x] = a + (b - a) * sy;
    }
  }
  return out;
}

function tileFbm(size, basePeriod, oct, seed) {
  const out = new Float32Array(size * size);
  let amp = 1, norm = 0, p = basePeriod;
  for (let o = 0; o < oct; o++) {
    const n = tileValueNoise(size, p, seed + o * 101);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
    norm += amp; amp *= 0.5; p *= 2;
    if (p > size) break;
  }
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function fillFromField(ctx, size, fn) {
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let i = 0, p = 0; i < size * size; i++, p += 4) {
    const c = fn(i);
    d[p] = c[0]; d[p + 1] = c[1]; d[p + 2] = c[2]; d[p + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

// draw something at x,y and its wrapped copies so the tile stays seamless
function wrapDraw(size, x, y, r, fn) {
  for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
    const X = x + ox * size, Y = y + oy * size;
    if (X + r < 0 || X - r > size || Y + r < 0 || Y - r > size) continue;
    fn(X, Y);
  }
}

function toTex(c, srgb = true, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

const mix = (a, b, t) => a + (b - a) * t;

function grass(size = 512) {
  const c = canvas(size), ctx = c.getContext('2d');
  const n = tileFbm(size, 8, 5, 11), m = tileFbm(size, 4, 3, 12);
  fillFromField(ctx, size, i => {
    const v = n[i], w = m[i];
    return [mix(96, 150, v) * mix(0.8, 1.15, w), mix(92, 126, v), mix(40, 60, v) * mix(1.1, 0.8, w)];
  });
  const rnd = mulberry32(5);
  ctx.lineCap = 'round';
  for (let k = 0; k < 9000; k++) {
    const x = rnd() * size, y = rnd() * size, len = 4 + rnd() * 10, a = -Math.PI / 2 + (rnd() - 0.5) * 1.2;
    const t = rnd();
    const col = t < 0.45 ? `rgba(${170 + rnd() * 50|0},${150 + rnd() * 40|0},${70 + rnd() * 30|0},0.55)`
      : t < 0.8 ? `rgba(${100 + rnd() * 40|0},${110 + rnd() * 30|0},${45|0},0.5)`
      : `rgba(${60|0},${55|0},${30|0},0.45)`;
    ctx.strokeStyle = col; ctx.lineWidth = 0.8 + rnd() * 1.2;
    wrapDraw(size, x, y, len, (X, Y) => {
      ctx.beginPath(); ctx.moveTo(X, Y); ctx.lineTo(X + Math.cos(a) * len, Y + Math.sin(a) * len); ctx.stroke();
    });
  }
  return toTex(c);
}

function leafLitter(size = 512) {
  const c = canvas(size), ctx = c.getContext('2d');
  const n = tileFbm(size, 8, 5, 21);
  fillFromField(ctx, size, i => { const v = n[i]; return [mix(52, 92, v), mix(36, 60, v), mix(22, 34, v)]; });
  const rnd = mulberry32(7);
  const cols = [[178, 44, 30], [204, 82, 28], [222, 140, 40], [196, 160, 52], [120, 60, 30], [150, 30, 36], [90, 70, 40]];
  for (let k = 0; k < 2600; k++) {
    const x = rnd() * size, y = rnd() * size, r = 3 + rnd() * 6, a = rnd() * Math.PI;
    const cc = cols[Math.floor(rnd() * cols.length)], s = 0.6 + rnd() * 0.5;
    ctx.fillStyle = `rgba(${cc[0] * s|0},${cc[1] * s|0},${cc[2] * s|0},0.92)`;
    wrapDraw(size, x, y, r, (X, Y) => {
      ctx.beginPath(); ctx.ellipse(X, Y, r, r * 0.55, a, 0, Math.PI * 2); ctx.fill();
    });
  }
  // needles and twigs
  for (let k = 0; k < 1500; k++) {
    const x = rnd() * size, y = rnd() * size, len = 5 + rnd() * 9, a = rnd() * Math.PI * 2;
    ctx.strokeStyle = `rgba(${70 + rnd() * 40|0},${45 + rnd() * 20|0},${25},0.7)`; ctx.lineWidth = 1;
    wrapDraw(size, x, y, len, (X, Y) => { ctx.beginPath(); ctx.moveTo(X, Y); ctx.lineTo(X + Math.cos(a) * len, Y + Math.sin(a) * len); ctx.stroke(); });
  }
  return toTex(c);
}

function rock(size = 512) {
  const c = canvas(size), ctx = c.getContext('2d');
  const n = tileFbm(size, 4, 7, 31), m = tileFbm(size, 16, 4, 32), l = tileFbm(size, 8, 4, 33);
  fillFromField(ctx, size, i => {
    let v = n[i];
    const crack = Math.abs(m[i] - 0.5) < 0.012 ? 0.55 : 1;
    const strata = 0.92 + 0.08 * Math.sin(v * 40);
    v = mix(0.35, 1, v) * crack * strata;
    const lich = l[i] > 0.66 ? (l[i] - 0.66) * 2.2 : 0;
    return [mix(118 * v, 140, lich * 0.6), mix(116 * v, 150, lich * 0.6), mix(112 * v, 90, lich * 0.6)];
  });
  return toTex(c);
}

function snow(size = 256) {
  const c = canvas(size), ctx = c.getContext('2d');
  const n = tileFbm(size, 8, 5, 41);
  fillFromField(ctx, size, i => { const v = n[i]; return [mix(214, 250, v), mix(222, 252, v), mix(236, 255, v)]; });
  return toTex(c);
}

function gravel(size = 256) {
  const c = canvas(size), ctx = c.getContext('2d');
  const n = tileFbm(size, 8, 4, 51);
  fillFromField(ctx, size, i => { const v = n[i]; return [mix(70, 110, v), mix(66, 102, v), mix(60, 92, v)]; });
  const rnd = mulberry32(9);
  for (let k = 0; k < 1800; k++) {
    const x = rnd() * size, y = rnd() * size, r = 1 + rnd() * 2.8, g = 70 + rnd() * 90;
    ctx.fillStyle = `rgb(${g|0},${g * 0.96|0},${g * 0.9|0})`;
    wrapDraw(size, x, y, r, (X, Y) => { ctx.beginPath(); ctx.ellipse(X, Y, r, r * 0.7, rnd() * 3, 0, 7); ctx.fill(); });
  }
  return toTex(c);
}

// Asphalt with lane markings. u: across 11.2 m of pavement, v: 22.4 m along.
function asphalt() {
  const W = 512, H = 1024;
  const c = canvas(W, H), ctx = c.getContext('2d');
  const n = tileFbm(512, 32, 4, 61);
  const img = ctx.createImageData(W, H);
  const rnd = mulberry32(3);
  const ppm = W / 11.2;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = (y * W + x) * 4;
    const v = n[(y & 511) * 512 + x];
    const lat = x / ppm - 5.6;
    let g = mix(44, 64, v) + (rnd() - 0.5) * 22;
    // tyre polish in the wheel tracks
    const tr = Math.min(Math.abs(Math.abs(lat) - 1.0), Math.abs(Math.abs(lat) - 2.8));
    if (Math.abs(lat) < 4.8 && tr < 0.45) g *= 0.86;
    // gravel shoulder outside the fog line
    if (Math.abs(lat) > 5.0) g = mix(70, 96, v) + (rnd() - 0.5) * 34;
    img.data[p] = g; img.data[p + 1] = g * 0.98; img.data[p + 2] = g * 0.95; img.data[p + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const X = l => (l + 5.6) * ppm;
  // white fog lines
  ctx.fillStyle = 'rgba(236,236,228,0.93)';
  ctx.fillRect(X(-4.88), 0, 0.15 * ppm, H);
  ctx.fillRect(X(4.73), 0, 0.15 * ppm, H);
  // double yellow centre
  ctx.fillStyle = 'rgba(232,178,40,0.95)';
  ctx.fillRect(X(-0.22), 0, 0.12 * ppm, H);
  ctx.fillRect(X(0.10), 0, 0.12 * ppm, H);
  // wear on paint + cracks + tar seams
  for (let k = 0; k < 700; k++) {
    const x = rnd() * W, y = rnd() * H, r = 1 + rnd() * 3;
    ctx.fillStyle = `rgba(${50 + rnd() * 30|0},${50 + rnd() * 30|0},${48},${0.35 + rnd() * 0.4})`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  }
  ctx.strokeStyle = 'rgba(18,18,18,0.55)'; ctx.lineWidth = 1.6;
  for (let k = 0; k < 14; k++) {
    let x = X((rnd() - 0.5) * 9), y = rnd() * H;
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let s = 0; s < 12; s++) { x += (rnd() - 0.5) * 18; y += rnd() * 16; ctx.lineTo(x, y); }
    ctx.stroke();
  }
  const t = toTex(c);
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.anisotropy = 16;
  return t;
}

function concrete(size = 512) {
  const c = canvas(size), ctx = c.getContext('2d');
  const n = tileFbm(size, 8, 6, 71), s = tileFbm(size, 32, 3, 72);
  fillFromField(ctx, size, i => {
    const v = mix(0.72, 1, n[i]) * mix(0.92, 1.04, s[i]);
    const x = i % size, y = (i / size) | 0;
    const joint = (x % 256 < 2 || y % 128 < 2) ? 0.6 : 1;
    const g = 150 * v * joint;
    return [g, g * 0.98, g * 0.94];
  });
  return toTex(c);
}

// Grayscale RGBA noise for shader-side variation (r,g,b,a independent).
function noiseRGBA(size = 256) {
  const c = canvas(size), ctx = c.getContext('2d');
  const a = tileFbm(size, 4, 5, 81), b = tileFbm(size, 8, 5, 82), d = tileFbm(size, 16, 4, 83), e = tileFbm(size, 32, 3, 84);
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    img.data[i * 4] = a[i] * 255; img.data[i * 4 + 1] = b[i] * 255;
    img.data[i * 4 + 2] = d[i] * 255; img.data[i * 4 + 3] = e[i] * 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = toTex(c, false);
  t.premultiplyAlpha = false;
  return t;
}

function waterNormal(size = 256) {
  const c = canvas(size), ctx = c.getContext('2d');
  const h = tileFbm(size, 8, 5, 91);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    const dx = h[y * size + ((x + 1) % size)] - h[y * size + ((x - 1 + size) % size)];
    const dy = h[((y + 1) % size) * size + x] - h[((y - 1 + size) % size) * size + x];
    let nx = -dx * 6, ny = -dy * 6, nz = 1;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    img.data[i * 4] = (nx * 0.5 + 0.5) * 255; img.data[i * 4 + 1] = (ny * 0.5 + 0.5) * 255;
    img.data[i * 4 + 2] = (nz * 0.5 + 0.5) * 255; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return toTex(c, false);
}

function grassTuft(size = 128) {
  const c = canvas(size), ctx = c.getContext('2d');
  const rnd = mulberry32(13);
  ctx.lineCap = 'round';
  for (let k = 0; k < 70; k++) {
    const x0 = size * (0.2 + rnd() * 0.6), h = size * (0.45 + rnd() * 0.55);
    const bend = (rnd() - 0.5) * size * 0.5;
    const t = rnd();
    ctx.strokeStyle = t < 0.5 ? `rgb(${190 + rnd() * 40|0},${160 + rnd() * 40|0},${80 + rnd() * 30|0})`
      : t < 0.8 ? `rgb(${140 + rnd() * 30|0},${130 + rnd() * 30|0},${60})` : `rgb(${110},${120},${50})`;
    ctx.lineWidth = 1.5 + rnd() * 2;
    ctx.beginPath(); ctx.moveTo(x0, size);
    ctx.quadraticCurveTo(x0 + bend * 0.3, size - h * 0.6, x0 + bend, size - h);
    ctx.stroke();
  }
  const t = toTex(c, true, false);
  return t;
}

function leafSprite(size = 64) {
  const c = canvas(size), ctx = c.getContext('2d');
  ctx.translate(size / 2, size / 2);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  // simple maple leaf silhouette
  const pts = 5;
  for (let i = 0; i <= pts * 2; i++) {
    const a = -Math.PI / 2 + (i / (pts * 2)) * Math.PI * 2 * 0.86 - Math.PI * 0.43 + Math.PI / 2 - Math.PI / 2;
    const r = (i % 2 === 0 ? 0.46 : 0.22) * size;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.lineTo(0, size * 0.1);
  ctx.closePath(); ctx.fill();
  ctx.fillRect(-1, 0, 2, size * 0.45);
  const t = toTex(c, false, false);
  return t;
}

export function makeTextures() {
  return {
    grass: grass(), litter: leafLitter(), rock: rock(), snow: snow(), gravel: gravel(),
    asphalt: asphalt(), concrete: concrete(), noise: noiseRGBA(), water: waterNormal(),
    tuft: grassTuft(), leaf: leafSprite(),
  };
}

export function makeDetailNormals(tex) {
  return {
    grassN: normalFromTexture(tex.grass, 3), litterN: normalFromTexture(tex.litter, 4),
    rockN: normalFromTexture(tex.rock, 5), snowN: normalFromTexture(tex.snow, 2),
    gravelN: normalFromTexture(tex.gravel, 5), asphaltN: normalFromTexture(tex.asphalt, 2.5),
    concreteN: normalFromTexture(tex.concrete, 3),
  };
}

// ---------------------------------------------------------------- normal maps
// Derive a tangent-space normal map from an albedo canvas' luminance.
export function normalFromTexture(tex, strength = 2.5) {
  const src = tex.image;
  const w = src.width, h = src.height;
  const d = src.getContext('2d').getImageData(0, 0, w, h).data;
  const L = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) L[i] = (d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11) / 255;
  const c = canvas(w, h), ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const l = L[y * w + ((x - 1 + w) % w)], r = L[y * w + ((x + 1) % w)];
    const u = L[((y - 1 + h) % h) * w + x], dn = L[((y + 1) % h) * w + x];
    let nx = (l - r) * strength, ny = (u - dn) * strength, nz = 1;
    const k = 1 / Math.hypot(nx, ny, nz);
    const p = (y * w + x) * 4;
    img.data[p] = (nx * k * 0.5 + 0.5) * 255; img.data[p + 1] = (ny * k * 0.5 + 0.5) * 255;
    img.data[p + 2] = (nz * k * 0.5 + 0.5) * 255; img.data[p + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = toTex(c, false);
  t.wrapS = tex.wrapS; t.wrapT = tex.wrapT;
  return t;
}

// ---------------------------------------------------------------- foliage atlas
// 4x2 cells of 256 px: maple spray, birch spray, conifer branch, conifer
// silhouette, broadleaf crown, shrub, (spare), bark. Leaves are painted pale
// so per-instance tint gives each tree its fall colour.
export const ATLAS = { cols: 4, rows: 2, MAPLE: 0, BIRCH: 1, NEEDLE: 2, FIR: 3, CROWN: 4, SHRUB: 5, BARK: 7 };

function mapleLeaf(ctx, x, y, r, a) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.beginPath();
  for (let i = 0; i <= 10; i++) {
    const t = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const rr = (i % 2 === 0 ? 1 : 0.45) * r * (i === 4 || i === 6 ? 0.7 : 1);
    i === 0 ? ctx.moveTo(Math.cos(t) * rr, Math.sin(t) * rr) : ctx.lineTo(Math.cos(t) * rr, Math.sin(t) * rr);
  }
  ctx.closePath(); ctx.fill(); ctx.restore();
}
function ovalLeaf(ctx, x, y, r, a) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.beginPath();
  ctx.moveTo(0, -r); ctx.quadraticCurveTo(r * 0.7, 0, 0, r); ctx.quadraticCurveTo(-r * 0.7, 0, 0, -r);
  ctx.fill(); ctx.restore();
}

export function foliageAtlas() {
  const S = 256, c = canvas(S * 4, S * 2), ctx = c.getContext('2d');
  const rnd = mulberry32(77);
  const cell = (k) => [(k % 4) * S, Math.floor(k / 4) * S];
  const shade = (v, a = 1) => `rgba(${v | 0},${v | 0},${(v * 0.96) | 0},${a})`;
  // leafy sprays: twigs radiating from the bottom centre
  const spray = (k, leaf, count, size) => {
    const [ox, oy] = cell(k);
    ctx.save(); ctx.translate(ox, oy);
    ctx.beginPath(); ctx.rect(6, 6, S - 12, S - 12); ctx.clip();
    for (let b = 0; b < 7; b++) {
      const a = -Math.PI / 2 + (rnd() - 0.5) * 2.2;
      const len = S * (0.3 + rnd() * 0.25);
      const x1 = S / 2 + Math.cos(a) * len, y1 = S * 0.62 + Math.sin(a) * len;
      ctx.strokeStyle = 'rgba(60,45,35,1)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(S / 2, S * 0.62); ctx.lineTo(x1, y1); ctx.stroke();
    }
    for (let i = 0; i < count; i++) {
      const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * S * 0.42;
      const x = S / 2 + Math.cos(a) * rr, y = S / 2 + Math.sin(a) * rr * 0.9;
      ctx.fillStyle = shade(185 + rnd() * 70);
      leaf(ctx, x, y, size * (0.7 + rnd() * 0.6), rnd() * 6.28);
    }
    ctx.restore();
  };
  spray(ATLAS.MAPLE, mapleLeaf, 150, 15);
  spray(ATLAS.BIRCH, ovalLeaf, 260, 8);
  spray(ATLAS.SHRUB, mapleLeaf, 220, 10);
  // conifer branch: a frond with needles along side shoots
  {
    const [ox, oy] = cell(ATLAS.NEEDLE);
    ctx.save(); ctx.translate(ox, oy);
    const needles = (x0, y0, x1, y1, n, len) => {
      ctx.strokeStyle = shade(120); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      for (let i = 0; i < n; i++) {
        const t = i / n, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
        const ang = Math.atan2(y1 - y0, x1 - x0);
        for (const s of [-1, 1]) {
          const a = ang + s * (0.9 + rnd() * 0.3);
          ctx.strokeStyle = shade(160 + rnd() * 95); ctx.lineWidth = 1.4;
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * len * (1 - t * 0.5), y + Math.sin(a) * len * (1 - t * 0.5)); ctx.stroke();
        }
      }
    };
    // main axis runs along u (left -> right) through the cell centre
    needles(8, S / 2, S - 8, S / 2, 60, 22);
    for (let k = 0; k < 9; k++) {
      const x = 20 + k * 24, s = k % 2 ? 1 : -1;
      needles(x, S / 2, x + 30 + rnd() * 20, S / 2 + s * (40 + rnd() * 30) * (1 - k / 12), 18, 13);
    }
    ctx.restore();
  }
  // whole-conifer silhouette for distant LOD
  {
    const [ox, oy] = cell(ATLAS.FIR);
    ctx.save(); ctx.translate(ox, oy);
    ctx.fillStyle = 'rgba(70,50,40,1)'; ctx.fillRect(S / 2 - 3, S * 0.8, 6, S * 0.2);
    for (let i = 0; i < 1600; i++) {
      const t = rnd(), y = 10 + t * S * 0.82, half = (t * 0.42 + 0.02) * S * (0.75 + rnd() * 0.25);
      const x = S / 2 + (rnd() * 2 - 1) * half;
      ctx.strokeStyle = shade(150 + rnd() * 105); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (x > S / 2 ? 7 : -7), y + 5); ctx.stroke();
    }
    ctx.restore();
  }
  // broadleaf crown for distant LOD
  {
    const [ox, oy] = cell(ATLAS.CROWN);
    ctx.save(); ctx.translate(ox, oy);
    ctx.fillStyle = 'rgba(60,45,35,1)'; ctx.fillRect(S / 2 - 4, S * 0.6, 8, S * 0.4);
    for (let i = 0; i < 900; i++) {
      const a = rnd() * 6.28, rr = Math.sqrt(rnd());
      const x = S / 2 + Math.cos(a) * rr * S * 0.4, y = S * 0.4 + Math.sin(a) * rr * S * 0.33;
      ctx.fillStyle = shade(120 + (1 - y / S) * 80 + rnd() * 60);
      mapleLeaf(ctx, x, y, 7 + rnd() * 5, rnd() * 6.28);
    }
    ctx.restore();
  }
  // bark (opaque)
  {
    const [ox, oy] = cell(ATLAS.BARK);
    const n = tileFbm(S, 8, 4, 99);
    const img = ctx.createImageData(S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const v = n[y * S + x], grooves = 0.75 + 0.25 * Math.sin(x * 0.35 + v * 6);
      const g = (150 + v * 90) * grooves;
      const p = (y * S + x) * 4; img.data[p] = g; img.data[p + 1] = g * 0.9; img.data[p + 2] = g * 0.8; img.data[p + 3] = 255;
    }
    ctx.putImageData(img, ox, oy);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}
