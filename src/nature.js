// Pacific Northwest / Alaska soundscape, synthesised: wind in conifers,
// rustling leaves, a creek near water, and birds by time of day and region
// (varied thrush, chickadee, Pacific wren, Steller's jay, raven, woodpecker,
// bald eagle; barred owl and distant wolves at night).
export class Nature {
  constructor(ctx, out) {
    this.ctx = ctx;
    this.bus = ctx.createGain(); this.bus.gain.value = 0; this.bus.connect(out);
    const n = ctx.sampleRate * 3, buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0527; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2; }
    this.pink = buf;
    const loop = (f, q, type = 'bandpass') => {
      const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(0, Math.random() * 2);
      const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      s.connect(fl); fl.connect(g); g.connect(this.bus);
      return { fl, g };
    };
    this.wind = loop(420, 0.6);
    this.leaves = loop(5200, 0.9, 'highpass');
    this.creek = loop(1500, 0.5);
    this.creek2 = loop(3800, 2);
    this.next = { bird: 0, special: 6 };
    this.gust = 0;
  }

  _env(g, t, a, peak, dur) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); }
  _tone(t, f0, f1, dur, vol, pan, type = 'sine', fm = 0, fmF = 0) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain(), p = c.createStereoPanner();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    if (fm) { const m = c.createOscillator(), mg = c.createGain(); m.frequency.value = fmF; mg.gain.value = fm; m.connect(mg); mg.connect(o.frequency); m.start(t); m.stop(t + dur + 0.05); }
    p.pan.value = pan; o.connect(g); g.connect(p); p.connect(this.bus);
    this._env(g, t, Math.min(0.03, dur * 0.2), vol, dur);
    o.start(t); o.stop(t + dur + 0.05);
  }
  _noise(t, f, q, dur, vol, pan) {
    const c = this.ctx, s = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain(), p = c.createStereoPanner();
    s.buffer = this.pink; fl.type = 'bandpass'; fl.frequency.value = f; fl.Q.value = q; p.pan.value = pan;
    s.connect(fl); fl.connect(g); g.connect(p); p.connect(this.bus);
    this._env(g, t, 0.005, vol, dur); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }

  // species
  thrush(t, pan) { // varied thrush: one long eerie buzzy whistle
    const f = 2600 + Math.random() * 1600;
    this._tone(t, f, f * 0.98, 1.4, 0.05, pan, 'sine', f * 0.03, 70);
  }
  chickadee(t, pan) { this._tone(t, 4000, 3950, 0.32, 0.05, pan); this._tone(t + 0.42, 3400, 3350, 0.4, 0.045, pan); }
  wren(t, pan) { for (let i = 0; i < 26; i++) { const f = 5000 + Math.random() * 3500; this._tone(t + i * 0.055, f, f * (0.85 + Math.random() * 0.3), 0.045, 0.025, pan); } }
  jay(t, pan) { for (let i = 0; i < 4; i++) this._noise(t + i * 0.18, 2100, 3, 0.12, 0.09, pan); }
  raven(t, pan) { for (let i = 0; i < 2 + (Math.random() * 2 | 0); i++) this._tone(t + i * 0.55, 420, 330, 0.35, 0.06, pan, 'sawtooth', 60, 33); }
  woodpecker(t, pan) { for (let i = 0; i < 18; i++) this._noise(t + i * 0.055 * (1 + i * 0.01), 1300, 6, 0.03, 0.12, pan); }
  eagle(t, pan) { for (let i = 0; i < 7; i++) { const f = 2600 + Math.random() * 600; this._tone(t + i * 0.09, f, f * 1.1, 0.07, 0.035, pan, 'triangle'); } }
  owl(t, pan) { // barred owl "who cooks for you"
    [[0, 0.18], [0.3, 0.18], [0.75, 0.2], [1.05, 0.18], [1.5, 0.5]].forEach(([dt, d], i) => this._tone(t + dt, 420 - i * 8, 380 - (i === 4 ? 60 : 0), d, 0.05, pan, 'sine', 8, 6));
  }
  wolf(t, pan) { this._tone(t, 360, 620, 1.2, 0.03, pan, 'sine', 6, 5); this._tone(t + 1.2, 620, 430, 2.2, 0.03, pan, 'sine', 8, 5); }

  update(dt, s) {
    // s: { speed, tunnel, night, alaska, nearWater, forest, wind }
    const t = this.ctx.currentTime;
    const quiet = Math.max(0, 1 - s.speed / 30) * (1 - s.tunnel);
    this.bus.gain.setTargetAtTime(quiet * 0.9 * (s.muted ? 0 : 1), t, 0.5);
    this.gust += (Math.random() - 0.5) * dt * 0.8; this.gust = Math.max(0, Math.min(1, this.gust));
    const w = 0.25 + 0.75 * this.gust * s.wind;
    this.wind.g.gain.setTargetAtTime(0.12 * w, t, 0.4);
    this.wind.fl.frequency.setTargetAtTime(300 + w * 400, t, 0.5);
    this.leaves.g.gain.setTargetAtTime(0.04 * w * s.forest, t, 0.3);
    this.creek.g.gain.setTargetAtTime(0.09 * s.nearWater, t, 1);
    this.creek2.g.gain.setTargetAtTime(0.03 * s.nearWater * (0.6 + Math.random() * 0.4), t, 0.05);
    this.next.bird -= dt; this.next.special -= dt;
    if (quiet < 0.05) return;
    const pan = Math.random() * 1.6 - 0.8;
    if (this.next.bird <= 0) {
      this.next.bird = 1.5 + Math.random() * 4.5;
      if (s.night) { if (Math.random() < 0.35) this.owl(t, pan); }
      else {
        const r = Math.random();
        if (s.alaska) { r < 0.35 ? this.chickadee(t, pan) : r < 0.6 ? this.thrush(t, pan) : r < 0.85 ? this.raven(t, pan) : this.wren(t, pan); }
        else { r < 0.35 ? this.thrush(t, pan) : r < 0.6 ? this.chickadee(t, pan) : r < 0.82 ? this.wren(t, pan) : this.jay(t, pan); }
      }
    }
    if (this.next.special <= 0) {
      this.next.special = 10 + Math.random() * 20;
      if (s.night) { if (s.alaska && Math.random() < 0.5) this.wolf(t, pan * 0.5); }
      else if (s.alaska && Math.random() < 0.5) this.eagle(t, pan);
      else this.woodpecker(t, pan);
    }
  }
}
