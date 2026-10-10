// Car audio: worklet V8 + turbo/blower/gear whine, blow-off valve, tyre
// squeal, road & gravel noise, wind, nitrous, impacts and tunnel reverb.
export class CarAudio {
  constructor() { this.ctx = null; this.muted = false; this.ready = false; }

  async start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = 0.7;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp); comp.connect(ctx.destination);
    this.out = ctx.destination;
    // tunnel reverb: generated impulse response
    this.verb = ctx.createConvolver();
    const len = ctx.sampleRate * 2.2, ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
    this.verb.buffer = ir;
    this.wet = ctx.createGain(); this.wet.gain.value = 0;
    this.carBus = ctx.createGain();
    this.carBus.connect(this.master); this.carBus.connect(this.verb); this.verb.connect(this.wet); this.wet.connect(this.master);

    this.noiseBuf = (() => { const n = ctx.sampleRate * 2, b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1; return b; })();
    const noise = () => { const s = ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true; s.start(); return s; };
    const chain = (src, ...nodes) => { let p = src; for (const n of nodes) { p.connect(n); p = n; } return p; };
    const bq = (type, f, q = 1) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
    const gain = (v = 0) => { const g = ctx.createGain(); g.gain.value = v; return g; };

    // engine
    this.engGain = gain(0.0);
    try {
      await ctx.audioWorklet.addModule(new URL('./engine-worklet.js', import.meta.url));
      this.engine = new AudioWorkletNode(ctx, 'engine-v8', { outputChannelCount: [1] });
      // exhaust is behind you: slight lowpass, cabin resonance
      const tone = bq('lowshelf', 180, 0.7); tone.gain.value = 4;
      chain(this.engine, tone, this.engGain, this.carBus);
    } catch (e) {
      console.warn('Engine worklet unavailable, using the simple engine sound', e);
      // fallback for browsers without AudioWorklet
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.start();
      this.fallbackOsc = o;
      chain(o, bq('lowpass', 900, 2), this.engGain, this.carBus);
    }
    // turbo whistle + supercharger whine + straight-cut gear whine
    this.turboOsc = ctx.createOscillator(); this.turboOsc.type = 'sine'; this.turboOsc.start();
    this.turboG = gain(); chain(this.turboOsc, this.turboG, this.carBus);
    this.blowerOsc = ctx.createOscillator(); this.blowerOsc.type = 'sawtooth'; this.blowerOsc.start();
    this.blowerG = gain(); chain(this.blowerOsc, bq('bandpass', 2400, 2), this.blowerG, this.carBus);
    this.gearOsc = ctx.createOscillator(); this.gearOsc.type = 'triangle'; this.gearOsc.start();
    this.gearG = gain(); chain(this.gearOsc, this.gearG, this.carBus);
    // tyres, road, wind, nitrous
    this.squealF = bq('bandpass', 1000, 9); this.squealG = gain();
    chain(noise(), this.squealF, this.squealG, this.carBus);
    this.squealOsc = ctx.createOscillator(); this.squealOsc.type = 'sine'; this.squealOsc.frequency.value = 1150; this.squealOsc.start();
    this.squealOG = gain(); chain(this.squealOsc, this.squealOG, this.carBus);
    this.roadF = bq('lowpass', 300, 0.7); this.roadG = gain(); chain(noise(), this.roadF, this.roadG, this.carBus);
    this.gravelF = bq('bandpass', 1800, 0.8); this.gravelG = gain(); chain(noise(), this.gravelF, this.gravelG, this.carBus);
    this.windF = bq('bandpass', 600, 0.5); this.windG = gain(); chain(noise(), this.windF, this.windG, this.carBus);
    this.nosG = gain(); chain(noise(), bq('highpass', 3500, 0.7), this.nosG, this.carBus);
    this.bq = bq; this.gain = gain; this.noise = noise;
    this.ready = true;
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.7;
    return this.muted;
  }

  _burst(freq, q, dur, vol, type = 'bandpass') {
    const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf;
    const f = this.bq(type, freq, q), g = this.gain(0);
    s.connect(f); f.connect(g); g.connect(this.carBus);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.start(t, Math.random()); s.stop(t + dur + 0.05);
    return { f, g, t };
  }

  bov(boost) {
    if (!this.ready) return;
    const { f, g, t } = this._burst(3000, 1.2, 0.55, 0.35 * Math.min(1, boost));
    f.frequency.setValueAtTime(3600, t); f.frequency.exponentialRampToValueAtTime(1400, t + 0.5);
    // flutter
    for (let k = 0; k < 6; k++) g.gain.setValueAtTime(0.3 * Math.min(1, boost) * (k % 2 ? 0.3 : 1), t + k * 0.035);
  }
  shiftClunk(up) { if (this.ready) this._burst(up ? 160 : 220, 2, 0.08, 0.25, 'lowpass'); }
  impact(k) { if (this.ready && k > 0.1) this._burst(120, 0.8, 0.35, 0.8 * k, 'lowpass'); }
  pop(k) { if (this.engine) this.engine.port.postMessage({ pop: k }); }

  setSound(snd) { this.snd = snd; }

  update(car, tunnel, cockpit) {
    if (!this.ready) return;
    const t = this.ctx.currentTime, snd = this.snd || {};
    const v = Math.abs(car.vx);
    const rpm = car.rpm, load = car.engineLoad;
    if (this.engine) {
      const P = this.engine.parameters;
      P.get('rpm').setTargetAtTime(rpm, t, 0.012);
      P.get('load').setTargetAtTime(load, t, 0.03);
      P.get('loud').value = snd.loud || 0;
      P.get('rasp').value = (snd.rasp || 0) + (snd.exhaust === 'straight' ? 0.8 : snd.exhaust === 'race' ? 0.45 : 0);
      P.get('lope').value = snd.lope || 0;
      P.get('intake').value = snd.intake || 0;
      P.get('pops').value = snd.pops || 0.1;
      P.get('cut').value = car.limiterHit ? 1 : 0;
    } else if (this.fallbackOsc) this.fallbackOsc.frequency.setTargetAtTime(rpm / 60 * 4, t, 0.02);
    this.engGain.gain.setTargetAtTime((0.35 + load * 0.35) * (cockpit ? 0.8 : 1) * (1 + (snd.loud || 0) * 0.3), t, 0.05);
    // forced induction
    const tb = snd.turbo || '';
    const boostN = Math.max(0, car.boost) / 1.4;
    if (tb.startsWith('turbo')) {
      this.turboOsc.frequency.setTargetAtTime(1800 + boostN * 7000 + rpm * 0.15, t, 0.08);
      this.turboG.gain.setTargetAtTime(Math.min(0.07, boostN * 0.08) * (0.4 + load), t, 0.08);
    } else this.turboG.gain.setTargetAtTime(0, t, 0.1);
    if (tb === 'roots' || tb === 'centrifugal') {
      this.blowerOsc.frequency.setTargetAtTime(rpm * (tb === 'roots' ? 0.4 : 1.2), t, 0.02);
      this.blowerG.gain.setTargetAtTime(Math.min(0.09, rpm / 9000 * 0.09) * (0.3 + load * 0.7), t, 0.05);
    } else this.blowerG.gain.setTargetAtTime(0, t, 0.1);
    if (snd.whine) {
      this.gearOsc.frequency.setTargetAtTime(v * 38 + 60, t, 0.03);
      this.gearG.gain.setTargetAtTime(Math.min(0.05, v * 0.0012), t, 0.05);
    } else this.gearG.gain.setTargetAtTime(0, t, 0.1);
    // tyres
    const sq = Math.min(1, car.slip) * (v > 3 ? 1 : 0) * (car.onRoad ? 1 : 0.15) * (car.air ? 0 : 1);
    this.squealG.gain.setTargetAtTime(sq * 0.28, t, 0.04);
    this.squealOG.gain.setTargetAtTime(sq * 0.035, t, 0.04);
    this.squealOsc.frequency.setTargetAtTime(950 + Math.random() * 250 + sq * 200, t, 0.02);
    this.squealF.frequency.setTargetAtTime(800 + sq * 600, t, 0.05);
    this.roadG.gain.setTargetAtTime(car.onRoad && !car.air ? Math.min(0.25, v * 0.005) : 0, t, 0.1);
    this.roadF.frequency.setTargetAtTime(180 + v * 6, t, 0.2);
    this.gravelG.gain.setTargetAtTime(!car.onRoad && !car.air ? Math.min(0.45, v * 0.025) : 0, t, 0.08);
    this.windG.gain.setTargetAtTime(Math.min(0.5, v * v * 0.00009) * (cockpit ? 1.3 : 0.8), t, 0.2);
    this.windF.frequency.setTargetAtTime(350 + v * 10, t, 0.2);
    this.nosG.gain.setTargetAtTime(car.nosOn ? 0.18 : 0, t, 0.05);
    this.wet.gain.setTargetAtTime(tunnel * 0.55, t, 0.2);
    // events from the drivetrain
    const ev = car.events;
    if (ev.shift) { this.shiftClunk(ev.shift > 0); if (ev.shift > 0 && (snd.pops || 0) > 0.3) this.pop(0.5 + Math.random() * 0.4); ev.shift = 0; }
    if (ev.bov) { if (snd.bov) this.bov(ev.bov); ev.bov = 0; }
    if (ev.pop) { if ((snd.pops || 0) > 0.2) this.pop(ev.pop * Math.min(1, snd.pops)); ev.pop = 0; }
  }
}
