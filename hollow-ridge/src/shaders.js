import * as THREE from 'three';

export const U = { uTime: { value: 0 }, uDream: { value: 0 }, uWind: { value: 1 }, uDay: { value: 1 } };

export const NOISE_GLSL = `
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash12(i), hash12(i+vec2(1.0,0.0)), u.x), mix(hash12(i+vec2(0.0,1.0)), hash12(i+vec2(1.0,1.0)), u.x), u.y); }
float fbm2(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
#define SRGB(c) pow(c, vec3(2.2))
`;

export function patch(mat, key, fn) { mat.onBeforeCompile = fn; mat.customProgramCacheKey = () => key; return mat; }

// Distance + height fog for every material: valley mist pools near the water, far ridges fade into blue haze.
export function installFog(mistBase) {
  THREE.ShaderChunk.fog_pars_vertex = `#ifdef USE_FOG\nvarying float vFogDepth;\nvarying vec3 vFogWorld;\n#endif`;
  THREE.ShaderChunk.fog_vertex = `#ifdef USE_FOG\nvFogDepth = - mvPosition.z;\nvec4 fogWp = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\nfogWp = instanceMatrix * fogWp;\n#endif\nvFogWorld = (modelMatrix * fogWp).xyz;\n#endif`;
  THREE.ShaderChunk.fog_pars_fragment = `#ifdef USE_FOG\nuniform vec3 fogColor;\nvarying float vFogDepth;\nvarying vec3 vFogWorld;\n#ifdef FOG_EXP2\nuniform float fogDensity;\n#else\nuniform float fogNear;\nuniform float fogFar;\n#endif\n#endif`;
  THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG
  float fogD = length(vFogWorld - cameraPosition);
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp(-fogDensity * fogD);
    float mistH = exp(-max(vFogWorld.y - ${mistBase.toFixed(2)}, 0.0) / 20.0);
    float mist = 0.5 * mistH * (1.0 - exp(-fogD / 150.0));
    fogFactor = clamp(fogFactor + mist * (1.0 - fogFactor), 0.0, 1.0);
  #else
    float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
#endif`;
}

export function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
}
