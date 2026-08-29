/**
 * Procedural audio.
 *
 * Everything is synthesised at runtime with the Web Audio API - no files, no
 * libraries. The music is a small step sequencer whose layers fade in with
 * combat intensity, so the score reacts to what the player is doing instead of
 * looping obliviously underneath it.
 */

const BEATS_PER_MINUTE = 100;
const STEP_SECONDS = 60 / BEATS_PER_MINUTE / 4; // sixteenth notes
const LOOKAHEAD = 0.25;

/** One dark mode per depth, so descending is audible as well as visible. */
const DEPTH_VOICES = [
  { root: 55.00, scale: [0, 3, 5, 7, 10], name: 'aeolian' },      // A
  { root: 51.91, scale: [0, 2, 3, 7, 8], name: 'harmonic' },      // G#
  { root: 49.00, scale: [0, 1, 5, 6, 10], name: 'phrygian' },     // G
  { root: 46.25, scale: [0, 1, 6, 7, 11], name: 'locrian' },      // F#
];

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.started = false;
    this.intensity = 0;
    this.targetIntensity = 0;
    this.depth = 0;
    this.bossMode = false;
    this.nextStepTime = 0;
    this.step = 0;
  }

  /** Must be called from a user gesture; browsers refuse audio before one. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) { this.enabled = false; return; }
    this.ctx = new Ctx();

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(this.ctx.destination);

    // A gentle limiter keeps stacked layers from clipping.
    this.limiter = this.ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -12;
    this.limiter.ratio.value = 12;
    this.limiter.connect(this.master);

    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = 0.0;
    this.musicBus.connect(this.limiter);

    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = 0.9;
    this.sfxBus.connect(this.limiter);

    this.buildDrone();
    this.nextStepTime = this.ctx.currentTime + 0.1;
    this.started = true;
    this.musicBus.gain.setTargetAtTime(0.55, this.ctx.currentTime, 1.5);
  }

  setMuted(muted) {
    this.enabled = !muted;
    if (this.master) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.85, this.ctx.currentTime, 0.05);
    }
  }

  /** The continuous bed: two detuned saws under a slow filter sweep. */
  buildDrone() {
    const voice = DEPTH_VOICES[0];
    this.droneGain = this.ctx.createGain();
    this.droneGain.gain.value = 0.16;
    this.droneFilter = this.ctx.createBiquadFilter();
    this.droneFilter.type = 'lowpass';
    this.droneFilter.frequency.value = 240;
    this.droneFilter.Q.value = 6;
    this.droneGain.connect(this.droneFilter);
    this.droneFilter.connect(this.musicBus);

    this.droneOscs = [];
    for (const detune of [-7, 5]) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = voice.root;
      osc.detune.value = detune;
      osc.connect(this.droneGain);
      osc.start();
      this.droneOscs.push(osc);
    }
    // A slow LFO on the filter keeps the bed from feeling static.
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.06;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 110;
    lfo.connect(lfoGain);
    lfoGain.connect(this.droneFilter.frequency);
    lfo.start();
  }

  setDepth(depth) {
    if (!this.ctx || depth === this.depth) return;
    this.depth = depth;
    const voice = DEPTH_VOICES[Math.min(depth, DEPTH_VOICES.length - 1)];
    for (const osc of this.droneOscs) {
      osc.frequency.setTargetAtTime(voice.root, this.ctx.currentTime, 0.8);
    }
  }

  setBoss(on) {
    this.bossMode = on;
  }

  /** 0 = exploring, 1 = surrounded. Drives which layers are audible. */
  setIntensity(value) {
    this.targetIntensity = Math.max(0, Math.min(1, value));
  }

  note(index) {
    const voice = DEPTH_VOICES[Math.min(this.depth, DEPTH_VOICES.length - 1)];
    const octave = Math.floor(index / voice.scale.length);
    const degree = voice.scale[index % voice.scale.length];
    return voice.root * Math.pow(2, octave + degree / 12);
  }

  /** Schedule any steps that fall inside the lookahead window. */
  update(dt) {
    if (!this.ctx || !this.started) return;
    this.intensity += (this.targetIntensity - this.intensity) * Math.min(1, dt * 1.6);
    const now = this.ctx.currentTime;
    while (this.nextStepTime < now + LOOKAHEAD) {
      this.scheduleStep(this.step, this.nextStepTime);
      this.step = (this.step + 1) % 32;
      this.nextStepTime += STEP_SECONDS;
    }
    if (this.droneGain) {
      const target = 0.14 + this.intensity * 0.10 + (this.bossMode ? 0.08 : 0);
      this.droneGain.gain.setTargetAtTime(target, now, 0.4);
    }
  }

  scheduleStep(step, time) {
    const heat = this.intensity;
    const boss = this.bossMode;

    // Kick: the pulse of the run. Doubles up once combat gets hot.
    if (step % 8 === 0 || (heat > 0.45 && step % 8 === 6) || (boss && step % 4 === 2)) {
      this.kick(time, 0.55 + heat * 0.25);
    }
    // Bass movement on the half bar.
    if (step % 4 === 0) {
      const pattern = boss ? [0, 0, 4, 3] : [0, 2, 0, 4];
      const degree = pattern[(step / 4) % 4];
      this.bass(time, this.note(degree) * 2, 0.28 + heat * 0.12);
    }
    // Hats appear as things get dangerous.
    if (heat > 0.3 && step % 2 === 1) {
      this.hat(time, 0.05 + heat * 0.09);
    }
    // A restless arpeggio only when enemies are actually on you.
    if (heat > 0.55 && step % 2 === 0) {
      const degrees = boss ? [7, 8, 10, 11] : [7, 9, 10, 12];
      const degree = degrees[(step / 2) % degrees.length];
      this.pluck(time, this.note(degree), 0.10 + heat * 0.10);
    }
    // Boss stinger: a tritone shudder every two bars.
    if (boss && step === 0) {
      this.bass(time, this.note(0) * 1.414, 0.30);
    }
  }

  /* ---------------------------- instruments ---------------------------- */

  kick(time, gain) {
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(130, time);
    osc.frequency.exponentialRampToValueAtTime(38, time + 0.13);
    env.gain.setValueAtTime(gain, time);
    env.gain.exponentialRampToValueAtTime(0.0001, time + 0.28);
    osc.connect(env);
    env.connect(this.musicBus);
    osc.start(time);
    osc.stop(time + 0.3);
  }

  bass(time, freq, gain) {
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();
    osc.type = 'square';
    osc.frequency.value = freq;
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(700, time);
    filter.frequency.exponentialRampToValueAtTime(180, time + 0.35);
    env.gain.setValueAtTime(0.0001, time);
    env.gain.exponentialRampToValueAtTime(gain, time + 0.02);
    env.gain.exponentialRampToValueAtTime(0.0001, time + 0.42);
    osc.connect(filter);
    filter.connect(env);
    env.connect(this.musicBus);
    osc.start(time);
    osc.stop(time + 0.45);
  }

  pluck(time, freq, gain) {
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    env.gain.setValueAtTime(0.0001, time);
    env.gain.exponentialRampToValueAtTime(gain, time + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, time + 0.22);
    osc.connect(env);
    env.connect(this.musicBus);
    osc.start(time);
    osc.stop(time + 0.25);
  }

  hat(time, gain) {
    const src = this.noiseSource(0.06);
    const filter = this.ctx.createBiquadFilter();
    const env = this.ctx.createGain();
    filter.type = 'highpass';
    filter.frequency.value = 7000;
    env.gain.setValueAtTime(gain, time);
    env.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
    src.connect(filter);
    filter.connect(env);
    env.connect(this.musicBus);
    src.start(time);
    src.stop(time + 0.07);
  }

  noiseSource(seconds) {
    const frames = Math.max(1, Math.floor(this.ctx.sampleRate * seconds));
    const buffer = this.ctx.createBuffer(1, frames, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i += 1) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    return src;
  }

  /* ------------------------------- sfx --------------------------------- */

  /** A tone with an exponential envelope. The workhorse behind most effects. */
  blip(opts) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const {
      type = 'square', from = 880, to = 220, gain = 0.2,
      attack = 0.005, decay = 0.14, filter = null,
    } = opts;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + decay);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    let node = osc;
    if (filter) {
      const biquad = this.ctx.createBiquadFilter();
      biquad.type = filter.type || 'lowpass';
      biquad.frequency.value = filter.frequency || 1200;
      biquad.Q.value = filter.Q || 1;
      osc.connect(biquad);
      node = biquad;
    }
    node.connect(env);
    env.connect(this.sfxBus);
    osc.start(t);
    osc.stop(t + decay + 0.02);
  }

  burst(opts) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const { gain = 0.25, decay = 0.2, from = 4000, to = 300, type = 'lowpass' } = opts;
    const src = this.noiseSource(decay + 0.05);
    const filter = this.ctx.createBiquadFilter();
    const env = this.ctx.createGain();
    filter.type = type;
    filter.frequency.setValueAtTime(from, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, to), t + decay);
    env.gain.setValueAtTime(gain, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    src.connect(filter);
    filter.connect(env);
    env.connect(this.sfxBus);
    src.start(t);
    src.stop(t + decay + 0.05);
  }

  play(name) {
    if (!this.ctx || !this.enabled) return;
    switch (name) {
      case 'shoot':
        this.blip({ type: 'square', from: 1250, to: 260, gain: 0.16, decay: 0.09, filter: { type: 'lowpass', frequency: 2600 } });
        this.burst({ gain: 0.08, decay: 0.06, from: 6000, to: 1200 });
        break;
      case 'blast':
        this.blip({ type: 'sawtooth', from: 420, to: 60, gain: 0.3, decay: 0.34 });
        this.burst({ gain: 0.24, decay: 0.3, from: 2600, to: 160 });
        break;
      case 'charge':
        this.blip({ type: 'triangle', from: 180, to: 900, gain: 0.12, decay: 0.5 });
        break;
      case 'hitWall':
        this.burst({ gain: 0.10, decay: 0.08, from: 2600, to: 500 });
        break;
      case 'hitEnemy':
        this.blip({ type: 'square', from: 1700, to: 700, gain: 0.14, decay: 0.07 });
        break;
      case 'notice':
        this.blip({ type: 'sawtooth', from: 160, to: 95, gain: 0.16, decay: 0.4, filter: { type: 'lowpass', frequency: 900 } });
        break;
      case 'windup':
        // A rising warning: the sound of something about to hit you.
        this.blip({ type: 'triangle', from: 300, to: 780, gain: 0.13, decay: 0.30 });
        break;
      case 'enemyHurt':
        this.blip({ type: 'sawtooth', from: 300, to: 120, gain: 0.16, decay: 0.15 });
        break;
      case 'enemyDie':
        this.blip({ type: 'sawtooth', from: 260, to: 45, gain: 0.22, decay: 0.4 });
        this.burst({ gain: 0.2, decay: 0.35, from: 3200, to: 120 });
        break;
      case 'playerHurt':
        this.blip({ type: 'sawtooth', from: 200, to: 70, gain: 0.3, decay: 0.28 });
        this.burst({ gain: 0.18, decay: 0.2, from: 900, to: 90 });
        break;
      case 'pickup':
        this.blip({ type: 'triangle', from: 620, to: 1240, gain: 0.16, decay: 0.14 });
        break;
      case 'key':
        this.blip({ type: 'sine', from: 880, to: 1760, gain: 0.2, decay: 0.3 });
        this.blip({ type: 'sine', from: 1320, to: 2640, gain: 0.1, decay: 0.34 });
        break;
      case 'door':
        this.burst({ gain: 0.26, decay: 0.6, from: 700, to: 90, type: 'bandpass' });
        this.blip({ type: 'sawtooth', from: 90, to: 45, gain: 0.18, decay: 0.6 });
        break;
      case 'descend':
        this.blip({ type: 'sine', from: 520, to: 130, gain: 0.22, decay: 0.6 });
        break;
      case 'bossRoar':
        this.blip({ type: 'sawtooth', from: 150, to: 42, gain: 0.34, decay: 1.4 });
        this.blip({ type: 'square', from: 106, to: 30, gain: 0.2, decay: 1.6 });
        this.burst({ gain: 0.2, decay: 1.2, from: 1200, to: 70 });
        break;
      case 'victory':
        [0, 4, 7, 12].forEach((semi, i) => {
          setTimeout(() => this.blip({ type: 'triangle', from: 440 * Math.pow(2, semi / 12), to: 440 * Math.pow(2, semi / 12), gain: 0.2, decay: 0.5 }), i * 110);
        });
        break;
      case 'death':
        this.blip({ type: 'sawtooth', from: 320, to: 28, gain: 0.32, decay: 1.6 });
        this.burst({ gain: 0.24, decay: 1.4, from: 1800, to: 60 });
        break;
      default:
        break;
    }
  }
}
