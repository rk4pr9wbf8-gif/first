// Physically-inspired V8 synthesiser. Each cylinder firing excites a bank of
// exhaust/intake resonators; firing strength follows load, cylinder-to-
// cylinder variation and cam overlap; lift-off pops are fuel igniting in
// the hot exhaust.
class Res {
  constructor(f, q, sr) { this.y1 = 0; this.y2 = 0; this.set(f, q, sr); }
  set(f, q, sr) {
    const w = 2 * Math.PI * f / sr, r = Math.exp(-w / (2 * q));
    this.a1 = 2 * r * Math.cos(w); this.a2 = -r * r; this.g = (1 - r * r) * 0.5;
  }
  run(x) { const y = this.g * x + this.a1 * this.y1 + this.a2 * this.y2; this.y2 = this.y1; this.y1 = y; return y; }
}

class EngineProc extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'rpm', defaultValue: 950, minValue: 0, maxValue: 12000, automationRate: 'k-rate' },
      { name: 'load', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'loud', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'rasp', defaultValue: 0, minValue: 0, maxValue: 2, automationRate: 'k-rate' },
      { name: 'lope', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'intake', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'pops', defaultValue: 0, minValue: 0, maxValue: 2, automationRate: 'k-rate' },
      { name: 'cut', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }
  constructor() {
    super();
    const sr = sampleRate;
    this.phase = 0; this.lastFire = -1; this.fireIdx = 0;
    // order-tracking resonators (½, 1, 2, 3 × firing frequency) carry the
    // engine note at any rpm; fixed broad formants are the pipes and muffler
    this.ord = [new Res(30, 6, sr), new Res(60, 4, sr), new Res(120, 4, sr), new Res(180, 5, sr)];
    this.ordH = [0.5, 1, 2, 3];
    this.ordG = [0.45, 1.0, 0.55, 0.28];
    this.ex = [new Res(280, 1.0, sr), new Res(1150, 1.5, sr), new Res(3000, 2, sr)];
    this.exG = [0.6, 0.35, 0.12];
    this.lastRpm = 0;
    // intake roar
    this.in = [new Res(560, 2, sr), new Res(1650, 3, sr)];
    this.cyl = [1.0, 0.86, 1.08, 0.93, 1.05, 0.9, 1.1, 0.95];
    this.pulse = 0; this.noiseEnv = 0; this.popEnv = 0; this.popRes = new Res(1800, 1.5, sr);
    this.lp = 0; this.hp = 0; this.hpx = 0; this.crackle = 0;
    this.port.onmessage = (e) => { if (e.data.pop) this.popEnv = Math.max(this.popEnv, e.data.pop); };
  }
  process(inputs, outputs, P) {
    const out = outputs[0][0];
    const sr = sampleRate;
    const rpm = P.rpm[0], load = P.load[0], loud = P.loud[0], rasp = P.rasp[0], lope = P.lope[0], intake = P.intake[0], pops = P.pops[0], cut = P.cut[0];
    const firePerSec = rpm / 60 * 4; // V8, 4-stroke: 4 firings per crank rev
    const inc = firePerSec / sr;
    const lopeAmt = lope * Math.max(0, 1 - rpm / 3500);
    const exGain = 0.55 + loud * 0.9;
    const fire = Math.max(20, firePerSec);
    if (Math.abs(rpm - this.lastRpm) > 5) {
      for (let k = 0; k < 4; k++) this.ord[k].set(Math.min(sr * 0.45, fire * this.ordH[k]), k === 0 ? 6 : 4, sr);
      this.lastRpm = rpm;
    }
    // keep loudness roughly even across the rev range, rising with load
    const makeup = 0.9 * Math.pow(600 / fire, 0.35);
    for (let i = 0; i < out.length; i++) {
      this.phase += inc;
      if (this.phase >= 1) {
        this.phase -= 1;
        const c = this.fireIdx = (this.fireIdx + 1) & 7;
        let a = (0.25 + 0.75 * load) * this.cyl[c] * (1 + (Math.random() - 0.5) * 0.08);
        if (lopeAmt > 0 && (c === 2 || c === 5)) a *= 1 - lopeAmt * 0.7;
        if (cut > 0.5 && Math.random() < 0.6) a *= 0.1; // limiter bounce
        this.pulse = a;
        this.noiseEnv = a * (0.4 + rasp * 0.4);
        // overrun crackle: unburnt fuel on lift-off at high rpm
        if (load < 0.1 && rpm > 3200 && Math.random() < pops * 0.035) this.popEnv = Math.max(this.popEnv, 0.4 + Math.random() * 0.6 * pops);
      }
      // excitation: sharp pulse + combustion noise burst
      const nz = Math.random() * 2 - 1;
      const exc = this.pulse * 4 + nz * this.noiseEnv;
      this.pulse *= 0.55;
      this.noiseEnv *= 0.985;
      let y = 0;
      for (let k = 0; k < 4; k++) y += this.ord[k].run(exc) * this.ordG[k] * (k === 3 ? 1 + rasp * 0.6 : 1);
      y *= makeup * 2.2;
      let f = 0;
      for (let k = 0; k < 3; k++) f += this.ex[k].run(exc) * this.exG[k] * (k === 2 ? 1 + rasp : 1);
      y = (y + f * 1.4) * exGain;
      // intake howl rises with load and rpm
      const inExc = nz * (0.3 + load) * Math.min(1, rpm / 7000) * (0.25 + intake);
      y += (this.in[0].run(inExc) * 0.5 + this.in[1].run(inExc) * 0.35);
      // pops
      if (this.popEnv > 0.001) {
        const p = this.popRes.run((Math.random() * 2 - 1) * this.popEnv * 3) * 4;
        y += p; this.popEnv *= 0.9965;
      }
      // saturation + DC block
      y = Math.tanh(y * (1.2 + rasp * 0.8 + load * 0.6)) * 0.6;
      const hp = y - this.hpx + 0.995 * this.hp; this.hpx = y; this.hp = hp;
      out[i] = hp;
    }
    return true;
  }
}
registerProcessor('engine-v8', EngineProc);
