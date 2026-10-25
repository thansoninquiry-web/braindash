/**
 * The generated ambient bed: a slow, detuned pad drifting through a reverb and
 * a delay, with sparse pentatonic pings. Nothing is fetched and nothing is
 * written — it is all oscillators and noise buffers, so it ships with the app.
 *
 * The engine is deliberately lazy: browsers refuse to start audio outside a
 * gesture, so `start()` is only ever called from a click.
 */

/** A minor pentatonic around A4 — any subset sounds consonant over the pad. */
const PING_HZ = [440, 523.25, 587.33, 659.25, 783.99, 880];

/** Slider value (0–1) to gain. Squaring keeps small volumes audible. */
export function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) return 0;
  return Math.min(1, Math.max(0, volume));
}

export function volumeToGain(volume: number): number {
  const clamped = clampVolume(volume);
  return clamped * clamped;
}

export function percentLabel(volume: number): string {
  return `${Math.round(clampVolume(volume) * 100)}%`;
}

function noiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const frames = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const channel = buffer.getChannelData(0);
  // Pink-ish noise: a one-pole filter over white noise is cheaper to read than
  // a full Voss-McCartney generator and sounds warmer under a bandpass.
  let last = 0;
  for (let index = 0; index < frames; index += 1) {
    const white = Math.random() * 2 - 1;
    last = 0.97 * last + 0.03 * white;
    channel[index] = last * 3.2;
  }
  return buffer;
}

/** Exponentially decaying stereo noise — a cheap, smooth hall. */
function impulseResponse(ctx: AudioContext, seconds: number): AudioBuffer {
  const frames = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, frames, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < frames; index += 1) {
      const decay = Math.pow(1 - index / frames, 2.8);
      data[index] = (Math.random() * 2 - 1) * decay;
    }
  }
  return buffer;
}

export class AmbientEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sources: AudioScheduledSourceNode[] = [];
  private blipTimer: number | null = null;
  private stopTimer: number | null = null;
  private volume = 0.5;
  private running = false;

  get isRunning(): boolean {
    return this.running;
  }

  /** Starts the bed, or just retunes the volume if it is already playing. */
  start(volume: number): void {
    this.volume = clampVolume(volume);
    if (this.running) {
      this.setVolume(this.volume);
      return;
    }
    const Ctor =
      window.AudioContext ??
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;

    const ctx = new Ctor();
    const master = ctx.createGain();
    master.gain.value = 0.0001;
    master.connect(ctx.destination);

    // --- space -----------------------------------------------------------
    const reverb = ctx.createConvolver();
    reverb.buffer = impulseResponse(ctx, 3.4);
    const wet = ctx.createGain();
    wet.gain.value = 0.6;
    reverb.connect(wet);
    wet.connect(master);

    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.42;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.36;
    delay.connect(feedback);
    feedback.connect(delay);
    const delaySend = ctx.createGain();
    delaySend.gain.value = 0.5;
    delay.connect(delaySend);
    delaySend.connect(reverb);
    delaySend.connect(master);

    // --- pad -------------------------------------------------------------
    const pad = ctx.createGain();
    pad.gain.value = 0.85;
    pad.connect(master);
    pad.connect(reverb);

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 560;
    filter.Q.value = 0.9;
    filter.connect(pad);

    // A very slow sweep on the cutoff keeps the chord from sounding static.
    const sweep = ctx.createOscillator();
    sweep.frequency.value = 0.031;
    const sweepDepth = ctx.createGain();
    sweepDepth.gain.value = 210;
    sweep.connect(sweepDepth);
    sweepDepth.connect(filter.frequency);
    sweep.start();
    this.sources.push(sweep);

    const voices: { type: OscillatorType; hz: number; detune: number; gain: number }[] = [
      { type: "sawtooth", hz: 110, detune: -5, gain: 0.05 },
      { type: "sawtooth", hz: 164.81, detune: 7, gain: 0.036 },
      { type: "triangle", hz: 246.94, detune: -4, gain: 0.028 },
      { type: "sine", hz: 329.63, detune: 0, gain: 0.013 },
    ];
    for (const voice of voices) {
      const osc = ctx.createOscillator();
      osc.type = voice.type;
      osc.frequency.value = voice.hz;
      osc.detune.value = voice.detune;
      const gain = ctx.createGain();
      gain.gain.value = voice.gain;
      osc.connect(gain);
      gain.connect(filter);
      osc.start();
      this.sources.push(osc);
    }

    // Sub, off the filter so it stays solid under the sweep.
    const sub = ctx.createOscillator();
    sub.type = "sine";
    sub.frequency.value = 55;
    const subGain = ctx.createGain();
    subGain.gain.value = 0.07;
    sub.connect(subGain);
    subGain.connect(master);
    sub.start();
    this.sources.push(sub);

    // --- air -------------------------------------------------------------
    const air = ctx.createBufferSource();
    air.buffer = noiseBuffer(ctx, 4);
    air.loop = true;
    const airFilter = ctx.createBiquadFilter();
    airFilter.type = "bandpass";
    airFilter.frequency.value = 1900;
    airFilter.Q.value = 0.6;
    const airGain = ctx.createGain();
    airGain.gain.value = 0.02;
    const airLfo = ctx.createOscillator();
    airLfo.frequency.value = 0.047;
    const airDepth = ctx.createGain();
    airDepth.gain.value = 0.008;
    airLfo.connect(airDepth);
    airDepth.connect(airGain.gain);
    air.connect(airFilter);
    airFilter.connect(airGain);
    airGain.connect(master);
    air.start();
    airLfo.start();
    this.sources.push(air, airLfo);

    // --- pings -----------------------------------------------------------
    const ping = () => {
      if (!this.ctx || !this.master) return;
      const start = this.ctx.currentTime + 0.05;
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = PING_HZ[Math.floor(Math.random() * PING_HZ.length)] ?? 440;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, start);
      env.gain.linearRampToValueAtTime(0.075, start + 0.4);
      env.gain.exponentialRampToValueAtTime(0.0001, start + 3.6);
      const pan = ctx.createStereoPanner();
      pan.pan.value = Math.random() * 1.2 - 0.6;
      osc.connect(env);
      env.connect(pan);
      pan.connect(master);
      pan.connect(delay);
      osc.start(start);
      osc.stop(start + 3.8);
      osc.onended = () => {
        osc.disconnect();
        env.disconnect();
        pan.disconnect();
      };
    };
    const schedule = () => {
      ping();
      this.blipTimer = window.setTimeout(schedule, 5_200 + Math.random() * 7_000);
    };
    this.blipTimer = window.setTimeout(schedule, 2_600);

    this.ctx = ctx;
    this.master = master;
    this.running = true;
    void ctx.resume();
    const now = ctx.currentTime;
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(Math.max(volumeToGain(this.volume), 0.0001), now + 2.4);
  }

  setVolume(volume: number): void {
    this.volume = clampVolume(volume);
    if (!this.ctx || !this.master) return;
    const gain = Math.max(volumeToGain(this.volume), 0.0001);
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.setTargetAtTime(gain, this.ctx.currentTime, 0.12);
  }

  /** Fades out, then tears the graph down so an idle tab holds no audio node. */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.blipTimer !== null) {
      window.clearTimeout(this.blipTimer);
      this.blipTimer = null;
    }
    const ctx = this.ctx;
    const master = this.master;
    this.master = null;
    this.ctx = null;
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // Already stopped; nothing to do.
      }
    }
    this.sources = [];
    if (!ctx) return;
    if (master) {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.18);
    }
    this.stopTimer = window.setTimeout(() => {
      this.stopTimer = null;
      void ctx.close().catch(() => undefined);
    }, 1_100);
  }

  /** Immediate teardown for unmounts; skips the fade. */
  dispose(): void {
    if (this.blipTimer !== null) window.clearTimeout(this.blipTimer);
    if (this.stopTimer !== null) window.clearTimeout(this.stopTimer);
    this.blipTimer = null;
    this.stopTimer = null;
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
    }
    this.sources = [];
    const ctx = this.ctx;
    this.ctx = null;
    this.master = null;
    this.running = false;
    if (ctx) void ctx.close().catch(() => undefined);
  }
}
