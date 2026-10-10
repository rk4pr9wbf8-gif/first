// Synthesised engine, tyre and wind sound (Web Audio, no samples).
export class CarAudio {
  constructor() { this.ctx = null; this.muted = false; }

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = 0.55;
    // tunnel echo
    this.delay = ctx.createDelay(1); this.delay.delayTime.value = 0.11;
    this.fb = ctx.createGain(); this.fb.gain.value = 0;
    this.wet = ctx.createGain(); this.wet.gain.value = 0;
    this.master.connect(ctx.destination);
    this.master.connect(this.delay); this.delay.connect(this.fb); this.fb.connect(this.delay);
    this.delay.connect(this.wet); this.wet.connect(ctx.destination);

    this.engGain = ctx.createGain(); this.engGain.gain.value = 0.0;
    this.filt = ctx.createBiquadFilter(); this.filt.type = 'lowpass'; this.filt.frequency.value = 900; this.filt.Q.value = 2;
    this.o1 = ctx.createOscillator(); this.o1.type = 'sawtooth';
    this.o2 = ctx.createOscillator(); this.o2.type = 'square';
    this.o3 = ctx.createOscillator(); this.o3.type = 'sine';
    const g2 = ctx.createGain(); g2.gain.value = 0.35;
    const g3 = ctx.createGain(); g3.gain.value = 0.8;
    this.o1.connect(this.filt); this.o2.connect(g2); g2.connect(this.filt); this.o3.connect(g3); g3.connect(this.filt);
    this.filt.connect(this.engGain); this.engGain.connect(this.master);
    [this.o1, this.o2, this.o3].forEach(o => o.start());

    const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = last * 0.97 + (Math.random() * 2 - 1) * 0.03; d[i] = last * 6 + (Math.random() * 2 - 1) * 0.15; }
    this.noise = ctx.createBufferSource(); this.noise.buffer = buf; this.noise.loop = true;
    this.windF = ctx.createBiquadFilter(); this.windF.type = 'bandpass'; this.windF.frequency.value = 500; this.windF.Q.value = 0.6;
    this.windG = ctx.createGain(); this.windG.gain.value = 0;
    this.noise.connect(this.windF); this.windF.connect(this.windG); this.windG.connect(this.master);
    this.skidF = ctx.createBiquadFilter(); this.skidF.type = 'bandpass'; this.skidF.frequency.value = 1100; this.skidF.Q.value = 6;
    this.skidG = ctx.createGain(); this.skidG.gain.value = 0;
    this.noise.connect(this.skidF); this.skidF.connect(this.skidG); this.skidG.connect(this.master);
    this.noise.start();
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.55;
    return this.muted;
  }

  update(speed, throttle, slip, tunnel, offroad) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const v = Math.abs(speed);
    const gears = [0, 9, 17, 26, 36, 48, 999];
    let gi = 1; while (v > gears[gi]) gi++;
    const lo = gears[gi - 1], hi = Math.min(gears[gi], 70);
    const frac = Math.min(1, (v - lo) / (hi - lo));
    const rpm = 950 + frac * 4300 + throttle * 500 * (gi === 1 ? 1.5 : 1);
    const f = rpm / 60 * 1.5;
    this.o1.frequency.setTargetAtTime(f, t, 0.05);
    this.o2.frequency.setTargetAtTime(f * 0.5, t, 0.05);
    this.o3.frequency.setTargetAtTime(f * 0.25, t, 0.05);
    this.filt.frequency.setTargetAtTime(500 + throttle * 1400 + rpm * 0.12, t, 0.08);
    this.engGain.gain.setTargetAtTime(0.06 + throttle * 0.09, t, 0.1);
    this.windG.gain.setTargetAtTime(Math.min(0.5, v * v * 0.00012) + (offroad ? Math.min(0.25, v * 0.012) : 0), t, 0.2);
    this.windF.frequency.setTargetAtTime(offroad ? 260 : 380 + v * 9, t, 0.2);
    this.skidG.gain.setTargetAtTime(Math.min(0.22, slip * 0.3) * (v > 4 ? 1 : 0), t, 0.05);
    this.fb.gain.setTargetAtTime(tunnel * 0.42, t, 0.2);
    this.wet.gain.setTargetAtTime(tunnel * 0.5, t, 0.2);
    this.rpm = rpm; this.gear = gi;
  }
}
