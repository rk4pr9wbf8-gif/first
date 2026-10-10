// Sky, sun, clouds, stars, fog and image-based lighting, with a handful of
// time-of-day presets tuned for October in the Pacific Northwest.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

export const PRESETS = [
  { name: 'Morning mist', hour: 8.1, turbidity: 9, rayleigh: 2.2, mie: 0.012, fog: 0.0007, fogK: 1 / 160, fogCol: [0.66, 0.69, 0.72], cloud: 0.48, exposure: 0.8 },
  { name: 'Midday', hour: 12.6, turbidity: 4.5, rayleigh: 1.2, mie: 0.004, fog: 0.00008, fogK: 1 / 700, fogCol: [0.58, 0.67, 0.80], cloud: 0.55, exposure: 0.6 },
  { name: 'Golden hour', hour: 16.9, turbidity: 6.5, rayleigh: 1.9, mie: 0.006, fog: 0.00011, fogK: 1 / 450, fogCol: [0.74, 0.64, 0.52], cloud: 0.52, exposure: 0.72 },
  { name: 'Dusk', hour: 18.15, turbidity: 8, rayleigh: 3.0, mie: 0.008, fog: 0.0002, fogK: 1 / 380, fogCol: [0.40, 0.31, 0.33], cloud: 0.5, exposure: 1.15 },
  { name: 'Night', hour: 22.5, turbidity: 2, rayleigh: 0.5, mie: 0.003, fog: 0.00018, fogK: 1 / 500, fogCol: [0.018, 0.024, 0.04], cloud: 0.6, exposure: 1.5 },
];

const cloudVS = `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const cloudFS = `
  uniform float uTime; uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uAmb; uniform float uCover; uniform vec3 uCam;
  varying vec3 vW;
  float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(h2(i), h2(i+vec2(1,0)), f.x), mix(h2(i+vec2(0,1)), h2(i+vec2(1,1)), f.x), f.y); }
  float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 6; i++){ s += a * n2(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
  void main(){
    vec2 p = vW.xz * 0.00022 + vec2(uTime * 0.004, uTime * 0.0013);
    float n = fbm(p);
    float d = smoothstep(uCover, uCover + 0.28, n);
    if (d < 0.01) discard;
    float ns = fbm(p + uSunDir.xz * 0.06);
    float lit = clamp(0.55 + (n - ns) * 3.5, 0.0, 1.0);
    vec3 col = mix(uAmb * 0.8, uSunCol * 1.15 + uAmb * 0.4, lit);
    vec3 v = normalize(vW - uCam);
    col += uSunCol * pow(max(dot(v, uSunDir), 0.0), 8.0) * (1.0 - d) * 1.4;
    float dist = length(vW.xz - uCam.xz);
    float fade = 1.0 - smoothstep(9000.0, 26000.0, dist);
    gl_FragColor = vec4(col, d * 0.92 * fade);
  }`;

export class Atmosphere {
  constructor(renderer, scene, uniforms) {
    this.renderer = renderer; this.scene = scene; this.uniforms = uniforms;
    this.sky = new Sky();
    this.sky.scale.setScalar(36000);
    this.sky.material.depthWrite = false;
    this.sky.renderOrder = -10;
    scene.add(this.sky);

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.left = -110; sc.right = 110; sc.top = 110; sc.bottom = -110; sc.near = 10; sc.far = 1400;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.5;
    scene.add(this.sun); scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(0x9fb6d8, 0x3b3122, 0.9);
    scene.add(this.hemi);

    scene.fog = new THREE.FogExp2(0xbbbbbb, 0.0001);

    const cg = new THREE.PlaneGeometry(64000, 64000, 1, 1); cg.rotateX(-Math.PI / 2);
    this.cloudU = {
      uTime: uniforms.uTime, uSunDir: { value: new THREE.Vector3() }, uSunCol: { value: new THREE.Color() },
      uAmb: { value: new THREE.Color() }, uCover: { value: 0.5 }, uCam: { value: new THREE.Vector3() },
    };
    this.clouds = new THREE.Mesh(cg, new THREE.ShaderMaterial({
      uniforms: this.cloudU, vertexShader: cloudVS, fragmentShader: cloudFS,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    }));
    this.clouds.renderOrder = 5;
    scene.add(this.clouds);

    // stars
    const N = 2500, sp = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      sp[i * 3] = Math.cos(a) * r * 15000; sp[i * 3 + 1] = Math.abs(u) * 15000; sp[i * 3 + 2] = Math.sin(a) * r * 15000;
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    this.stars.renderOrder = -9;
    scene.add(this.stars);

    // environment map rendered from a private copy of the sky
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    this.envSky = new Sky(); this.envSky.scale.setScalar(1000);
    this.envSky.material.uniforms = this.sky.material.uniforms;
    this.envScene.add(this.envSky);
    this.envGround = new THREE.Mesh(new THREE.CircleGeometry(400, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x1a1a14 }));
    this.envGround.position.y = -20;
    this.envScene.add(this.envGround);
    this.envRT = null;

    this.sunDir = new THREE.Vector3();
    this.sunColor = new THREE.Color();
    this.night = 0;
    this.presetIndex = 2;
    this.apply(PRESETS[this.presetIndex]);
  }

  apply(p) {
    this.preset = p;
    const u = this.sky.material.uniforms;
    u.turbidity.value = p.turbidity; u.rayleigh.value = p.rayleigh;
    u.mieCoefficient.value = p.mie; u.mieDirectionalG.value = 0.82;
    // October sun at ~47N: low arc, max ~35 degrees
    const t = (p.hour - 7.3) / (18.3 - 7.3);
    const elev = Math.sin(t * Math.PI) * 35 * Math.PI / 180 + (t < 0 || t > 1 ? -0.25 : 0);
    const az = (-80 + t * 160) * Math.PI / 180; // east -> south -> west
    this.sunDir.set(Math.sin(az) * Math.cos(elev), Math.sin(elev), -Math.cos(az) * Math.cos(elev)).normalize();
    if (p.name === 'Night') this.sunDir.set(-0.3, -0.3, -0.9).normalize();
    u.sunPosition.value.copy(this.sunDir);

    const e = Math.max(0, this.sunDir.y);
    this.night = p.name === 'Night' ? 1 : p.name === 'Dusk' ? 0.55 : 0;
    const warm = 1 - Math.min(1, e / 0.45);
    this.sunColor.setRGB(1.0, 0.93 - warm * 0.35, 0.84 - warm * 0.55);
    let sunI = 3.2 * Math.min(1, e * 6);
    if (p.name === 'Dusk') sunI = 0.6;
    if (p.name === 'Night') { this.sunColor.setRGB(0.5, 0.6, 0.9); sunI = 0.12; this.sunDir.set(0.3, 0.75, -0.4).normalize(); }
    this.sun.color.copy(this.sunColor);
    this.baseSun = sunI;
    this.sun.intensity = sunI;

    const fc = new THREE.Color().setRGB(...p.fogCol);
    this.scene.fog.color.copy(fc);
    this.scene.fog.density = p.fog;
    this.baseFog = p.fog;
    this.hemi.color.setRGB(0.55 + fc.r * 0.3, 0.62 + fc.g * 0.3, 0.75 + fc.b * 0.3);
    this.hemi.groundColor.setRGB(0.24, 0.19, 0.12);
    this.baseHemi = p.name === 'Night' ? 0.16 : p.name === 'Dusk' ? 0.55 : 0.85;
    this.hemi.intensity = this.baseHemi;

    this.cloudU.uSunDir.value.copy(this.sunDir);
    this.cloudU.uSunCol.value.copy(this.sunColor).multiplyScalar(p.name === 'Night' ? 0.04 : p.name === 'Dusk' ? 0.6 : 1);
    this.cloudU.uAmb.value.copy(fc).multiplyScalar(p.name === 'Night' ? 0.5 : 1.0);
    this.cloudU.uCover.value = p.cloud;
    this.stars.material.opacity = this.night > 0.9 ? 0.9 : 0;
    this.sky.visible = this.night < 0.9;
    this.scene.background = this.night > 0.9 ? new THREE.Color(0.006, 0.010, 0.022) : null;
    this.exposure = p.exposure;

    this.uniforms.uSunColor.value.copy(this.sunColor).multiplyScalar(Math.min(1, sunI / 3));

    if (this.envRT) this.envRT.dispose();
    this.envGround.material.color.copy(fc).multiplyScalar(0.25);
    this.envRT = this.pmrem.fromScene(this.envScene, 0, 1, 2000);
    this.scene.environment = this.envRT.texture;
    this.envIntensity = p.name === 'Night' ? 0.15 : p.name === 'Dusk' ? 0.6 : 1.0;
  }

  next() {
    this.presetIndex = (this.presetIndex + 1) % PRESETS.length;
    this.apply(PRESETS[this.presetIndex]);
    return PRESETS[this.presetIndex].name;
  }

  update(camera, focus, quality) {
    this.sky.position.copy(camera.position);
    this.stars.position.copy(camera.position);
    this.clouds.position.set(camera.position.x, 3200, camera.position.z);
    this.cloudU.uCam.value.copy(camera.position);
    // shadow box follows the car, snapped to texels to avoid shimmer
    const sc = this.sun.shadow.camera;
    const texel = (sc.right - sc.left) / this.sun.shadow.mapSize.x;
    const d = this.sunDir;
    this.sun.target.position.copy(focus);
    this.sun.position.copy(focus).addScaledVector(d, 600);
    this.sun.target.updateMatrixWorld();
    this.sun.updateMatrixWorld();
    sc.updateMatrixWorld();
    const inv = new THREE.Matrix4().copy(sc.matrixWorldInverse);
    const p = focus.clone().applyMatrix4(inv);
    const sx = Math.round(p.x / texel) * texel - p.x, sy = Math.round(p.y / texel) * texel - p.y;
    const off = new THREE.Vector3(sx, sy, 0).applyMatrix4(new THREE.Matrix4().extractRotation(sc.matrixWorld));
    this.sun.position.add(off); this.sun.target.position.add(off);
    this.uniforms.uSunView.value.copy(this.sunDir).transformDirection(camera.matrixWorldInverse);
  }
}
