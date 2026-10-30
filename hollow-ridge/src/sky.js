// Sky dome, sun/moon light, environment lighting and the time-of-day palette.
import * as THREE from 'three';
import { U, NOISE_GLSL } from './shaders.js';
import { S } from './state.js';
import { smooth, lerp } from './noise.js';
import { waterUniforms } from './world.js';

export const sunDir = new THREE.Vector3();
export const skyUniforms = {
  uSunDir: { value: sunDir },
  uZenith: { value: waterUniforms.uZenith.value }, uHorizon: { value: waterUniforms.uHorizon.value },
  uSunColor: { value: waterUniforms.uSunColor.value }, uFog: { value: new THREE.Color() },
  uNight: { value: 0 }, uTime: U.uTime, uDream: U.uDream,
};
waterUniforms.uSunDir.value = sunDir;

const skyMat = new THREE.ShaderMaterial({
  uniforms: skyUniforms, side: THREE.BackSide, depthWrite: false, fog: false,
  vertexShader: `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
  fragmentShader: `
    uniform vec3 uSunDir, uZenith, uHorizon, uSunColor, uFog; uniform float uNight, uTime, uDream;
    varying vec3 vDir;
    ${NOISE_GLSL}
    void main(){
      vec3 d = normalize(vDir); float h = d.y;
      vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.45));
      float sd = max(dot(d, uSunDir), 0.0);
      col += uSunColor * (pow(sd, 5.0) * 0.22 + pow(sd, 48.0) * 0.7) * (1.0 - uNight);
      col += uSunColor * smoothstep(0.99955, 0.99975, sd) * 28.0;
      float md = max(dot(d, -uSunDir), 0.0);
      col += vec3(0.85, 0.88, 1.0) * (smoothstep(0.99935, 0.9996, md) * 3.0 + pow(md, 60.0) * 0.06) * uNight;
      vec3 sp = d * 240.0; vec3 cell = floor(sp); float st = hash12(cell.xy + cell.z * 17.13);
      float star = smoothstep(0.9972, 1.0, st) * smoothstep(0.0, 0.25, h);
      col += vec3(0.9, 0.95, 1.0) * star * (0.55 + 0.45 * sin(uTime * 2.0 + st * 90.0)) * uNight * 3.0;
      // milky way band
      float mw = smoothstep(0.35, 0.0, abs(dot(d, normalize(vec3(0.3, 0.55, 0.78))))) * fbm2(d.xz * 6.0 + d.y * 3.0);
      col += vec3(0.5, 0.55, 0.75) * mw * uNight * 0.07 * smoothstep(0.0, 0.3, h);
      if (h > 0.0) {
        vec2 cp = d.xz / (h + 0.12) * 1.3 + vec2(uTime * 0.004, uTime * 0.0025);
        float cl = fbm2(cp);
        float cover = smoothstep(0.5, 0.78, cl) * smoothstep(0.02, 0.22, h);
        float lit = fbm2(cp + uSunDir.xz * 0.12);
        vec3 ccol = mix(uHorizon * 1.05, mix(vec3(1.0), uSunColor, 0.45), clamp(0.55 + 1.5 * (cl - lit), 0.0, 1.0));
        ccol = mix(ccol, uSunColor * 1.5, pow(sd, 8.0) * 0.6);
        ccol *= mix(1.0, 0.07, uNight);
        col = mix(col, ccol, cover * 0.85);
        // dream aurora: slow ribbons of shifting color
        if (uDream > 0.01) {
          vec2 ap = d.xz / (h + 0.35);
          float rib = fbm2(vec2(ap.x * 1.2 + uTime * 0.02, ap.y * 0.35 - uTime * 0.01));
          float band = smoothstep(0.035, 0.0, abs(rib - 0.5)) * smoothstep(0.12, 0.5, h) * (0.4 + 0.6 * vnoise(ap * 9.0 + uTime * 0.05));
          vec3 ac = 0.55 + 0.45 * cos(6.2832 * (vec3(0.0, 0.33, 0.67) + rib * 1.6 + uTime * 0.025));
          ac = mix(ac, vec3(0.45, 0.85, 0.75), 0.35);
          col += ac * band * uDream * (0.12 + 0.3 * uNight);
        }
      }
      col = mix(uFog, col, smoothstep(-0.03, 0.2, h));
      gl_FragColor = vec4(col, 1.0);
    }`,
});

export let sky, sun, hemi;
let envScene, pmrem, envRT = null, lastEnvTime = -99;
export function createSky(scene, renderer) {
  sky = new THREE.Mesh(new THREE.SphereGeometry(4000, 48, 24), skyMat);
  sky.renderOrder = -10; sky.frustumCulled = false;
  scene.add(sky);
  envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), skyMat));
  pmrem = new THREE.PMREMGenerator(renderer);
  sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -80, right: 80, top: 80, bottom: -80, near: 1, far: 800 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.06;
  scene.add(sun, sun.target);
  hemi = new THREE.HemisphereLight(0x8899cc, 0x332211, 0.0);
  scene.add(hemi);
}
export function setShadowSize(n) {
  if (sun.shadow.mapSize.x === n) return;
  sun.shadow.mapSize.set(n, n);
  if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
}
function regenEnv() { const rt = pmrem.fromScene(envScene, 0.02, 1, 1000); S.scene.environment = rt.texture; if (envRT) envRT.dispose(); envRT = rt; }

const SKY_KEYS = [
  [-0.35, [0.006, 0.009, 0.03], [0.025, 0.035, 0.07], [0.35, 0.45, 0.8]],
  [-0.12, [0.03, 0.04, 0.12], [0.2, 0.14, 0.22], [1.0, 0.4, 0.2]],
  [0.0, [0.12, 0.17, 0.38], [0.88, 0.5, 0.33], [1.0, 0.45, 0.2]],
  [0.12, [0.2, 0.32, 0.6], [0.95, 0.72, 0.5], [1.0, 0.66, 0.4]],
  [0.35, [0.22, 0.42, 0.78], [0.74, 0.8, 0.9], [1.0, 0.92, 0.8]],
  [1.0, [0.16, 0.36, 0.76], [0.7, 0.78, 0.9], [1.0, 0.97, 0.9]],
];
function sampleKeys(e, idx) {
  let a = SKY_KEYS[0], b = SKY_KEYS[SKY_KEYS.length - 1];
  for (let i = 0; i < SKY_KEYS.length - 1; i++) if (e >= SKY_KEYS[i][0] && e <= SKY_KEYS[i + 1][0]) { a = SKY_KEYS[i]; b = SKY_KEYS[i + 1]; break; }
  if (e < SKY_KEYS[0][0]) b = a;
  const t = a === b ? 0 : (e - a[0]) / (b[0] - a[0]);
  return [0, 1, 2].map(k => lerp(a[idx][k], b[idx][k], t));
}
const tmpC = new THREE.Color();
export function applyTime() {
  const a = (S.timeOfDay - 6) / 12 * Math.PI;
  sunDir.set(Math.cos(a) * 0.85, Math.sin(a) * 0.82, -0.42).normalize();
  const e = sunDir.y;
  const zen = sampleKeys(e, 1), hor = sampleKeys(e, 2), sc = sampleKeys(e, 3);
  skyUniforms.uZenith.value.setRGB(...zen, THREE.SRGBColorSpace).multiplyScalar(1.35);
  skyUniforms.uHorizon.value.setRGB(...hor, THREE.SRGBColorSpace).multiplyScalar(1.35);
  skyUniforms.uSunColor.value.setRGB(...sc, THREE.SRGBColorSpace);
  const haze = smooth(0.05, 0.3, e) * 0.55;
  const fogC = skyUniforms.uFog.value.copy(skyUniforms.uHorizon.value).lerp(tmpC.setRGB(0.42, 0.55, 0.78, THREE.SRGBColorSpace).multiplyScalar(skyUniforms.uHorizon.value.r + 0.2), haze);
  S.scene.fog.color.copy(fogC);
  S.nightF = smooth(0.02, -0.18, e);
  S.dayF = smooth(-0.12, 0.15, e);
  skyUniforms.uNight.value = waterUniforms.uNight.value = S.nightF;
  U.uDay.value = S.dayF;
  if (e > -0.03) { sun.color.copy(skyUniforms.uSunColor.value); sun.intensity = smooth(-0.03, 0.15, e) * 3.3; }
  else { sun.color.setRGB(0.55, 0.65, 1.0); sun.intensity = smooth(0.0, -0.15, e) * 0.35; }
  hemi.intensity = S.nightF * 0.25;
  hemi.color.setRGB(0.25, 0.32, 0.6);
  if (Math.abs(S.timeOfDay - lastEnvTime) > 0.12) { regenEnv(); lastEnvTime = S.timeOfDay; }
}
const ld = new THREE.Vector3();
export function updateSky(camera, focus) {
  sky.position.copy(camera.position);
  sun.target.position.set(Math.round(focus.x), focus.y, Math.round(focus.z));
  if (sunDir.y > -0.03) ld.copy(sunDir); else ld.copy(sunDir).negate();
  sun.position.copy(sun.target.position).addScaledVector(ld, 350);
}
