// Animals: smooth stylized models, GPU-animated per species, each with a small brain.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { U, NOISE_GLSL, patch } from './shaders.js';
import { mulberry32, SEED, smooth, clamp, lerp, pick, N } from './noise.js';
import { getH, slopeAt, isWet, WATER, LAKE, forestDensity, BOUND, waterLevelAt } from './world.js';
import { farm, spawn } from './sites.js';
import { blocked } from './build.js';
import { sfx } from './audio.js';
import { S } from './state.js';

const f3 = (v) => v.toFixed(3);
const DEF = { gait: 0, legSwing: 0.5, headDown: 1.0, bob: 0.03, tailSpeed: 6, tailAxis: 'y', wingSpeed: 20, wingAmp: 0.6, flapIdle: 0, spots: false };
function animGLSL(o) {
  const off = o.gait === 1 ? 'off = (p <= 2) ? 0.0 : 3.1416;' : o.gait === 2 ? 'off = (p == 1) ? 0.0 : 3.1416;' : 'off = (p == 1 || p == 4) ? 0.0 : 3.1416;';
  return `
{
  float ph = aAnim.x, mv = aAnim.y, hd = aAnim.z, ex = aAnim.w;
  int p = int(aPart + 0.5);
  vec3 q = transformed - aPivot;
  if (p >= 1 && p <= 4) {
    float off; ${off}
    q = rX(sin(ph + off) * ${f3(o.legSwing)} * mv) * q;
  } else if (p == 5) {
    float look = sin(uTime * 0.5 + ph * 0.37) * 0.35 * (1.0 - min(mv, 1.0)) * (1.0 - hd);
    q = rY(look) * rX(hd * ${f3(o.headDown)} + sin(ph * 2.0) * 0.05 * mv) * q;
  } else if (p == 6) {
    float w = sin(uTime * ${f3(o.tailSpeed)} + ph) * (0.2 + ex * 0.7);
    q = ${o.tailAxis === 'z' ? 'rZ(w)' : 'rY(w)'} * q;
  } else if (p == 7 || p == 8) {
    float s = (p == 7) ? 1.0 : -1.0;
    float fl = (sin(uTime * ${f3(o.wingSpeed)} + ph * 3.0) * 0.8 + 0.2) * ${f3(o.wingAmp)} * max(ex, ${f3(o.flapIdle)});
    q = rZ(s * fl) * q;
  }
  transformed = aPivot + q;
  transformed.y += abs(sin(ph)) * ${f3(o.bob)} * mv;
}`;
}
function faunaPatch(mat, key, o, withColor) {
  const spots = o.spots && withColor;
  return patch(mat, key, (sh) => {
    sh.uniforms.uTime = U.uTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
uniform float uTime;
attribute float aPart; attribute vec3 aPivot; attribute vec4 aAnim;
mat3 rX(float a){ float c = cos(a), s = sin(a); return mat3(1.0,0.0,0.0, 0.0,c,s, 0.0,-s,c); }
mat3 rY(float a){ float c = cos(a), s = sin(a); return mat3(c,0.0,-s, 0.0,1.0,0.0, s,0.0,c); }
mat3 rZ(float a){ float c = cos(a), s = sin(a); return mat3(c,s,0.0, -s,c,0.0, 0.0,0.0,1.0); }
${spots ? 'varying vec3 vLocal; varying float vSeed;' : ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${animGLSL(o)}\n${spots ? 'vLocal = position; vSeed = 0.0;\n#ifdef USE_INSTANCING\nvSeed = instanceMatrix[3][0] * 0.37 + instanceMatrix[3][2] * 0.71;\n#endif' : ''}`);
    if (spots) sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLocal; varying float vSeed;\n' + NOISE_GLSL)
      .replace('#include <color_fragment>', `#include <color_fragment>
      { float sp = vnoise(vLocal.xz * 3.2 + vLocal.y * 2.1 + vSeed); diffuseColor.rgb *= mix(1.0, 0.13, step(0.63, sp) * step(0.55, vColor.g) * step(vLocal.y, 1.75)); }`);
  });
}

// ---------------------------------------------------------------- geometry kit
const _c = new THREE.Color();
function P(geo, color, part = 0, pivot = [0, 0, 0]) {
  geo.deleteAttribute('uv');
  const n = geo.attributes.position.count;
  const c = new Float32Array(n * 3), a = new Float32Array(n), pv = new Float32Array(n * 3);
  _c.set(color);
  for (let i = 0; i < n; i++) { c[i * 3] = _c.r; c[i * 3 + 1] = _c.g; c[i * 3 + 2] = _c.b; a[i] = part; pv[i * 3] = pivot[0]; pv[i * 3 + 1] = pivot[1]; pv[i * 3 + 2] = pivot[2]; }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  geo.setAttribute('aPart', new THREE.BufferAttribute(a, 1));
  geo.setAttribute('aPivot', new THREE.BufferAttribute(pv, 3));
  return geo;
}
const E = (rx, ry, rz, x, y, z, seg = 14) => new THREE.SphereGeometry(1, seg, Math.max(6, Math.round(seg * 0.7))).scale(rx, ry, rz).translate(x, y, z);
const Cy = (rBot, rTop, len, seg = 8) => new THREE.CylinderGeometry(rTop, rBot, len, seg);
function legs(spots, top, r, color, hoof, taper = 0.85) {
  const out = [];
  spots.forEach(([x, z], k) => {
    out.push(P(Cy(r * taper, r, top).translate(x, top / 2, z), color, k + 1, [x, top, z]));
    if (hoof) out.push(P(Cy(r * 1.05, r * 1.02, 0.08).translate(x, 0.04, z), hoof, k + 1, [x, top, z]));
  });
  return out;
}
const eyes = (x, y, z, r, part, piv, col = '#141010') => [P(E(r, r, r, x, y, z, 8), col, part, piv), P(E(r, r, r, -x, y, z, 8), col, part, piv)];

function sheepGeo() {
  const W = '#f3eee4', F = '#2e2622', hp = [0, 0.9, 0.42];
  return [
    P(E(0.42, 0.38, 0.58, 0, 0.78, 0), W), P(E(0.3, 0.3, 0.3, 0.18, 0.92, 0.25), W), P(E(0.3, 0.3, 0.3, -0.18, 0.92, -0.2), W),
    P(E(0.28, 0.28, 0.28, 0.2, 0.86, -0.3), W), P(E(0.28, 0.28, 0.28, -0.2, 0.86, 0.3), W), P(E(0.26, 0.26, 0.26, 0, 1.0, 0.02), W),
    P(E(0.32, 0.3, 0.3, 0, 0.7, -0.35), W), P(E(0.32, 0.3, 0.3, 0, 0.72, 0.38), W),
    P(E(0.14, 0.17, 0.24, 0, 0.98, 0.75), F, 5, hp), P(E(0.15, 0.11, 0.13, 0, 1.11, 0.66), W, 5, hp),
    P(E(0.11, 0.04, 0.06, 0.17, 1.04, 0.7), F, 5, hp), P(E(0.11, 0.04, 0.06, -0.17, 1.04, 0.7), F, 5, hp),
    ...eyes(0.1, 1.03, 0.88, 0.028, 5, hp, '#e8d890'),
    ...legs([[0.2, 0.3], [-0.2, 0.3], [0.2, -0.3], [-0.2, -0.3]], 0.55, 0.05, F, null),
    P(E(0.09, 0.1, 0.09, 0, 0.82, -0.66), W, 6, [0, 0.88, -0.58]),
  ];
}
function cowGeo() {
  const W = '#f4f1ea', pink = '#e8b0a0', dark = '#2a2420', horn = '#e8dcc0', hp = [0, 1.32, 0.85];
  const tail = Cy(0.02, 0.03, 0.85).translate(0, -0.42, 0).translate(0, 1.55, -0.98);
  return [
    P(E(0.52, 0.56, 0.98, 0, 1.2, 0), W), P(E(0.46, 0.46, 0.7, 0, 1.06, 0.05), W), P(E(0.15, 0.12, 0.2, 0, 0.72, -0.42), pink),
    P(E(0.3, 0.36, 0.36, 0, 1.36, 0.82), W),
    P(E(0.22, 0.26, 0.36, 0, 1.4, 1.2), W, 5, hp), P(E(0.2, 0.16, 0.15, 0, 1.27, 1.48), pink, 5, hp),
    P(E(0.035, 0.03, 0.02, 0.07, 1.27, 1.62, 6), dark, 5, hp), P(E(0.035, 0.03, 0.02, -0.07, 1.27, 1.62, 6), dark, 5, hp),
    ...eyes(0.17, 1.5, 1.32, 0.04, 5, hp),
    P(new THREE.ConeGeometry(0.045, 0.24, 8).rotateZ(-1.15).translate(0.27, 1.62, 1.12), horn, 5, hp),
    P(new THREE.ConeGeometry(0.045, 0.24, 8).rotateZ(1.15).translate(-0.27, 1.62, 1.12), horn, 5, hp),
    P(E(0.13, 0.05, 0.08, 0.3, 1.5, 1.1), W, 5, hp), P(E(0.13, 0.05, 0.08, -0.3, 1.5, 1.1), W, 5, hp),
    ...legs([[0.3, 0.6], [-0.3, 0.6], [0.3, -0.62], [-0.3, -0.62]], 0.92, 0.09, W, dark),
    P(tail, W, 6, [0, 1.55, -0.98]), P(E(0.06, 0.12, 0.06, 0, 0.66, -0.98), dark, 6, [0, 1.55, -0.98]),
  ];
}
function pigGeo() {
  const pk = '#f2b3a8', sn = '#e48c84', dark = '#3a2622', hp = [0, 0.6, 0.42];
  return [
    P(E(0.38, 0.36, 0.6, 0, 0.56, 0), pk), P(E(0.33, 0.32, 0.3, 0, 0.6, 0.3), pk),
    P(E(0.25, 0.24, 0.24, 0, 0.62, 0.6), pk, 5, hp),
    P(Cy(0.11, 0.11, 0.12, 14).rotateX(Math.PI / 2).translate(0, 0.58, 0.84), sn, 5, hp),
    P(E(0.025, 0.035, 0.01, 0.045, 0.58, 0.905, 6), dark, 5, hp), P(E(0.025, 0.035, 0.01, -0.045, 0.58, 0.905, 6), dark, 5, hp),
    P(new THREE.ConeGeometry(0.08, 0.15, 6).rotateX(0.7).translate(0.15, 0.84, 0.62), pk, 5, hp),
    P(new THREE.ConeGeometry(0.08, 0.15, 6).rotateX(0.7).translate(-0.15, 0.84, 0.62), pk, 5, hp),
    ...eyes(0.11, 0.7, 0.8, 0.028, 5, hp),
    ...legs([[0.19, 0.35], [-0.19, 0.35], [0.19, -0.35], [-0.19, -0.35]], 0.34, 0.065, pk, dark),
    P(new THREE.TorusGeometry(0.05, 0.016, 6, 14, Math.PI * 1.6).rotateY(Math.PI / 2).translate(0, 0.62, -0.62), pk, 6, [0, 0.6, -0.58]),
  ];
}
function chickenGeo() {
  const W = '#f5f0e6', red = '#cc2a22', yel = '#e8a83a', hp = [0, 0.42, 0.1];
  return [
    P(E(0.16, 0.16, 0.21, 0, 0.34, 0), W), P(E(0.13, 0.13, 0.12, 0, 0.33, 0.12), W),
    P(E(0.08, 0.09, 0.08, 0, 0.53, 0.16), W, 5, hp),
    P(E(0.016, 0.05, 0.07, 0, 0.63, 0.16), red, 5, hp), P(E(0.02, 0.04, 0.02, 0, 0.46, 0.22), red, 5, hp),
    P(new THREE.ConeGeometry(0.025, 0.07, 6).rotateX(Math.PI / 2).translate(0, 0.53, 0.26), yel, 5, hp),
    ...eyes(0.06, 0.56, 0.21, 0.014, 5, hp),
    P(E(0.05, 0.15, 0.1, 0, 0.5, -0.2).rotateX(0), W, 6, [0, 0.42, -0.15]),
    P(E(0.04, 0.1, 0.15, 0.15, 0.36, -0.02), W, 7, [0.12, 0.42, 0]), P(E(0.04, 0.1, 0.15, -0.15, 0.36, -0.02), W, 8, [-0.12, 0.42, 0]),
    P(Cy(0.012, 0.014, 0.2, 6).translate(0.06, 0.1, 0), yel, 1, [0.06, 0.2, 0]), P(E(0.04, 0.012, 0.06, 0.06, 0.01, 0.03, 6), yel, 1, [0.06, 0.2, 0]),
    P(Cy(0.012, 0.014, 0.2, 6).translate(-0.06, 0.1, 0), yel, 2, [-0.06, 0.2, 0]), P(E(0.04, 0.012, 0.06, -0.06, 0.01, 0.03, 6), yel, 2, [-0.06, 0.2, 0]),
  ];
}
function dogGeo() {
  const B = '#ffffff', dark = '#1a1412', hp = [0, 0.64, 0.34];
  const tail = Cy(0.04, 0.025, 0.4).translate(0, 0.2, 0).rotateX(-0.95).translate(0, 0.66, -0.4);
  return [
    P(E(0.2, 0.22, 0.42, 0, 0.58, 0), B), P(E(0.19, 0.21, 0.19, 0, 0.6, 0.28), B),
    P(E(0.12, 0.17, 0.12, 0, 0.74, 0.42), B, 5, hp), P(E(0.15, 0.15, 0.16, 0, 0.88, 0.5), B, 5, hp),
    P(E(0.08, 0.075, 0.13, 0, 0.82, 0.66), B, 5, hp), P(E(0.035, 0.03, 0.03, 0, 0.85, 0.79, 8), dark, 5, hp),
    P(E(0.05, 0.13, 0.08, 0.14, 0.82, 0.47), '#d8d0c8', 5, hp), P(E(0.05, 0.13, 0.08, -0.14, 0.82, 0.47), '#d8d0c8', 5, hp),
    P(E(0.03, 0.01, 0.05, 0, 0.75, 0.7, 6), '#d85a6a', 5, hp),
    ...eyes(0.07, 0.92, 0.62, 0.022, 5, hp),
    ...legs([[0.11, 0.27], [-0.11, 0.27], [0.11, -0.28], [-0.11, -0.28]], 0.47, 0.045, B, null),
    P(tail, B, 6, [0, 0.66, -0.4]),
  ];
}
function catGeo() {
  const B = '#ffffff', hp = [0, 0.36, 0.2];
  const t1 = Cy(0.025, 0.022, 0.28).translate(0, 0.14, 0).rotateX(-1.1).translate(0, 0.3, -0.24);
  const t2 = Cy(0.022, 0.018, 0.25).translate(0, 0.125, 0).rotateX(-0.2).translate(0, 0.42, -0.49);
  return [
    P(E(0.1, 0.12, 0.25, 0, 0.29, 0), B), P(E(0.1, 0.1, 0.1, 0, 0.31, 0.15), B),
    P(E(0.1, 0.095, 0.09, 0, 0.43, 0.27), B, 5, hp), P(E(0.05, 0.04, 0.04, 0, 0.4, 0.34), '#f0e8e0', 5, hp),
    P(new THREE.ConeGeometry(0.04, 0.08, 4).translate(0.06, 0.53, 0.26), B, 5, hp), P(new THREE.ConeGeometry(0.04, 0.08, 4).translate(-0.06, 0.53, 0.26), B, 5, hp),
    P(E(0.012, 0.01, 0.01, 0, 0.42, 0.36, 6), '#d87a8a', 5, hp),
    ...eyes(0.04, 0.45, 0.34, 0.018, 5, hp, '#b8c840'),
    ...legs([[0.06, 0.15], [-0.06, 0.15], [0.06, -0.15], [-0.06, -0.15]], 0.22, 0.026, B, null),
    P(t1, B, 6, [0, 0.3, -0.24]), P(t2, B, 6, [0, 0.3, -0.24]),
  ];
}
function horseGeo() {
  const B = '#ffffff', dark = '#2a2220', hp = [0, 1.62, 0.72];
  const neck = Cy(0.26, 0.17, 0.95, 12).rotateX(0.62).translate(0, 1.87, 0.92);
  const mane = E(0.05, 0.42, 0.18, 0, 0, 0).rotateX(0.62).translate(0, 1.98, 0.8);
  const tail = Cy(0.03, 0.08, 1.0, 8).translate(0, -0.5, 0).translate(0, 1.6, -0.92);
  return [
    P(E(0.36, 0.44, 0.9, 0, 1.42, 0), B), P(E(0.33, 0.42, 0.36, 0, 1.42, 0.55), B), P(E(0.34, 0.4, 0.34, 0, 1.45, -0.6), B),
    P(neck, B, 5, hp), P(mane, dark, 5, hp),
    P(E(0.13, 0.15, 0.36, 0, 2.18, 1.3).rotateX(0), B, 5, hp), P(E(0.12, 0.13, 0.13, 0, 2.08, 1.6), B, 5, hp),
    P(new THREE.ConeGeometry(0.045, 0.15, 6).translate(0.07, 2.38, 1.12), B, 5, hp), P(new THREE.ConeGeometry(0.045, 0.15, 6).translate(-0.07, 2.38, 1.12), B, 5, hp),
    ...eyes(0.12, 2.25, 1.38, 0.03, 5, hp),
    ...legs([[0.21, 0.6], [-0.21, 0.6], [0.21, -0.62], [-0.21, -0.62]], 1.12, 0.075, B, dark, 0.7),
    P(tail, dark, 6, [0, 1.6, -0.92]),
  ];
}
function deerGeo() {
  const B = '#ffffff', wh = '#f2ece2', dark = '#2a2220', ant = '#d8c8a8', hp = [0, 1.18, 0.45];
  const neck = Cy(0.12, 0.08, 0.6, 10).rotateX(0.45).translate(0, 1.42, 0.55);
  const antler = (s) => [Cy(0.018, 0.012, 0.36, 5).rotateZ(s * -0.5).translate(s * 0.12, 1.88, 0.66), Cy(0.012, 0.008, 0.2, 5).rotateZ(s * 0.2).rotateX(0.5).translate(s * 0.2, 1.98, 0.7)];
  return [
    P(E(0.22, 0.28, 0.55, 0, 1.02, 0), B), P(E(0.18, 0.15, 0.38, 0, 0.88, 0), wh),
    P(neck, B, 5, hp), P(E(0.09, 0.1, 0.2, 0, 1.68, 0.76), B, 5, hp), P(E(0.04, 0.035, 0.03, 0, 1.65, 0.95, 8), dark, 5, hp),
    P(E(0.06, 0.11, 0.025, 0.11, 1.78, 0.68), B, 5, hp), P(E(0.06, 0.11, 0.025, -0.11, 1.78, 0.68), B, 5, hp),
    ...antler(1).map(g => P(g, ant, 5, hp)), ...antler(-1).map(g => P(g, ant, 5, hp)),
    ...eyes(0.07, 1.72, 0.85, 0.022, 5, hp),
    ...legs([[0.12, 0.38], [-0.12, 0.38], [0.12, -0.4], [-0.12, -0.4]], 0.84, 0.04, B, dark, 0.7),
    P(E(0.06, 0.1, 0.04, 0, 1.1, -0.56), wh, 6, [0, 1.15, -0.52]),
  ];
}
function rabbitGeo() {
  const B = '#ffffff', hp = [0, 0.2, 0.08];
  return [
    P(E(0.12, 0.12, 0.16, 0, 0.16, 0), B), P(E(0.1, 0.1, 0.1, 0.06, 0.13, -0.07), B), P(E(0.1, 0.1, 0.1, -0.06, 0.13, -0.07), B),
    P(E(0.075, 0.075, 0.085, 0, 0.27, 0.13), B, 5, hp),
    P(E(0.025, 0.11, 0.014, 0.035, 0.39, 0.1).rotateZ(-0.15), B, 5, hp), P(E(0.025, 0.11, 0.014, -0.035, 0.39, 0.1).rotateZ(0.15), B, 5, hp),
    ...eyes(0.05, 0.29, 0.19, 0.014, 5, hp),
    P(E(0.04, 0.04, 0.04, 0, 0.19, -0.17), '#fbf8f2', 6, [0, 0.19, -0.15]),
    P(Cy(0.018, 0.02, 0.1, 5).translate(0.04, 0.05, 0.09), B, 1, [0.04, 0.1, 0.09]), P(Cy(0.018, 0.02, 0.1, 5).translate(-0.04, 0.05, 0.09), B, 2, [-0.04, 0.1, 0.09]),
    P(E(0.03, 0.025, 0.08, 0.07, 0.025, -0.04), B, 3, [0.07, 0.08, -0.06]), P(E(0.03, 0.025, 0.08, -0.07, 0.025, -0.04), B, 4, [-0.07, 0.08, -0.06]),
  ];
}
function foxGeo() {
  const O = '#ffffff', wh = '#f4eee6', dark = '#2a1e18', hp = [0, 0.48, 0.3];
  return [
    P(E(0.14, 0.15, 0.36, 0, 0.44, 0), O), P(E(0.1, 0.1, 0.14, 0, 0.4, 0.24), wh),
    P(E(0.11, 0.1, 0.12, 0, 0.58, 0.38), O, 5, hp),
    P(new THREE.ConeGeometry(0.055, 0.18, 8).rotateX(Math.PI / 2).translate(0, 0.55, 0.53), wh, 5, hp), P(E(0.02, 0.02, 0.02, 0, 0.55, 0.62, 6), dark, 5, hp),
    P(new THREE.ConeGeometry(0.045, 0.11, 4).translate(0.06, 0.71, 0.35), dark, 5, hp), P(new THREE.ConeGeometry(0.045, 0.11, 4).translate(-0.06, 0.71, 0.35), dark, 5, hp),
    ...eyes(0.05, 0.62, 0.47, 0.016, 5, hp, '#c89a20'),
    ...legs([[0.08, 0.22], [-0.08, 0.22], [0.08, -0.22], [-0.08, -0.22]], 0.36, 0.03, dark, null),
    P(E(0.08, 0.08, 0.28, 0, 0.42, -0.52).rotateX(0), O, 6, [0, 0.45, -0.3]), P(E(0.06, 0.06, 0.08, 0, 0.4, -0.78), wh, 6, [0, 0.45, -0.3]),
  ];
}
function duckGeo() {
  const br = '#8a6a4a', gr = '#2e6b3a', wh = '#f0ece0', yel = '#e0a030', hp = [0, 0.12, 0.13];
  return [
    P(E(0.13, 0.1, 0.22, 0, 0.06, 0), br), P(E(0.05, 0.03, 0.08, 0, 0.1, -0.22), '#3a3a3a', 6, [0, 0.1, -0.18]),
    P(E(0.05, 0.06, 0.15, 0.1, 0.1, -0.02), '#6a5a4a', 7, [0.08, 0.12, 0]), P(E(0.05, 0.06, 0.15, -0.1, 0.1, -0.02), '#6a5a4a', 8, [-0.08, 0.12, 0]),
    P(E(0.05, 0.1, 0.05, 0, 0.16, 0.15), gr, 5, hp), P(Cy(0.052, 0.052, 0.02, 10).translate(0, 0.13, 0.15), wh, 5, hp),
    P(E(0.07, 0.07, 0.075, 0, 0.24, 0.17), gr, 5, hp), P(E(0.035, 0.015, 0.065, 0, 0.225, 0.26), yel, 5, hp),
    ...eyes(0.05, 0.26, 0.21, 0.012, 5, hp),
  ];
}
function songbirdGeo() {
  const B = '#ffffff', hp = [0, 0.02, 0.04];
  return [
    P(E(0.045, 0.045, 0.08, 0, 0, 0), B), P(E(0.032, 0.032, 0.032, 0, 0.035, 0.06), B, 5, hp),
    P(new THREE.ConeGeometry(0.01, 0.03, 5).rotateX(Math.PI / 2).translate(0, 0.033, 0.1), '#e0a040', 5, hp),
    P(E(0.016, 0.006, 0.05, 0, 0.005, -0.1), B, 6, [0, 0, -0.06]),
    P(E(0.08, 0.006, 0.035, 0.075, 0.01, 0), B, 7, [0.02, 0.01, 0]), P(E(0.08, 0.006, 0.035, -0.075, 0.01, 0), B, 8, [-0.02, 0.01, 0]),
  ];
}
function hawkGeo() {
  const B = '#5a4030', light = '#c8b090';
  return [
    P(E(0.12, 0.12, 0.32, 0, 0, 0), B), P(E(0.09, 0.09, 0.1, 0, 0.04, 0.32), light, 5, [0, 0, 0.25]),
    P(new THREE.ConeGeometry(0.03, 0.08, 5).rotateX(Math.PI / 2).translate(0, 0.02, 0.44), '#e0b040', 5, [0, 0, 0.25]),
    P(E(0.14, 0.015, 0.2, 0, 0, -0.4), B, 6, [0, 0, -0.3]),
    P(E(0.62, 0.02, 0.2, 0.66, 0, 0), B, 7, [0.08, 0, 0]), P(E(0.62, 0.02, 0.2, -0.66, 0, 0), B, 8, [-0.08, 0, 0]),
  ];
}
function butterflyGeo() {
  const O = '#f08a1a', K = '#1a1410';
  return [
    P(E(0.008, 0.008, 0.045, 0, 0, 0, 6), K),
    P(E(0.06, 0.004, 0.05, 0.062, 0, 0.018), O, 7, [0, 0, 0]), P(E(0.045, 0.004, 0.036, 0.05, 0, -0.04), O, 7, [0, 0, 0]),
    P(E(0.06, 0.004, 0.05, -0.062, 0, 0.018), O, 8, [0, 0, 0]), P(E(0.045, 0.004, 0.036, -0.05, 0, -0.04), O, 8, [0, 0, 0]),
    P(E(0.064, 0.0035, 0.054, 0.062, -0.001, 0.018), K, 7, [0, 0, 0]), P(E(0.064, 0.0035, 0.054, -0.062, -0.001, 0.018), K, 8, [0, 0, 0]),
  ];
}

// ---------------------------------------------------------------- species registry
const SP = {};
function defineSpecies(scene, name, parts, max, opts = {}) {
  const o = { ...DEF, ...opts };
  const geo = mergeGeometries(parts);
  const anim = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4); anim.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aAnim', anim);
  const mat = faunaPatch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: o.rough ?? 0.85 }), 'fauna-' + name, o, true);
  const mesh = new THREE.InstancedMesh(geo, mat, max);
  mesh.customDepthMaterial = faunaPatch(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), 'faunaD-' + name, o, false);
  mesh.castShadow = opts.shadow !== false; mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.count = 0;
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(mesh);
  SP[name] = { mesh, anim, max, agents: [] };
}

// behavior settings per kind
const BEH = {
  sheep: { walk: 0.8, run: 2.6, stride: 6, home: 'pen', call: [18, 60], size: 0.9, height: 1.0, msg: 'The sheep leans into your hand' },
  cow: { walk: 0.7, run: 2.2, stride: 3.4, home: 'pen', call: [25, 80], size: 1.3, height: 1.5, msg: 'The cow gives a slow, contented blink' },
  horse: { walk: 1.2, run: 5, stride: 2.8, home: 'pen', call: [40, 120], size: 1.3, height: 2.1, msg: 'The horse nuzzles your shoulder' },
  pig: { walk: 0.8, run: 2.5, stride: 7, home: 'barn', homeR: 16, call: [12, 40], size: 0.7, height: 0.8, msg: 'The pig wiggles happily' },
  chicken: { walk: 0.8, run: 3, stride: 14, home: 'barn', homeR: 17, call: [6, 25], size: 0.35, height: 0.5, peck: true, msg: 'The hen clucks softly' },
  dog: { walk: 1.6, run: 6.8, stride: 5.5, home: 'barn', homeR: 26, call: [25, 70], size: 0.6, height: 0.9, dog: true, msg: 'Good dog. Best dog.' },
  cat: { walk: 0.7, run: 3.2, stride: 8, home: 'barn', homeR: 30, call: [30, 90], size: 0.35, height: 0.5, cat: true, msg: 'The cat purrs and kneads the air' },
  deer: { walk: 1.0, run: 9, stride: 3.6, home: 'wild', homeR: 110, flee: 20, size: 1.0, height: 1.6, msg: 'The deer holds still and lets you' },
  rabbit: { walk: 1.0, run: 5.5, stride: 5, home: 'wild', homeR: 35, flee: 7, size: 0.25, height: 0.35, msg: 'Soft as milkweed fluff' },
  fox: { walk: 1.4, run: 7, stride: 5.5, home: 'wild', homeR: 150, flee: 13, call: [80, 240], size: 0.5, height: 0.6, msg: 'The fox tilts its head at you' },
  duck: { walk: 0.55, run: 1.8, stride: 2, home: 'lake', homeR: 70, flee: 6, call: [12, 45], size: 0.35, height: 0.3, swim: true, msg: 'The duck quacks politely' },
};
export const animals = [];
let rng = mulberry32(SEED + 33);
const rand = (a, b) => a + (b - a) * rng();

function homeOf(kind, x, z) {
  const B = BEH[kind];
  if (B.home === 'pen') return { x: farm.penX, z: farm.penZ, r: farm.penR - 1.6 };
  if (B.home === 'barn') return { x: farm.x, z: farm.z, r: B.homeR };
  return { x, z, r: B.homeR };
}
function valid(a, x, z) {
  if (Math.abs(x) > BOUND || Math.abs(z) > BOUND) return false;
  const B = a.beh;
  const dh = Math.hypot(x - a.home.x, z - a.home.z);
  if (B.swim) return getH(x, z) < WATER - 0.6 && dh < a.home.r;
  if (isWet(x, z, 0.15) || slopeAt(x, z) > 0.85) return false;
  const inPen = Math.hypot(x - farm.penX, z - farm.penZ) < farm.penR + 0.8;
  if (B.home === 'pen') { if (dh > a.home.r) return false; }
  else if (inPen) return false;
  if (!(a.adopted) && B.home !== 'pen' && dh > a.home.r) return false;
  return !blocked(x, z, getH(x, z), B.size * 0.35, 1.0);
}
function randomTarget(a, radius) {
  for (let i = 0; i < 10; i++) {
    const ang = rng() * 6.28, r = Math.sqrt(rng()) * (radius ?? a.home.r);
    const cx = radius ? a.x : a.home.x, cz = radius ? a.z : a.home.z;
    const x = cx + Math.cos(ang) * r, z = cz + Math.sin(ang) * r;
    if (valid(a, x, z)) { a.tx = x; a.tz = z; return true; }
  }
  return false;
}
function addAnimal(kind, x, z, color, scale = 1) {
  const sp = SP[kind];
  if (sp.agents.length >= sp.max) return null;
  const a = { kind, beh: BEH[kind], sp, i: sp.agents.length, x, z, y: getH(x, z), yaw: rng() * 6.28, speed: 0, tx: x, tz: z, state: 'idle', timer: rand(0, 4), ph: rng() * 10, mv: 0, hd: 0, ex: 0, scale, pitch: 0, callT: rand(3, 40), happy: 0, adopted: false };
  a.home = homeOf(kind, x, z);
  if (!valid(a, x, z)) return null;
  sp.mesh.setColorAt(a.i, _c.set(color));
  sp.agents.push(a); animals.push(a);
  sp.mesh.count = sp.agents.length;
  return a;
}
function scatter(kind, n, cx, cz, r, colors, scales = [0.85, 1.15]) {
  let made = 0;
  for (let t = 0; t < n * 40 && made < n; t++) {
    const ang = rng() * 6.28, d = Math.sqrt(rng()) * r;
    const a = addAnimal(kind, cx + Math.cos(ang) * d, cz + Math.sin(ang) * d, pick(rng, colors), rand(...scales));
    if (a) made++;
  }
}
function findSpot(test, tries = 3000) {
  for (let i = 0; i < tries; i++) {
    const x = (rng() * 2 - 1) * 450, z = (rng() * 2 - 1) * 450;
    if (test(x, z)) return [x, z];
  }
  return null;
}

// ---------------------------------------------------------------- flyers, hearts, fish
const flocks = [], hawks = [], butterflies = [];
let hearts, heartData = [], fish, ripple, fishState = { t: -1, next: 8 };
function heartTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.beginPath(); g.moveTo(32, 54); g.bezierCurveTo(4, 34, 8, 8, 32, 20); g.bezierCurveTo(56, 8, 60, 34, 32, 54); g.fill();
  return new THREE.CanvasTexture(c);
}

export function buildFauna(scene) {
  defineSpecies(scene, 'sheep', sheepGeo(), 30, { legSwing: 0.55, headDown: 1.1, tailSpeed: 9, tailAxis: 'z', rough: 1 });
  defineSpecies(scene, 'cow', cowGeo(), 12, { legSwing: 0.4, headDown: 1.0, tailSpeed: 2.5, tailAxis: 'z', spots: true });
  defineSpecies(scene, 'horse', horseGeo(), 6, { legSwing: 0.5, headDown: 1.0, tailSpeed: 2, tailAxis: 'z', rough: 0.6 });
  defineSpecies(scene, 'pig', pigGeo(), 10, { legSwing: 0.6, headDown: 0.7, tailSpeed: 7, rough: 0.7 });
  defineSpecies(scene, 'chicken', chickenGeo(), 18, { gait: 2, legSwing: 0.7, headDown: 1.2, tailSpeed: 3, wingSpeed: 24, wingAmp: 0.8, flapIdle: 0, bob: 0.02 });
  defineSpecies(scene, 'dog', dogGeo(), 3, { legSwing: 0.65, headDown: 0.6, tailSpeed: 14, bob: 0.04 });
  defineSpecies(scene, 'cat', catGeo(), 4, { legSwing: 0.6, headDown: 0.5, tailSpeed: 2, bob: 0.015 });
  defineSpecies(scene, 'deer', deerGeo(), 18, { legSwing: 0.6, headDown: 1.1, tailSpeed: 5, tailAxis: 'z', bob: 0.08 });
  defineSpecies(scene, 'rabbit', rabbitGeo(), 20, { gait: 1, legSwing: 0.9, headDown: 0.5, tailSpeed: 5, bob: 0.12 });
  defineSpecies(scene, 'fox', foxGeo(), 4, { legSwing: 0.65, headDown: 0.6, tailSpeed: 3, bob: 0.03 });
  defineSpecies(scene, 'duck', duckGeo(), 14, { headDown: 1.4, tailSpeed: 10, wingSpeed: 22, wingAmp: 1.0, flapIdle: 0, bob: 0, shadow: false });
  defineSpecies(scene, 'songbird', songbirdGeo(), 40, { wingSpeed: 30, wingAmp: 0.9, flapIdle: 1, tailSpeed: 4, shadow: false });
  defineSpecies(scene, 'hawk', hawkGeo(), 5, { wingSpeed: 7, wingAmp: 0.45, flapIdle: 0.05, tailSpeed: 1 });
  defineSpecies(scene, 'butterfly', butterflyGeo(), 36, { wingSpeed: 16, wingAmp: 1.1, flapIdle: 1, shadow: false, rough: 0.6 });

  // the homestead
  scatter('sheep', 16, farm.penX, farm.penZ, farm.penR - 3, ['#f3eee4', '#f0ebe0', '#ece4d6', '#3a3230'], [0.8, 1.1]);
  scatter('sheep', 5, farm.penX, farm.penZ, farm.penR - 3, ['#f3eee4'], [0.55, 0.65]);
  scatter('cow', 7, farm.penX, farm.penZ, farm.penR - 4, ['#f4f1ea', '#f4f1ea', '#a8653a', '#c89060'], [0.9, 1.05]);
  scatter('horse', 4, farm.penX, farm.penZ, farm.penR - 4, ['#7a4a2a', '#a8622e', '#3a2a22', '#e8e2d8'], [0.95, 1.05]);
  scatter('pig', 6, farm.x, farm.z, 14, ['#f2b3a8', '#f2b3a8', '#e8a090', '#5a4440'], [0.75, 1.0]);
  scatter('chicken', 13, farm.x, farm.z, 14, ['#f5f0e6', '#b8642a', '#8a4a22', '#2a2624', '#f5f0e6'], [0.9, 1.1]);
  const rooster = addAnimal('chicken', farm.x + 6, farm.z + 6, '#c8501e', 1.35); if (rooster) rooster.rooster = true;
  scatter('dog', 1, farm.x, farm.z, 10, ['#d9a25a']);
  scatter('dog', 1, farm.x, farm.z, 10, ['#2a2622']);
  scatter('cat', 2, farm.x, farm.z, 12, ['#e08a3c', '#8a8a8a', '#3a3434', '#e8dcc8']);
  scatter('cat', 1, spawn.x, spawn.z, 14, ['#e08a3c']);
  // the wild
  for (let g = 0; g < 5; g++) {
    const s = findSpot((x, z) => { const fd = forestDensity(x, z); return fd > 0.25 && fd < 0.75 && Math.hypot(x - spawn.x, z - spawn.z) > 40 && !isWet(x, z, 1) && slopeAt(x, z) < 0.6; });
    if (s) scatter('deer', 3 + Math.floor(rng() * 2), s[0], s[1], 10, ['#9a6a3e', '#8a5a34', '#a8784a'], [0.85, 1.1]);
  }
  for (let g = 0; g < 7; g++) {
    const s = findSpot((x, z) => forestDensity(x, z) < 0.3 && !isWet(x, z, 1) && slopeAt(x, z) < 0.5);
    if (s) scatter('rabbit', 2 + Math.floor(rng() * 3), s[0], s[1], 8, ['#8a7058', '#9a8268', '#c8b8a0', '#6a5a4a']);
  }
  for (let g = 0; g < 3; g++) { const s = findSpot((x, z) => forestDensity(x, z) > 0.4 && !isWet(x, z, 1)); if (s) scatter('fox', 1, s[0], s[1], 4, ['#d0682a', '#c45a22']); }
  for (let g = 0; g < 2; g++) {
    const s = findSpot((x, z) => getH(x, z) < WATER - 2 && Math.hypot(x - LAKE.x, z - LAKE.z) < 120);
    if (s) scatter('duck', 6, s[0], s[1], 8, ['#ffffff', '#ffffff', '#d8c8a8']);
  }
  // flyers
  for (let f = 0; f < 3; f++) {
    const fl = { x: spawn.x + rand(-100, 100), z: spawn.z + rand(-100, 100), y: 0, tx: 0, tz: 0, ty: 0, vx: 0, vz: 0, vy: 0, t: 0, birds: [] };
    fl.y = getH(fl.x, fl.z) + 20; newWaypoint(fl);
    const cols = [['#c42020', '#b81c1c'], ['#3a6ac0', '#4a7ad0'], ['#e8c030', '#d8b028'], ['#8a8a84', '#6a6a64']][f % 4];
    for (let b = 0; b < 12; b++) {
      const i = SP.songbird.agents.length;
      const a = { sp: SP.songbird, i, ox: rand(-5, 5), oy: rand(-2, 2), oz: rand(-5, 5), ph: rng() * 10, x: fl.x, y: fl.y, z: fl.z, yaw: 0 };
      SP.songbird.mesh.setColorAt(i, _c.set(pick(rng, cols))); SP.songbird.agents.push(a); fl.birds.push(a);
    }
    flocks.push(fl);
  }
  SP.songbird.mesh.count = SP.songbird.agents.length;
  for (let h = 0; h < 5; h++) {
    const a = { sp: SP.hawk, i: h, r: rand(40, 110), spd: rand(0.06, 0.12), ph: rng() * 6.28, alt: rand(50, 90), cx: spawn.x + rand(-200, 200), cz: spawn.z + rand(-200, 200), flap: rng() * 10 };
    SP.hawk.mesh.setColorAt(h, _c.set('#ffffff')); SP.hawk.agents.push(a); hawks.push(a);
  }
  SP.hawk.mesh.count = 5;
  for (let b = 0; b < 36; b++) {
    const a = { sp: SP.butterfly, i: b, ax: 1e9, az: 0, ph: rng() * 100, x: 0, y: -99, z: 0, yaw: 0 };
    SP.butterfly.mesh.setColorAt(b, _c.set(rng() < 0.75 ? '#ffffff' : pick(rng, ['#f8f0a0', '#c8d8ff', '#ffffff']))); SP.butterfly.agents.push(a); butterflies.push(a);
  }
  SP.butterfly.mesh.count = 36;
  for (const k in SP) SP[k].mesh.instanceColor.needsUpdate = true;

  // hearts when you pet something
  const hg = new THREE.BufferGeometry();
  hg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(60 * 3), 3));
  hg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(60 * 4), 4));
  hearts = new THREE.Points(hg, new THREE.PointsMaterial({ size: 0.28, map: heartTexture(), vertexColors: true, transparent: true, depthWrite: false, fog: false }));
  hearts.frustumCulled = false; scene.add(hearts);
  for (let i = 0; i < 60; i++) heartData.push({ life: 1, x: 0, y: -999, z: 0, vx: 0, vy: 0, vz: 0 });

  // a fish that jumps in the lake now and then
  fish = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8).scale(0.06, 0.08, 0.25), new THREE.MeshStandardMaterial({ color: '#9aa8a0', metalness: 0.6, roughness: 0.3 }));
  fish.visible = false; scene.add(fish);
  ripple = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false }));
  ripple.visible = false; scene.add(ripple);
}
function newWaypoint(fl) {
  const P = S.player ? S.player.pos : spawn;
  const px = P.x ?? spawn.x, pz = P.z ?? spawn.z;
  fl.tx = clamp(px + rand(-140, 140), -460, 460); fl.tz = clamp(pz + rand(-140, 140), -460, 460);
  fl.ty = getH(fl.tx, fl.tz) + rand(14, 30);
}

// ---------------------------------------------------------------- per-frame
const mtx = new THREE.Matrix4(), quat = new THREE.Quaternion(), eul = new THREE.Euler(0, 0, 0, 'YXZ'), pos = new THREE.Vector3(), scl = new THREE.Vector3();
function writeInstance(sp, i, x, y, z, yaw, pitch, roll, s, ph, mv, hd, ex) {
  eul.set(pitch, yaw, roll); quat.setFromEuler(eul);
  mtx.compose(pos.set(x, y, z), quat, scl.set(s, s, s));
  sp.mesh.setMatrixAt(i, mtx);
  const A = sp.anim.array; A[i * 4] = ph; A[i * 4 + 1] = mv; A[i * 4 + 2] = hd; A[i * 4 + 3] = ex;
}
const angDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

function think(a, dt, P, t) {
  const B = a.beh;
  const dx = P.x - a.x, dz = P.z - a.z, dP = Math.hypot(dx, dz) || 0.001;
  a.timer -= dt; a.callT -= dt; a.happy = Math.max(0, a.happy - dt);
  let speed = 0, face = null;
  if (B.flee && dP < B.flee && a.happy <= 0 && a.state !== 'flee') { a.state = 'flee'; a.timer = 2.5 + rng() * 2; if (B.swim) a.ex = 1; }
  if (B.dog) {
    if (!a.adopted && dP < 10) { a.adopted = true; sfx.call('dog', a.x, a.y + 0.6, a.z); S.toast('A dog has decided to follow you'); }
    if (a.adopted && dP > 70) a.adopted = false;
  }
  if (a.state === 'flee') {
    a.tx = a.x - dx / dP * 25; a.tz = a.z - dz / dP * 25; speed = B.run;
    if (a.timer < 0) { a.state = 'idle'; a.timer = 2; }
  } else if (a.happy > 0) {
    face = Math.atan2(dx, dz);
  } else if (a.adopted) {
    if (dP > 3.5) { const k = 2.5 / dP; a.tx = P.x - dx * k; a.tz = P.z - dz * k; speed = dP > 9 ? B.run : B.walk * 1.6; a.state = 'follow'; }
    else { a.state = 'sit'; face = Math.atan2(dx, dz); }
  } else if (B.cat && a.state === 'approach') {
    if (dP > 1.4) { a.tx = P.x - dx / dP * 1.2; a.tz = P.z - dz / dP * 1.2; speed = B.walk * 1.4; }
    else { face = Math.atan2(dx, dz); }
    if (a.timer < 0 || dP > 40) { a.state = 'idle'; a.timer = 3; }
  } else {
    if (a.state === 'walk') {
      speed = B.walk;
      if (Math.hypot(a.tx - a.x, a.tz - a.z) < 0.6) { a.state = 'idle'; a.timer = rand(1, 4); }
    }
    if ((a.state === 'idle' || a.state === 'graze' || a.state === 'sit') && a.timer < 0) {
      const r = rng();
      if (B.cat && dP < 30 && r < 0.3) { a.state = 'approach'; a.timer = 20; }
      else if (r < 0.45 && randomTarget(a, B.home === 'wild' || B.swim ? Math.min(a.home.r, 30) : undefined)) { a.state = 'walk'; a.timer = 30; }
      else if (r < 0.85 && !B.dog && !B.cat) { a.state = 'graze'; a.timer = rand(4, 12); }
      else { a.state = 'idle'; a.timer = rand(2, 6); }
    }
  }
  // steer and move
  if (speed > 0) {
    const want = Math.atan2(a.tx - a.x, a.tz - a.z);
    const turn = (speed > B.walk * 1.5 ? 4 : 2.2) * dt;
    a.yaw += clamp(angDiff(a.yaw, want), -turn, turn);
    const nx = a.x + Math.sin(a.yaw) * speed * dt, nz = a.z + Math.cos(a.yaw) * speed * dt;
    if (valid(a, nx, nz) || (a.adopted && !isWet(nx, nz, 0.1))) { a.x = nx; a.z = nz; }
    else { if (a.state === 'flee') a.yaw += (rng() - 0.5) * 2; else { a.state = 'idle'; a.timer = 0.3; } speed = 0; }
  } else if (face !== null) {
    a.yaw += clamp(angDiff(a.yaw, face), -2 * dt, 2 * dt);
  }
  a.speed = lerp(a.speed, speed, 1 - Math.exp(-dt * 5));
  a.ph += a.speed * dt * B.stride / Math.max(a.scale, 0.5);
  const mvT = a.speed < 0.05 ? 0 : clamp(a.speed / B.walk, 0.6, 1.6);
  a.mv = lerp(a.mv, mvT, 1 - Math.exp(-dt * 6));
  let hdT = a.state === 'graze' ? 1 : 0;
  if (B.peck && a.state === 'graze') hdT = Math.sin(t * 7 + a.ph) > 0.2 ? 1 : 0.2;
  if (B.cat && a.state === 'sit') hdT = 0;
  a.hd = lerp(a.hd, hdT, 1 - Math.exp(-dt * (B.peck ? 14 : 2.5)));
  const exT = a.happy > 0 || (a.adopted && dP < 6) ? 1 : (B.swim && a.state === 'flee' ? 1 : 0);
  a.ex = lerp(a.ex, exT, 1 - Math.exp(-dt * 3));
  if (B.swim) { a.y = WATER + 0.02 + Math.sin(t * 1.4 + a.ph) * 0.02; a.pitch = 0; }
  else {
    a.y = getH(a.x, a.z);
    const L = 0.6 * a.scale + 0.2, sx = Math.sin(a.yaw), cz = Math.cos(a.yaw);
    a.pitch = lerp(a.pitch, -Math.atan((getH(a.x + sx * L, a.z + cz * L) - getH(a.x - sx * L, a.z - cz * L)) / (2 * L)), 1 - Math.exp(-dt * 6));
  }
  if (a.callT < 0 && B.call) {
    a.callT = rand(...B.call);
    if (dP < 80) {
      if (a.rooster) { if (S.timeOfDay > 5.5 && S.timeOfDay < 9) sfx.call('rooster', a.x, a.y + 0.5, a.z, 1.4); else sfx.call('chicken', a.x, a.y + 0.3, a.z); }
      else if (!(B.dog && S.nightF > 0.6)) sfx.call(a.kind, a.x, a.y + B.height * 0.7, a.z);
    }
  }
  const sit = (B.dog || B.cat) && a.state === 'sit' ? -0.12 * a.scale * B.height : 0;
  writeInstance(a.sp, a.i, a.x, a.y + sit, a.z, a.yaw, a.pitch + (sit ? -0.25 : 0), 0, a.scale, a.ph, a.mv, a.hd, a.ex);
}

let frogT = 5;
export function updateFauna(dt, t, P) {
  let purring = null;
  for (const a of animals) {
    if (a.beh.cat && a.happy > 0) purring = a;
    const far = Math.hypot(a.x - P.x, a.z - P.z) > 260;
    if (far && (Math.floor(t * 10) + a.i) % 6) continue; // distant animals think less often
    think(a, far ? dt * 6 : dt, P, t);
  }
  sfx.purr(!!purring, purring?.x, (purring?.y ?? 0) + 0.3, purring?.z);
  // songbird flocks (they roost at night)
  SP.songbird.mesh.visible = S.nightF < 0.5;
  for (const fl of flocks) {
    const dx = fl.tx - fl.x, dy = fl.ty - fl.y, dz = fl.tz - fl.z, d = Math.hypot(dx, dy, dz);
    if (d < 6) newWaypoint(fl);
    const sp = 9;
    fl.vx = lerp(fl.vx, dx / d * sp, dt * 0.8); fl.vy = lerp(fl.vy, dy / d * sp, dt * 0.8); fl.vz = lerp(fl.vz, dz / d * sp, dt * 0.8);
    fl.x += fl.vx * dt; fl.y += fl.vy * dt; fl.z += fl.vz * dt;
    fl.y = Math.max(fl.y, getH(fl.x, fl.z) + 10);
    const yaw = Math.atan2(fl.vx, fl.vz);
    for (const b of fl.birds) {
      const k = t * 0.6 + b.ph;
      const x = fl.x + b.ox + Math.sin(k * 1.3) * 1.5, y = fl.y + b.oy + Math.sin(k * 2.1) * 0.8, z = fl.z + b.oz + Math.cos(k * 1.1) * 1.5;
      writeInstance(b.sp, b.i, x, y, z, yaw + Math.sin(k) * 0.3, -fl.vy * 0.05, Math.sin(k * 0.7) * 0.3, 1.4, b.ph, 0, 0, 1);
    }
  }
  for (const h of hawks) {
    const ang = t * h.spd + h.ph;
    const x = h.cx + Math.cos(ang) * h.r, z = h.cz + Math.sin(ang) * h.r;
    const y = Math.max(getH(h.cx, h.cz), getH(x, z)) + h.alt + Math.sin(ang * 2) * 4;
    const flapping = Math.sin(t * 0.3 + h.flap) > 0.5 ? 1 : 0;
    writeInstance(h.sp, h.i, x, y, z, -ang, 0, 0.35, 2.2, h.flap, 0, 0, flapping);
  }
  // butterflies drift around the player by day
  const day = S.dayF > 0.3 && S.nightF < 0.2;
  SP.butterfly.mesh.visible = day || S.dream > 0.3;
  if (SP.butterfly.mesh.visible) for (const b of butterflies) {
    if (Math.hypot(b.ax - P.x, b.az - P.z) > 35) {
      const ang = Math.random() * 6.28, r = 6 + Math.random() * 24;
      b.ax = P.x + Math.cos(ang) * r; b.az = P.z + Math.sin(ang) * r;
    }
    const k = t * 0.5 + b.ph;
    const x = b.ax + Math.sin(k * 0.7) * 3 + Math.sin(k * 2.3) * 0.6, z = b.az + Math.cos(k * 0.6) * 3 + Math.cos(k * 1.9) * 0.6;
    const y = getH(x, z) + 0.7 + Math.sin(k * 1.7) * 0.4 + Math.sin(k * 5.1) * 0.15;
    const yaw = Math.atan2(Math.cos(k * 0.7) * 0.7 * 3, -Math.sin(k * 0.6) * 0.6 * 3);
    writeInstance(b.sp, b.i, x, y, z, yaw, -0.2, 0, 1.6, b.ph, 0, 0, 1);
  }
  for (const k in SP) { SP[k].mesh.instanceMatrix.needsUpdate = true; SP[k].anim.needsUpdate = true; }

  // hearts
  const hp = hearts.geometry.attributes.position.array, hc = hearts.geometry.attributes.color.array;
  heartData.forEach((h, i) => {
    h.life = Math.min(1, h.life + dt * 0.7);
    h.x += h.vx * dt; h.y += h.vy * dt; h.z += h.vz * dt; h.vy *= 0.98;
    hp[i * 3] = h.x; hp[i * 3 + 1] = h.life < 1 ? h.y : -999; hp[i * 3 + 2] = h.z;
    hc[i * 4] = 1; hc[i * 4 + 1] = 0.45 + 0.2 * Math.sin(i); hc[i * 4 + 2] = 0.6; hc[i * 4 + 3] = (1 - h.life) * 1.2;
  });
  hearts.geometry.attributes.position.needsUpdate = true; hearts.geometry.attributes.color.needsUpdate = true;

  // fish and frogs
  fishState.next -= dt;
  if (fishState.t < 0 && fishState.next < 0) {
    fishState.next = 8 + Math.random() * 14;
    for (let i = 0; i < 12; i++) {
      const ang = Math.random() * 6.28, r = 12 + Math.random() * 50;
      const x = P.x + Math.cos(ang) * r, z = P.z + Math.sin(ang) * r;
      if (getH(x, z) < WATER - 1.5) { fishState = { t: 0, x, z, yaw: Math.random() * 6.28, next: fishState.next }; fish.visible = true; ripple.visible = true; sfx.call('splash', x, WATER, z, 0.8); break; }
    }
  }
  if (fishState.t >= 0) {
    fishState.t += dt;
    const ft = fishState.t / 0.9;
    if (ft < 1) {
      const sx = Math.sin(fishState.yaw), cz = Math.cos(fishState.yaw);
      fish.position.set(fishState.x + sx * (ft - 0.5) * 1.6, WATER + Math.sin(ft * Math.PI) * 0.9 - 0.1, fishState.z + cz * (ft - 0.5) * 1.6);
      fish.rotation.set(-(0.5 - ft) * 2.4, fishState.yaw, 0, 'YXZ');
    } else if (fish.visible) { fish.visible = false; sfx.call('splash', fish.position.x, WATER, fish.position.z, 0.5); }
    const rt = fishState.t / 3;
    ripple.position.set(fishState.x, WATER + 0.03, fishState.z);
    ripple.scale.setScalar(0.2 + rt * 4);
    ripple.material.opacity = Math.max(0, 0.5 * (1 - rt));
    if (rt >= 1) { fishState.t = -1; ripple.visible = false; }
  }
  frogT -= dt;
  if (frogT < 0) {
    frogT = 2 + Math.random() * 5;
    if (S.nightF > 0.4) {
      for (let i = 0; i < 6; i++) {
        const ang = Math.random() * 6.28, r = 5 + Math.random() * 40, x = P.x + Math.cos(ang) * r, z = P.z + Math.sin(ang) * r;
        const h = getH(x, z), wl = waterLevelAt(x, z);
        if (wl > -1e8 && Math.abs(h - wl) < 0.6) { sfx.call('frog', x, h, z, 0.8); break; }
      }
    }
  }
}

// Left-click while looking at a nearby animal pets it.
const tv = new THREE.Vector3();
export function tryPet(camPos, dir) {
  let best = null, bt = 4.8;
  for (const a of animals) {
    const B = a.beh;
    tv.set(a.x - camPos.x, a.y + B.height * 0.55 * a.scale - camPos.y, a.z - camPos.z);
    const tp = tv.dot(dir); if (tp < 0 || tp > bt) continue;
    const perp = tv.addScaledVector(dir, -tp).length();
    if (perp < B.size * 0.7 * a.scale + 0.3) { best = a; bt = tp; }
  }
  if (!best) return false;
  const a = best;
  a.happy = 4.5; a.state = 'idle'; a.timer = 5;
  if (a.beh.dog) a.adopted = true;
  const hy = a.y + a.beh.height * a.scale;
  for (let k = 0, n = 0; k < heartData.length && n < 7; k++) {
    const h = heartData[k]; if (h.life < 1) continue;
    Object.assign(h, { life: 0, x: a.x + (Math.random() - 0.5) * 0.4, y: hy, z: a.z + (Math.random() - 0.5) * 0.4, vx: (Math.random() - 0.5) * 0.6, vy: 0.8 + Math.random() * 0.6, vz: (Math.random() - 0.5) * 0.6 }); n++;
  }
  if (a.kind === 'chicken' && a.rooster) sfx.call('rooster', a.x, hy, a.z, 1.2);
  else sfx.call(a.kind, a.x, hy, a.z, 1.2);
  sfx.sparkle();
  S.toast(a.rooster ? 'The rooster puffs up proudly' : a.beh.msg);
  return true;
}
export const faunaCounts = () => Object.fromEntries(Object.entries(SP).map(([k, v]) => [k, v.agents.length]));
