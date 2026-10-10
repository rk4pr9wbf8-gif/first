// "Hero" lighting layer shared by every lit material:
//  * ray-marched terrain shadows: each pixel marches toward the sun through
//    a 16 km heightfield, so whole mountains cast shadows into valleys far
//    beyond the reach of the shadow map
//  * heightfield ambient occlusion: valley floors and gorges darken
//  * height fog with sun in-scattering (valley haze, glow toward the sun)
import * as THREE from 'three';
import { baseHeight } from './world.js';

export const RT = {
  uHF: { value: null },
  uHFRect: { value: new THREE.Vector4(0, 0, 1, 0) }, // x0, z0, size, enabled
  uSunW: { value: new THREE.Vector3(0, 1, 0) },
  uFogSunCol: { value: new THREE.Color(1, 0.8, 0.6) },
  uFogK: { value: 1 / 450 },
  uRTOn: { value: 1 },
};

// ---------------------------------------------------------------- fog chunks
THREE.ShaderChunk.fog_pars_vertex = `#ifdef USE_FOG
  varying float vFogDepth; varying vec3 vFogWorld;
#endif`;
THREE.ShaderChunk.fog_vertex = `#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vec4 fogW = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    fogW = instanceMatrix * fogW;
  #endif
  vFogWorld = ( modelMatrix * fogW ).xyz;
#endif`;
THREE.ShaderChunk.fog_pars_fragment = `#ifdef USE_FOG
  uniform vec3 fogColor; varying float vFogDepth; varying vec3 vFogWorld;
  uniform vec3 uSunW; uniform vec3 uFogSunCol; uniform float uFogK;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear; uniform float fogFar;
  #endif
#endif`;
THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG
  #ifdef FOG_EXP2
    // exponential height fog, integrated along the view ray
    vec3 fogRay = vFogWorld - cameraPosition;
    float fogDist = length( fogRay );
    float fk = max( uFogK, 1e-6 );
    float hc = max( cameraPosition.y, 0.0 ), hf = max( vFogWorld.y, 0.0 );
    float dh = hf - hc;
    float hInt = abs( dh ) > 1.0 ? ( exp( -fk * hc ) - exp( -fk * hf ) ) / ( fk * dh ) : exp( -fk * hc );
    float fogFactor = 1.0 - exp( - fogDensity * fogDist * hInt );
    float sunAmt = pow( max( dot( fogRay / max( fogDist, 1e-3 ), uSunW ), 0.0 ), 6.0 );
    vec3 fogCol = fogColor + uFogSunCol * sunAmt * 0.4;
    gl_FragColor.rgb = mix( gl_FragColor.rgb, fogCol, clamp( fogFactor, 0.0, 1.0 ) );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
    gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
  #endif
#endif`;

// ---------------------------------------------------------------- shading
const RT_GLSL = (steps, ao) => `
  #ifdef USE_FOG
  uniform sampler2D uHF; uniform vec4 uHFRect; uniform float uRTOn;
  float rtH( vec2 xz ) { return texture2D( uHF, ( xz - uHFRect.xy ) / uHFRect.z ).r; }
  float rtSunVis( vec3 p ) {
    if ( uHFRect.w < 0.5 || uRTOn < 0.5 || uSunW.y < -0.05 ) return 1.0;
    float vis = 1.0, t = 36.0;
    for ( int i = 0; i < ${steps}; i ++ ) {
      vec3 q = p + uSunW * t;
      vec2 uv = ( q.xz - uHFRect.xy ) / uHFRect.z;
      if ( uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0 || q.y > 4200.0 ) break;
      float d = q.y - texture2D( uHF, uv ).r + 6.0 + t * 0.012;
      vis = min( vis, clamp( d / ( 3.0 + t * 0.035 ) + 0.15, 0.0, 1.0 ) );
      if ( vis < 0.01 ) break;
      t *= ${steps > 16 ? '1.24' : '1.42'};
    }
    return vis;
  }
  float rtAO( vec3 p ) {
    ${ao ? `if ( uHFRect.w < 0.5 || uRTOn < 0.5 ) return 1.0;
    float occ = 0.0;
    for ( int i = 0; i < 6; i ++ ) {
      float a = float( i ) * 1.0472;
      vec2 d = vec2( cos( a ), sin( a ) );
      occ += max( rtH( p.xz + d * 140.0 ) - p.y - 8.0, 0.0 ) / 140.0;
      occ += max( rtH( p.xz + d * 480.0 ) - p.y - 15.0, 0.0 ) / 480.0;
    }
    return clamp( 1.0 - occ * 0.22, 0.35, 1.0 );` : 'return 1.0;'}
  }
  #endif`;

const litBegin = THREE.ShaderChunk.lights_fragment_begin.replace(
  'getDirectionalLightInfo( directionalLight, directLight );',
  'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= rtSunVisF;');

export function patchMaterial(mat, opts = {}) {
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey;
  const steps = opts.steps ?? 24, ao = opts.ao ?? true;
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev.call(mat, sh, r);
    Object.assign(sh.uniforms, RT);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <fog_pars_fragment>', '#include <fog_pars_fragment>\n' + RT_GLSL(steps, ao))
      .replace('#include <lights_fragment_begin>', `
        #ifdef USE_FOG
          float rtSunVisF = rtSunVis( vFogWorld );
          float rtAOF = rtAO( vFogWorld );
        #else
          float rtSunVisF = 1.0, rtAOF = 1.0;
        #endif
        ${litBegin}`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        reflectedLight.indirectDiffuse *= rtAOF;
        reflectedLight.indirectSpecular *= mix( rtAOF, 1.0, 0.3 ) * mix( 0.45, 1.0, rtSunVisF );`);
  };
  mat.customProgramCacheKey = () => (prevKey ? prevKey.call(mat) : '') + `|rt${steps}${ao ? 'a' : ''}`;
  mat.needsUpdate = true;
  return mat;
}

// ---------------------------------------------------------------- heightfield
// 512x512 texels over 16 km, rebuilt a few rows per frame as you travel.
export class HeightField {
  constructor(size = 512, span = 16384) {
    this.N = size; this.span = span;
    this.data = new Uint16Array(size * size);
    this.tex = new THREE.DataTexture(this.data, size, size, THREE.RedFormat, THREE.HalfFloatType);
    this.tex.magFilter = THREE.LinearFilter; this.tex.minFilter = THREE.LinearFilter;
    this.tex.wrapS = this.tex.wrapT = THREE.ClampToEdgeWrapping;
    this.tex.needsUpdate = true;
    RT.uHF.value = this.tex;
    this.work = null; this.cx = Infinity; this.cz = Infinity;
  }
  // returns true while a rebuild is in progress
  update(x, z, rowsPerCall = 8) {
    const snap = 2048;
    const sx = Math.round(x / snap) * snap, sz = Math.round(z / snap) * snap;
    if (!this.work && (Math.abs(sx - this.cx) > 1 || Math.abs(sz - this.cz) > 1)) {
      this.work = { x0: sx - this.span / 2, z0: sz - this.span / 2, row: 0, buf: new Uint16Array(this.N * this.N), cx: sx, cz: sz };
    }
    const w = this.work;
    if (!w) return false;
    const N = this.N, step = this.span / (N - 1);
    const end = Math.min(N, w.row + rowsPerCall);
    for (let j = w.row; j < end; j++) {
      for (let i = 0; i < N; i++) w.buf[j * N + i] = THREE.DataUtils.toHalfFloat(Math.max(0, baseHeight(w.x0 + i * step, w.z0 + j * step)));
    }
    w.row = end;
    if (w.row >= N) {
      this.data.set(w.buf);
      this.tex.needsUpdate = true;
      this.cx = w.cx; this.cz = w.cz;
      // texel centres: uv 0 -> x0, uv 1 -> x0 + span (+ half texel correction)
      const half = step / 2;
      RT.uHFRect.value.set(w.x0 - half, w.z0 - half, this.span + step, 1);
      this.work = null;
    }
    return !!this.work;
  }
}
