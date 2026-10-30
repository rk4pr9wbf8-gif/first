// Every sound is synthesized live with Web Audio, so the game ships with no audio files.
import { Vector3 } from 'three';
import { U } from './shaders.js';
import { S } from './state.js';
import { smooth } from './noise.js';

let ctx = null, master, music, amb, fx, verb, verbGain, noiseBuf, windF, windG, rustleG, fireG, riverG, riverF, riverPan, drone;
let nextChord = 0, chordIdx = 0, nextPhrase = 0, nextBird = 0, nextNight = 0, nextChime = 0;
let musicOn = true, volume = 0.7;
const fwd = new Vector3();
const midi = m => 440 * Math.pow(2, (m - 69) / 12);
const CHORDS = [[50, 57, 62, 64, 66], [47, 54, 59, 62, 69], [43, 50, 59, 62, 66], [45, 52, 57, 62, 64], [50, 54, 57, 62, 69], [43, 47, 55, 62, 64]];
const SCALE = [62, 64, 66, 69, 71, 74, 76, 78, 81, 83];

function start() {
  if (ctx) { ctx.resume(); return; }
  try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
  master = ctx.createGain(); master.gain.value = volume; master.connect(ctx.destination);
  verb = ctx.createConvolver();
  const len = ctx.sampleRate * 4.5, ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.4); }
  verb.buffer = ir; verbGain = ctx.createGain(); verbGain.gain.value = 0.45; verb.connect(verbGain); verbGain.connect(master);
  music = ctx.createGain(); music.gain.value = musicOn ? 0.3 : 0; music.connect(master); music.connect(verb);
  amb = ctx.createGain(); amb.gain.value = 0.75; amb.connect(master);
  fx = ctx.createGain(); fx.gain.value = 0.55; fx.connect(master);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
  { const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  const brown = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
  { const d = brown.getChannelData(0); let last = 0; for (let i = 0; i < d.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; } }
  const loop = (buf) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(); return s; };
  windF = ctx.createBiquadFilter(); windF.type = 'lowpass'; windF.frequency.value = 500;
  windG = ctx.createGain(); windG.gain.value = 0.25; loop(brown).connect(windF); windF.connect(windG); windG.connect(amb);
  const rf = ctx.createBiquadFilter(); rf.type = 'bandpass'; rf.frequency.value = 3200; rf.Q.value = 0.6;
  rustleG = ctx.createGain(); rustleG.gain.value = 0.015; loop(noiseBuf).connect(rf); rf.connect(rustleG); rustleG.connect(amb);
  const ff = ctx.createBiquadFilter(); ff.type = 'lowpass'; ff.frequency.value = 900;
  fireG = ctx.createGain(); fireG.gain.value = 0; loop(noiseBuf).connect(ff); ff.connect(fireG); fireG.connect(amb);
  // river: two bands of noise with a wobbling filter, placed at the nearest bend of the river
  riverPan = makePanner(0, 0, 0, 10, 0.9);
  riverG = ctx.createGain(); riverG.gain.value = 0;
  riverF = ctx.createBiquadFilter(); riverF.type = 'bandpass'; riverF.frequency.value = 900; riverF.Q.value = 0.7;
  const rf2 = ctx.createBiquadFilter(); rf2.type = 'bandpass'; rf2.frequency.value = 2600; rf2.Q.value = 1.2;
  const rsrc = loop(noiseBuf); rsrc.connect(riverF); rsrc.connect(rf2);
  const g2 = ctx.createGain(); g2.gain.value = 0.5; rf2.connect(g2); g2.connect(riverG); riverF.connect(riverG);
  riverG.connect(riverPan); riverPan.connect(amb);
  // low drone under the music
  drone = ctx.createGain(); drone.gain.value = 0; drone.connect(music);
  for (const [n, type] of [[38, 'sine'], [45, 'sine'], [50, 'triangle']]) {
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = midi(n);
    const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 0.05 + Math.random() * 0.05; lg.gain.value = 0.3;
    const g = ctx.createGain(); g.gain.value = type === 'sine' ? 0.05 : 0.015; lfo.connect(lg); lg.connect(g.gain);
    o.connect(g); g.connect(drone); o.start(); lfo.start();
  }
  drone.gain.setTargetAtTime(1, ctx.currentTime, 6);
  const now = ctx.currentTime;
  nextChord = now + 0.5; nextPhrase = now + 5; nextBird = now + 2; nextNight = now + 3; nextChime = now + 8;
  setInterval(tick, 200);
}
function makePanner(x, y, z, ref = 5, roll = 1) {
  const p = ctx.createPanner();
  p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = ref; p.rolloffFactor = roll; p.maxDistance = 400;
  p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z;
  return p;
}
function env(g, t, a, peak, hold, rel) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.setValueAtTime(peak, t + a + Math.max(hold, 0)); g.gain.exponentialRampToValueAtTime(0.0001, t + a + Math.max(hold, 0) + rel); }
function pad(notes, t, dur) {
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 800 + S.dream * 1200; lp.connect(music);
  for (const n of notes) for (const [type, det, vol] of [['sine', -6, 0.045], ['triangle', 7, 0.025], ['sawtooth', 0, 0.006]]) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = midi(n); o.detune.value = det;
    const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 0.12 + Math.random() * 0.2; lg.gain.value = 4 + S.dream * 18; lfo.connect(lg); lg.connect(o.detune);
    env(g, t, 4, vol, dur - 7, 7); o.connect(g); g.connect(lp);
    o.start(t); lfo.start(t); o.stop(t + dur + 1); lfo.stop(t + dur + 1);
  }
}
function pluck(n, t, vol = 0.06, dest = music) {
  const dl = ctx.createDelay(); dl.delayTime.value = 0.42; const fb = ctx.createGain(); fb.gain.value = 0.32 + S.dream * 0.25; dl.connect(fb); fb.connect(dl); dl.connect(dest);
  for (const [mult, v, dec] of [[1, 1, 2.8], [2, 0.35, 1.6], [3, 0.12, 0.9], [4.01, 0.05, 0.5]]) {
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = midi(n) * mult;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol * v, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
    o.connect(g); g.connect(dest); g.connect(dl); o.start(t); o.stop(t + dec + 0.1);
  }
}
function phrase(t) {
  // a small dulcimer-like line that walks the scale and resolves
  let i = 2 + Math.floor(Math.random() * 5);
  const len = 3 + Math.floor(Math.random() * 4);
  let at = t;
  for (let k = 0; k < len; k++) {
    pluck(SCALE[i], at, k === len - 1 ? 0.06 : 0.045);
    i = Math.max(0, Math.min(SCALE.length - 1, i + [-2, -1, -1, 1, 1, 2][Math.floor(Math.random() * 6)]));
    at += [0.38, 0.38, 0.76, 0.19][Math.floor(Math.random() * 4)];
  }
  return at - t;
}
function chime(t) {
  for (let k = 0; k < 3; k++) {
    const n = SCALE[Math.floor(Math.random() * SCALE.length)] + 12, at = t + k * (0.2 + Math.random() * 0.4);
    const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = midi(n);
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = midi(n) * 2.76;
    g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.025, at + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, at + 4);
    o.connect(g); o2.connect(g); g.connect(music); o.start(at); o2.start(at); o.stop(at + 4.1); o2.stop(at + 4.1);
  }
}
function voice(type, f0, path, dur, formants, vol, dest, vib = 0, vibRate = 6) {
  const t = ctx.currentTime;
  const o = ctx.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f0 * path[0], t);
  path.forEach((m, i) => { if (i) o.frequency.linearRampToValueAtTime(f0 * m, t + dur * i / (path.length - 1)); });
  if (vib) { const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = vibRate; lg.gain.value = vib; l.connect(lg); lg.connect(o.frequency); l.start(t); l.stop(t + dur + 0.1); }
  const g = ctx.createGain(); env(g, t, 0.04, vol, dur - 0.12, 0.1);
  o.connect(g);
  for (const [f, q, gv] of formants) { const b = ctx.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = f; b.Q.value = q; const fg = ctx.createGain(); fg.gain.value = gv; g.connect(b); b.connect(fg); fg.connect(dest); }
  o.start(t); o.stop(t + dur + 0.1);
}
function noiseHit(dest, t, len, f, q, vol, type = 'bandpass') {
  const s = ctx.createBufferSource(), b = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noiseBuf; b.type = type; b.frequency.value = f; b.Q.value = q;
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  s.connect(b); b.connect(g); g.connect(dest); s.start(t, Math.random() * 3, len + 0.05);
}
// Animal calls, positioned in 3D
const CALLS = {
  cow: (d) => voice('sawtooth', 105, [0.9, 1.15, 1.1, 0.85], 1.4, [[320, 3, 1.2], [750, 4, 0.6], [2200, 6, 0.15]], 0.5, d),
  sheep: (d) => voice('sawtooth', 240, [1, 1.05, 0.95], 0.75, [[850, 5, 1], [1500, 6, 0.5]], 0.35, d, 22, 9),
  goat: (d) => voice('sawtooth', 300, [1.1, 1.0, 0.9], 0.6, [[900, 5, 1], [1700, 6, 0.5]], 0.3, d, 30, 11),
  pig: (d) => { for (let k = 0; k < 2 + Math.floor(Math.random() * 2); k++) setTimeout(() => voice('sawtooth', 150, [1, 1.2, 0.8], 0.16, [[500, 3, 1.2], [1100, 5, 0.4]], 0.4, d), k * 210); },
  chicken: (d) => { for (let k = 0; k < 3 + Math.floor(Math.random() * 4); k++) setTimeout(() => voice('triangle', 420 + Math.random() * 80, [1, 1.3, 1], 0.07, [[1200, 4, 1], [2600, 6, 0.4]], 0.25, d), k * (110 + Math.random() * 60)); if (Math.random() < 0.4) setTimeout(() => voice('sawtooth', 380, [1, 1.6, 1.3], 0.35, [[1200, 5, 1], [2800, 6, 0.4]], 0.25, d), 600); },
  rooster: (d) => voice('sawtooth', 420, [0.9, 1.25, 1.35, 1.3, 0.95], 1.7, [[900, 4, 1], [2300, 6, 0.5]], 0.45, d, 14, 7),
  dog: (d) => { for (let k = 0; k < 1 + Math.floor(Math.random() * 3); k++) setTimeout(() => { voice('sawtooth', 330, [1.2, 0.85], 0.14, [[700, 3, 1], [1600, 4, 0.6]], 0.5, d); noiseHit(d, ctx.currentTime, 0.08, 1200, 1, 0.12); }, k * 260); },
  cat: (d) => voice('sawtooth', 520, [0.85, 1.35, 1.2, 0.8], 0.75, [[700, 5, 1], [1400, 6, 0.9], [2800, 8, 0.3]], 0.3, d, 8, 5),
  horse: (d) => voice('sawtooth', 600, [1.0, 1.5, 1.3, 0.9, 0.7], 1.3, [[900, 4, 1], [2200, 5, 0.5]], 0.35, d, 70, 14),
  duck: (d) => { for (let k = 0; k < 2 + Math.floor(Math.random() * 3); k++) setTimeout(() => voice('sawtooth', 380, [1, 0.85], 0.16, [[1100, 8, 1.4], [2400, 8, 0.4]], 0.4, d), k * 170); },
  deer: () => {}, rabbit: () => {}, fox: (d) => voice('sawtooth', 700, [1, 1.3, 0.8], 0.4, [[1400, 4, 1]], 0.15, d),
  frog: (d) => { for (let k = 0; k < 2; k++) setTimeout(() => voice('square', 95, [1, 0.9], 0.18, [[300, 4, 1], [900, 6, 0.3]], 0.25, d), k * 260); },
  splash: (d) => { noiseHit(d, ctx.currentTime, 0.3, 1800, 0.6, 0.35); noiseHit(d, ctx.currentTime + 0.05, 0.5, 700, 0.8, 0.2); },
};
let purrNode = null;
function tick() {
  if (!ctx || ctx.state !== 'running') return;
  const now = ctx.currentTime;
  if (now + 1 > nextChord) { pad(CHORDS[chordIdx % CHORDS.length], nextChord, 15); chordIdx++; nextChord += 12; }
  if (now + 0.5 > nextPhrase) {
    const d = musicOn ? phrase(nextPhrase) : 0;
    nextPhrase += d + 3 + Math.random() * 6 - S.dream * 1.5;
  }
  if (now > nextChime) { if (S.dream > 0.2 && musicOn) chime(now); nextChime = now + 6 + Math.random() * 10; }
  if (now > nextBird) {
    if (S.nightF < 0.5) { if (Math.random() < 0.08) woodpecker(now); else chirp(now); }
    nextBird = now + 2 + Math.random() * 7;
  }
  if (now > nextNight) {
    if (S.nightF > 0.3) { for (let i = 0; i < 4; i++) cricket(now + Math.random() * 1.5); if (Math.random() < 0.05) owl(now + 1); }
    nextNight = now + 0.8 + Math.random() * 1.2;
  }
  const gust = 0.5 + 0.5 * Math.sin(now * 0.13) * Math.sin(now * 0.07 + 1);
  windF.frequency.setTargetAtTime(300 + gust * 700, now, 1.5);
  windG.gain.setTargetAtTime(0.12 + gust * 0.28, now, 1.5);
  rustleG.gain.setTargetAtTime(0.004 + gust * 0.03, now, 1.0);
  riverF.frequency.setTargetAtTime(700 + Math.random() * 600, now, 0.15);
  verbGain.gain.setTargetAtTime(0.45 + S.dream * 0.5, now, 1);
  U.uWind.value = 0.6 + gust * 1.0;
}
function chirp(t) {
  const o = ctx.createOscillator(), g = ctx.createGain(), pan = ctx.createStereoPanner(); pan.pan.value = Math.random() * 2 - 1;
  const base = 2600 + Math.random() * 1800, n = 2 + Math.floor(Math.random() * 4);
  o.type = 'sine'; g.gain.value = 0.0001;
  for (let i = 0; i < n; i++) {
    const s = t + i * 0.13; o.frequency.setValueAtTime(base * (1.2 + Math.random() * 0.2), s); o.frequency.exponentialRampToValueAtTime(base * 0.8, s + 0.08);
    g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.035, s + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.09);
  }
  o.connect(g); g.connect(pan); pan.connect(amb); pan.connect(verb); o.start(t); o.stop(t + n * 0.13 + 0.2);
}
function woodpecker(t) {
  const pan = ctx.createStereoPanner(); pan.pan.value = Math.random() * 2 - 1; pan.connect(amb); pan.connect(verb);
  for (let i = 0; i < 16; i++) noiseHit(pan, t + i * 0.055, 0.03, 1100, 4, 0.12 * (1 - i / 20));
}
function cricket(t) {
  const o = ctx.createOscillator(), g = ctx.createGain(), pan = ctx.createStereoPanner(); pan.pan.value = Math.random() * 2 - 1;
  o.frequency.value = 4300 + Math.random() * 400; g.gain.value = 0.0001;
  for (let k = 0; k < 3; k++) { const s = t + k * 0.06; g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.012, s + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.04); }
  o.connect(g); g.connect(pan); pan.connect(amb); o.start(t); o.stop(t + 0.3);
}
function owl(t) {
  const pan = ctx.createStereoPanner(); pan.pan.value = Math.random() * 1.6 - 0.8; pan.connect(amb); pan.connect(verb);
  [[0, 0.35], [0.5, 0.25], [0.85, 0.6]].forEach(([d, len]) => {
    const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(390, t + d); o.frequency.linearRampToValueAtTime(350, t + d + len);
    env(g, t + d, 0.06, 0.05, len - 0.1, 0.12); o.connect(g); g.connect(pan); o.start(t + d); o.stop(t + d + len + 0.3);
  });
}

export const sfx = {
  start,
  get ready() { return !!ctx; },
  setVolume(v) { volume = v; if (master) master.gain.setTargetAtTime(v, ctx.currentTime, 0.1); },
  setMusic(on) { musicOn = on; if (music) music.gain.setTargetAtTime(on ? 0.3 : 0, ctx.currentTime, 0.8); },
  get musicOn() { return musicOn; },
  listener(cam) {
    if (!ctx) return;
    const L = ctx.listener, p = cam.position, t = ctx.currentTime;
    const f = cam.getWorldDirection(fwd);
    if (L.positionX) {
      L.positionX.setTargetAtTime(p.x, t, 0.05); L.positionY.setTargetAtTime(p.y, t, 0.05); L.positionZ.setTargetAtTime(p.z, t, 0.05);
      L.forwardX.setTargetAtTime(f.x, t, 0.05); L.forwardY.setTargetAtTime(f.y, t, 0.05); L.forwardZ.setTargetAtTime(f.z, t, 0.05);
      L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else { L.setPosition(p.x, p.y, p.z); L.setOrientation(f.x, f.y, f.z, 0, 1, 0); }
  },
  call(kind, x, y, z, loud = 1) {
    if (!ctx || !CALLS[kind]) return;
    const p = makePanner(x, y, z, 6 * loud, 1.1); const g = ctx.createGain(); g.gain.value = 0.9 * loud;
    g.connect(p); p.connect(amb); p.connect(verb);
    CALLS[kind](g);
    setTimeout(() => { try { p.disconnect(); } catch (e) { /* already gone */ } }, 4000);
  },
  purr(on, x, y, z) {
    if (!ctx) return;
    if (on && !purrNode) {
      const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 180;
      const am = ctx.createGain(); am.gain.value = 0;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 24; const lg = ctx.createGain(); lg.gain.value = 0.5; lfo.connect(lg); lg.connect(am.gain);
      const out = ctx.createGain(); out.gain.value = 0.0001; out.gain.exponentialRampToValueAtTime(0.9, ctx.currentTime + 0.5);
      const p = makePanner(x, y, z, 1.5, 1.5);
      s.connect(lp); lp.connect(am); am.connect(out); out.connect(p); p.connect(fx);
      s.start(); lfo.start(); purrNode = { s, lfo, out };
    } else if (!on && purrNode) {
      const n = purrNode; purrNode = null;
      n.out.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.3);
      setTimeout(() => { n.s.stop(); n.lfo.stop(); }, 1500);
    }
  },
  river(near) {
    if (!ctx) return;
    const t = ctx.currentTime;
    if (!near) { riverG.gain.setTargetAtTime(0, t, 0.5); return; }
    riverPan.positionX.setTargetAtTime(near.x, t, 0.3); riverPan.positionY.setTargetAtTime(near.y, t, 0.3); riverPan.positionZ.setTargetAtTime(near.z, t, 0.3);
    riverG.gain.setTargetAtTime(smooth(140, 10, near.d) * (0.35 + Math.min(near.steep * 12, 0.6)), t, 0.5);
  },
  step(k, wet) {
    if (!ctx) return; const t = ctx.currentTime;
    if (wet) { noiseHit(fx, t, 0.18, 900, 0.7, 0.08 * k); noiseHit(fx, t + 0.04, 0.12, 2200, 0.8, 0.05 * k); return; }
    for (let i = 0; i < 3; i++) {
      const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(), at = t + i * 0.02 + Math.random() * 0.02;
      s.buffer = noiseBuf; s.playbackRate.value = 0.6 + Math.random() * 0.6; f.type = 'bandpass'; f.frequency.value = 1400 + Math.random() * 1600; f.Q.value = 0.9;
      g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.07 * k, at + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.07 + Math.random() * 0.05);
      s.connect(f); f.connect(g); g.connect(fx); s.start(at, Math.random() * 3, 0.15);
    }
  },
  place() {
    if (!ctx) return; const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(190, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.15);
    g.gain.setValueAtTime(0.3, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22); o.connect(g); g.connect(fx); g.connect(verb); o.start(t); o.stop(t + 0.3);
    this.step(0.8);
  },
  remove() {
    if (!ctx) return; const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(320, t); o.frequency.exponentialRampToValueAtTime(140, t + 0.12);
    g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16); o.connect(g); g.connect(fx); o.start(t); o.stop(t + 0.2);
  },
  sparkle() {
    if (!ctx) return; const t = ctx.currentTime;
    [0, 4, 7, 12].forEach((iv, k) => pluck(74 + iv, t + k * 0.07, 0.03, fx));
  },
  fireNear(d) {
    if (!ctx) return; const t = ctx.currentTime, k = smooth(16, 2, d);
    fireG.gain.setTargetAtTime(k * 0.08, t, 0.3);
    if (k > 0.05 && Math.random() < 0.12 * k) noiseHit(fx, t, 0.03, 2500, 0.7, 0.12 * k, 'highpass');
  },
};
