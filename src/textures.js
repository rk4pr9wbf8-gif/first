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
