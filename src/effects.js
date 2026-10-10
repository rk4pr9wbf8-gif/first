// Water (fjords, sounds, lakes) and drifting autumn leaves.
import * as THREE from 'three';
import { SEA_LEVEL } from './world.js';

export function makeWater(scene, tex, uniforms) {
  const geo = new THREE.PlaneGeometry(60000, 60000, 1, 1); geo.rotateX(-Math.PI / 2);
  const nmap = tex.water.clone(); nmap.needsUpdate = true;
  nmap.wrapS = nmap.wrapT = THREE.RepeatWrapping;
  const mat = new THREE.MeshStandardMaterial({
    color: 0x0d2a30, roughness: 0.06, metalness: 0.0, normalMap: nmap,
    normalScale: new THREE.Vector2(0.35, 0.35), transparent: true, opacity: 0.9, envMapIntensity: 1.2,
  });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uniforms.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWp;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvWp = (modelMatrix * vec4(transformed,1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; varying vec3 vWp;')
      .replace('#include <normal_fragment_maps>', `
        vec2 wuv = vWp.xz;
        vec3 n1 = texture2D(normalMap, wuv * 0.021 + vec2(uTime * 0.011, uTime * 0.006)).xyz * 2.0 - 1.0;
        vec3 n2 = texture2D(normalMap, wuv * 0.0073 - vec2(uTime * 0.004, -uTime * 0.007)).xyz * 2.0 - 1.0;
        vec3 n3 = texture2D(normalMap, wuv * 0.09 + vec2(-uTime * 0.03, uTime * 0.02)).xyz * 2.0 - 1.0;
        vec3 mapN = normalize(vec3((n1.xy + n2.xy * 1.4 + n3.xy * 0.5) * normalScale, 1.0));
        float fd = length(vWp - cameraPosition);
        mapN = normalize(mix(mapN, vec3(0,0,1), smoothstep(400.0, 6000.0, fd) * 0.85));
        normal = normalize(tbn * mapN);`)
      .replace('#include <opaque_fragment>', `
        float fres = pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 5.0);
        diffuseColor.a = mix(0.82, 1.0, fres);
        #include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => 'water-v1';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = SEA_LEVEL;
  mesh.receiveShadow = true;
  mesh.renderOrder = 2;
  scene.add(mesh);
  return {
    mesh,
    update(cam) { mesh.position.x = Math.round(cam.position.x / 1000) * 1000; mesh.position.z = Math.round(cam.position.z / 1000) * 1000; },
  };
}

// GPU-animated falling leaves that wrap around the camera.
export function makeLeaves(scene, tex, uniforms, count = 900) {
  const quad = new THREE.PlaneGeometry(0.16, 0.16);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.attributes.position);
  geo.setAttribute('uv', quad.attributes.uv);
  const seed = new Float32Array(count * 4), col = new Float32Array(count * 3);
  const pal = ['#c0281c', '#e0561c', '#f08c24', '#e8b42a', '#a8201e', '#d97a1e'].map(c => new THREE.Color(c));
  for (let i = 0; i < count; i++) {
    seed[i * 4] = Math.random(); seed[i * 4 + 1] = Math.random(); seed[i * 4 + 2] = Math.random(); seed[i * 4 + 3] = Math.random();
    const c = pal[(Math.random() * pal.length) | 0];
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
  geo.setAttribute('aCol', new THREE.InstancedBufferAttribute(col, 3));
  geo.instanceCount = count;
  const box = new THREE.Vector3(70, 34, 70);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: uniforms.uTime, uCam: { value: new THREE.Vector3() }, uBox: { value: box }, uMap: { value: tex.leaf },
      uLight: { value: new THREE.Color(1, 1, 1) }, uAmount: { value: 1 }, uWindV: { value: new THREE.Vector3(1.5, 0, 0.6) },
    },
    vertexShader: `
      attribute vec4 aSeed; attribute vec3 aCol;
      uniform float uTime; uniform vec3 uCam; uniform vec3 uBox; uniform float uAmount; uniform vec3 uWindV;
      varying vec2 vUv; varying vec3 vCol; varying float vA;
      void main(){
        vUv = uv; vCol = aCol;
        float t = uTime * (0.6 + aSeed.w * 0.5);
        vec3 p = aSeed.xyz * uBox;
        p += uWindV * uTime + vec3(sin(t * 1.3 + aSeed.x * 20.0) * 1.6, -uTime * (0.9 + aSeed.y * 0.8), cos(t + aSeed.z * 20.0) * 1.6);
        p = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5 + uCam;
        float a = t * (2.0 + aSeed.x * 3.0);
        vec3 lp = position;
        lp.xy = mat2(cos(a), -sin(a), sin(a), cos(a)) * lp.xy;
        lp.yz = mat2(cos(a*0.7), -sin(a*0.7), sin(a*0.7), cos(a*0.7)) * lp.yz;
        vec4 mv = viewMatrix * vec4(p + lp * (1.0 + aSeed.w), 1.0);
        vA = step(aSeed.y, uAmount) * (1.0 - smoothstep(25.0, 34.0, -mv.z));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform sampler2D uMap; uniform vec3 uLight;
      varying vec2 vUv; varying vec3 vCol; varying float vA;
      void main(){
        float a = texture2D(uMap, vUv).a;
        if (a < 0.5 || vA < 0.01) discard;
        gl_FragColor = vec4(vCol * uLight, 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  scene.add(mesh);
  return {
    mesh,
    update(cam, amount, light) {
      mat.uniforms.uCam.value.copy(cam.position);
      mat.uniforms.uAmount.value = amount;
      mat.uniforms.uLight.value.copy(light);
    },
  };
}
