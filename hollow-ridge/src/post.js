// Post-processing: god rays, bloom, dream trails and the dream color pass.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { AfterimagePass } from 'three/addons/postprocessing/AfterimagePass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { S } from './state.js';
import { sunDir } from './sky.js';

const GodRayShader = {
  uniforms: { tDiffuse: { value: null }, uSun: { value: new THREE.Vector2(0.5, 0.5) }, uStrength: { value: 0 }, uTint: { value: new THREE.Color(1, 0.8, 0.6) }, uSamples: { value: 48 }, uAspect: { value: 1 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 uSun; uniform float uStrength, uSamples, uAspect; uniform vec3 uTint; varying vec2 vUv;
    void main(){
      vec3 base = texture2D(tDiffuse, vUv).rgb;
      if (uStrength < 0.001) { gl_FragColor = vec4(base, 1.0); return; }
      vec2 delta = (vUv - uSun) / uSamples * 0.85;
      vec2 uv = vUv; float decay = 1.0; vec3 acc = vec3(0.0);
      for (int i = 0; i < 64; i++) {
        if (float(i) >= uSamples) break;
        uv -= delta;
        vec3 s = texture2D(tDiffuse, uv).rgb;
        float l = dot(s, vec3(0.3, 0.55, 0.15));
        vec2 dd = (uv - uSun) * vec2(uAspect, 1.0);
        float m = smoothstep(0.75, 1.6, l) * smoothstep(0.75, 0.0, length(dd));
        acc += s * m * decay; decay *= 0.965;
      }
      gl_FragColor = vec4(base + acc / uSamples * uStrength * uTint, 1.0);
    }`,
};
const DreamShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uDream: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime, uDream; varying vec2 vUv;
    vec3 rgb2hsv(vec3 c){ vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0); vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g)); vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r)); float d = q.x - min(q.w, q.y); float e = 1.0e-10; return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x); }
    vec3 hsv2rgb(vec3 c){ vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0); vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www); return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y); }
    float h21(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 uv = vUv; vec2 c = uv - 0.5; float r = length(c);
      float D = uDream;
      uv += c * sin(uTime * 0.45) * 0.014 * D;
      uv += D * 0.0045 * vec2(sin(uv.y * 11.0 + uTime * 0.8), cos(uv.x * 9.0 + uTime * 0.65));
      float ca = 0.0012 + D * 0.006 * r;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + c * ca).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - c * ca).b;
      if (D > 0.001) {
        float m = max(max(col.r, col.g), col.b);
        vec3 hsv = rgb2hsv(col / max(m, 1e-4));
        float wave = sin(uv.x * 3.0 + uv.y * 2.0 + uTime * 0.2) * 0.5 + 0.5;
        hsv.x = fract(hsv.x + D * 0.09 * sin(uTime * 0.12 + r * 4.0 + wave * 2.5));
        hsv.y = min(hsv.y * (1.0 + D * 0.55), 1.0);
        col = hsv2rgb(hsv) * m;
        vec3 halo = vec3(0.0);
        for (int i = 1; i <= 3; i++) halo += texture2D(tDiffuse, 0.5 + c * (1.0 - float(i) * 0.012 * D)).rgb;
        col = mix(col, halo / 3.0, 0.25 * D);
        // soft glow over everything: the "everything is gently luminous" feeling
        vec3 blur = (texture2D(tDiffuse, uv + vec2(0.004, 0.0)).rgb + texture2D(tDiffuse, uv - vec2(0.004, 0.0)).rgb + texture2D(tDiffuse, uv + vec2(0.0, 0.006)).rgb + texture2D(tDiffuse, uv - vec2(0.0, 0.006)).rgb) * 0.25;
        col = max(col, mix(col, blur * 1.15, 0.35 * D));
      }
      col *= 1.0 - smoothstep(0.35, 0.95, r) * 0.55;
      col *= vec3(1.03, 1.0, 0.95);
      col += (h21(uv * 900.0 + fract(uTime)) - 0.5) * 0.012;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export let composer = null;
let bloom, godrays, dream, trails, samples = 4;
export function setupComposer(renderer, scene, camera, msaa) {
  if (composer) { composer.renderTarget1.dispose(); composer.renderTarget2.dispose(); }
  samples = msaa;
  const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: msaa });
  composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  godrays = new ShaderPass(GodRayShader); composer.addPass(godrays);
  bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.32, 0.55, 1.0); composer.addPass(bloom);
  trails = new AfterimagePass(0.0); trails.enabled = false; composer.addPass(trails);
  dream = new ShaderPass(DreamShader); composer.addPass(dream);
  composer.addPass(new OutputPass());
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(innerWidth, innerHeight);
}
export function resizeComposer() { composer?.setSize(innerWidth, innerHeight); }

const sp = new THREE.Vector3();
export function updatePost(camera, t, raySamples) {
  const D = S.dream;
  dream.uniforms.uTime.value = t; dream.uniforms.uDream.value = D;
  bloom.strength = 0.3 + D * 0.4 + S.nightF * 0.15;
  // dream tracers: faint at first, stronger as it deepens
  trails.enabled = D > 0.25;
  trails.uniforms.damp.value = 0.55 + 0.33 * smoothstep01((D - 0.25) / 0.75);
  // god rays from the sun's screen position
  sp.copy(camera.position).addScaledVector(sunDir, 1000).project(camera);
  const inFront = sp.z < 1;
  const onScreen = Math.max(0, 1 - Math.max(Math.abs(sp.x), Math.abs(sp.y)) * 0.6);
  godrays.uniforms.uSun.value.set(sp.x * 0.5 + 0.5, sp.y * 0.5 + 0.5);
  godrays.uniforms.uAspect.value = camera.aspect;
  godrays.uniforms.uSamples.value = raySamples;
  const golden = 0.6 + 0.8 * Math.exp(-((sunDir.y - 0.12) ** 2) / 0.02);
  godrays.uniforms.uStrength.value = inFront && sunDir.y > -0.02 ? onScreen * golden * (0.9 + D * 1.4) * S.dayF : 0;
  godrays.enabled = godrays.uniforms.uStrength.value > 0.001;
  composer.render();
}
function smoothstep01(x) { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); }
