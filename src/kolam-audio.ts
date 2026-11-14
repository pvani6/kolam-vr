/**
 * Kolam sound design — every sound is synthesised live with the Web Audio
 * API, so there are no audio files and nothing to license.
 *
 *  - Dawn ambience: soft warm air + occasional bird calls.
 *  - Drawing: a gentle "rice flour" hiss that follows how fast you draw.
 *  - Completion: a temple bell.
 *
 * Browsers only allow audio after a user gesture, so call `unlock()` from a
 * click / pinch handler. Everything is safe to call before that (no-ops).
 */

class KolamAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private drawGain: GainNode | null = null;
  private birdTimer = 0;
  private started = false;
  muted = false;

  /** Create / resume the audio context. Call from a user gesture. */
  unlock(): void {
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.8;
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      if (!this.started) {
        this.started = true;
        this.startAmbience();
        this.startDrawNoise();
      }
    } catch {
      this.ctx = null;
    }
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  /** Call every frame. `drawSpeed` is metres/second of the fingertip while drawing (0 if not). */
  update(delta: number, drawSpeed: number): void {
    if (!this.ctx || !this.drawGain) return;
    const target = Math.min(0.22, drawSpeed * 0.9);
    this.drawGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.04);

    this.birdTimer -= delta;
    if (this.birdTimer <= 0) {
      this.birdTimer = 2.5 + Math.random() * 6;
      this.bird();
    }
  }

  /** A bright temple bell: inharmonic partials with a long decay. */
  bell(): void {
    const ctx = this.ctx;
    const out = this.master;
    if (!ctx || !out) return;
    const t = ctx.currentTime;
    const base = 523;
    const partials: [number, number, number][] = [
      // ratio, gain, decay seconds
      [0.5, 0.18, 3.5],
      [1, 0.35, 3.0],
      [2.0, 0.16, 2.2],
      [2.76, 0.14, 1.8],
      [3.76, 0.08, 1.2],
      [5.4, 0.05, 0.8],
    ];
    for (const [ratio, gain, decay] of partials) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = base * ratio * (1 + (Math.random() - 0.5) * 0.004);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + decay + 0.1);
    }
  }

  /** A soft click for buttons. */
  tap(): void {
    const ctx = this.ctx;
    const out = this.master;
    if (!ctx || !out) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(880, t);
    o.frequency.exponentialRampToValueAtTime(440, t + 0.08);
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.12);
  }

  /** A gentle low tone when a dot is touched (a mistake). */
  bump(): void {
    const ctx = this.ctx;
    const out = this.master;
    if (!ctx || !out) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.18);
    g.gain.setValueAtTime(0.15, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.25);
  }

  // -------------------------------------------------------------------------
  private noiseBuffer(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  private startAmbience(): void {
    const ctx = this.ctx!;
    // Warm morning air: very quiet low-passed noise, slowly breathing.
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(4);
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500;
    const g = ctx.createGain();
    g.gain.value = 0.035;
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.08;
    lfoGain.gain.value = 0.015;
    lfo.connect(lfoGain).connect(g.gain);
    src.connect(lp).connect(g).connect(this.master!);
    src.start();
    lfo.start();
    this.birdTimer = 1.2;
  }

  private startDrawNoise(): void {
    const ctx = this.ctx!;
    // Rice flour falling: band-passed noise, silent until drawing.
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(2);
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 3200;
    bp.Q.value = 0.7;
    this.drawGain = ctx.createGain();
    this.drawGain.gain.value = 0;
    src.connect(bp).connect(this.drawGain).connect(this.master!);
    src.start();
  }

  /** A short bird call: 2–5 quick rising/falling chirps, panned left or right. */
  private bird(): void {
    const ctx = this.ctx;
    const out = this.master;
    if (!ctx || !out) return;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    pan.connect(out);
    const chirps = 2 + Math.floor(Math.random() * 4);
    const base = 2400 + Math.random() * 1800;
    const rising = Math.random() < 0.5;
    let t = ctx.currentTime + 0.02;
    for (let i = 0; i < chirps; i++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      const f0 = base * (rising ? 0.8 : 1.15);
      const f1 = base * (rising ? 1.2 : 0.75);
      const len = 0.06 + Math.random() * 0.06;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f1, t + len);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.045, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      o.connect(g).connect(pan);
      o.start(t);
      o.stop(t + len + 0.02);
      t += len + 0.03 + Math.random() * 0.05;
    }
  }
}

export const kolamAudio = new KolamAudio();
