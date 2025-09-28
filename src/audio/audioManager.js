const Tone = window.Tone;

/**
 * Handles all Tone.js interactions, including initialization, playback
 * and lifecycle management.
 */
export class AudioManager {
  constructor() {
    this.initialized = false;
    this.muted = false;
    this.sources = new Map();
  }

  async initialize() {
    if (this.initialized) return;
    try {
      await Tone.start();
      this.initialized = true;
      this.#createSources();
      this.#startAmbient();
    } catch (error) {
      console.warn('Audio initialization failed', error);
    }
  }

  toggleMute(button) {
    this.muted = !this.muted;
    Tone.Master.mute = this.muted;
    if (button) {
      button.textContent = this.muted ? '🔇' : '🔊';
      button.classList.toggle('muted', this.muted);
    }
    if (!this.initialized && !this.muted) {
      this.initialize();
    }
  }

  dispose() {
    if (!this.initialized) return;
    for (const source of this.sources.values()) {
      if (typeof source.dispose === 'function') {
        source.dispose();
      }
    }
    this.sources.clear();
    this.initialized = false;
  }

  play(event) {
    if (!this.initialized || this.muted) return;
    const now = Tone.now();
    try {
      switch (event) {
        case 'move':
          this.sources.get('move').triggerAttackRelease(
            80 + Math.random() * 40,
            '32n',
            now,
          );
          break;
        case 'jump':
          this.sources.get('jump').triggerAttackRelease('C2', '8n', now);
          this.sources.get('jump').triggerAttackRelease('G3', '16n', now + 0.05);
          break;
        case 'collect':
          ['E5', 'G5', 'B5', 'E6'].forEach((note, index) => {
            this.sources
              .get('collect')
              .triggerAttackRelease(note, '32n', now + index * 0.05);
          });
          break;
        case 'powerUp':
          [
            ['C4', 'E4', 'G4', 'C5'],
            ['D4', 'F#4', 'A4', 'D5'],
            ['E4', 'G#4', 'B4', 'E5'],
          ].forEach((chord, index) => {
            this.sources
              .get('powerUp')
              .triggerAttackRelease(chord, '8n', now + index * 0.15);
          });
          break;
        case 'levelUp':
          [
            { note: 'C5', duration: '8n', offset: 0 },
            { note: 'E5', duration: '8n', offset: 0.2 },
            { note: 'G5', duration: '4n', offset: 0.4 },
          ].forEach(({ note, duration, offset }) => {
            this.sources
              .get('levelUp')
              .triggerAttackRelease(note, duration, now + offset);
          });
          break;
        case 'damage':
          this.sources.get('damage').triggerAttackRelease('16n', now);
          this.sources.get('damageSub').triggerAttackRelease('C1', '8n', now);
          break;
        case 'enemyAlert':
          this.sources.get('alert').triggerAttackRelease('A4', '32n', now);
          break;
        case 'boost':
          this.sources.get('boostEnv')?.triggerAttack(now);
          break;
        case 'boostEnd':
          this.sources.get('boostEnv')?.triggerRelease(now);
          break;
        case 'scrape':
          this.sources.get('move').triggerAttackRelease(
            400 + Math.random() * 200,
            '64n',
            now,
          );
          break;
        default:
          break;
      }
    } catch (error) {
      console.warn('Audio playback error', error);
    }
  }

  updateAmbient(level, health, state) {
    if (!this.initialized || !this.sources.has('ambientFilter')) return;
    const targetFreq =
      state === 'playing'
        ? 800 + level * 50 + (health < 30 ? 200 : 0)
        : 400;
    this.sources.get('ambientFilter').frequency.rampTo(targetFreq, 2);
  }

  #createSources() {
    const reverb = new Tone.Reverb({ decay: 1.5, wet: 0.2 }).toDestination();
    const delay = new Tone.FeedbackDelay({
      delayTime: '16n',
      feedback: 0.2,
      wet: 0.1,
    }).connect(reverb);

    this.sources.set(
      'move',
      new Tone.MonoSynth({
        oscillator: { type: 'sine' },
        envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.05 },
        volume: -20,
      }).connect(delay),
    );

    this.sources.set(
      'jump',
      new Tone.MonoSynth({
        oscillator: { type: 'square' },
        envelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.1 },
        filterEnvelope: {
          attack: 0.001,
          decay: 0.2,
          sustain: 0,
          release: 0.1,
          baseFrequency: 200,
          octaves: 4,
        },
        volume: -10,
      }).connect(reverb),
    );

    this.sources.set(
      'collect',
      new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'triangle' },
        envelope: { attack: 0.001, decay: 0.2, sustain: 0.1, release: 0.5 },
        volume: -12,
      }).connect(reverb),
    );

    this.sources.set(
      'powerUp',
      new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'sawtooth' },
        envelope: { attack: 0.05, decay: 0.2, sustain: 0.4, release: 0.8 },
        volume: -8,
      }).connect(reverb),
    );

    this.sources.set(
      'levelUp',
      new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'square' },
        envelope: { attack: 0.02, decay: 0.1, sustain: 0.6, release: 0.8 },
        volume: -6,
      }).connect(reverb),
    );

    this.sources.set(
      'damage',
      new Tone.NoiseSynth({
        noise: { type: 'pink' },
        envelope: { attack: 0.001, decay: 0.2, sustain: 0, release: 0.1 },
        volume: -8,
      }).connect(new Tone.Filter(800, 'lowpass').connect(reverb)),
    );

    this.sources.set(
      'damageSub',
      new Tone.MonoSynth({
        oscillator: { type: 'sine' },
        envelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.1 },
        volume: -6,
      }).toDestination(),
    );

    this.sources.set(
      'alert',
      new Tone.MonoSynth({
        oscillator: { type: 'pulse', width: 0.1 },
        envelope: { attack: 0.01, decay: 0.05, sustain: 0.5, release: 0.1 },
        volume: -15,
      }).connect(delay),
    );

    const boostNoise = new Tone.Noise({ type: 'white', volume: -20 }).connect(
      new Tone.Filter({ frequency: 2000, type: 'bandpass', rolloff: -24 }).connect(
        reverb,
      ),
    );
    const boostEnv = new Tone.AmplitudeEnvelope({
      attack: 0.1,
      decay: 0,
      sustain: 1,
      release: 0.3,
    }).toDestination();
    boostNoise.connect(boostEnv);
    this.sources.set('boost', boostNoise);
    this.sources.set('boostEnv', boostEnv);

    const ambientFilter = new Tone.Filter({
      frequency: 800,
      type: 'lowpass',
      rolloff: -12,
    }).toDestination();
    const ambientDrone = new Tone.Oscillator({
      frequency: 55,
      type: 'sine',
      volume: -30,
    }).connect(ambientFilter);
    const ambientPulse = new Tone.Oscillator({
      frequency: 110,
      type: 'triangle',
      volume: -35,
    }).connect(ambientFilter);
    const ambientLfo = new Tone.LFO({ frequency: '8n', min: 0.5, max: 1 });
    ambientLfo.connect(ambientFilter.frequency);

    this.sources.set('ambientFilter', ambientFilter);
    this.sources.set('ambientDrone', ambientDrone);
    this.sources.set('ambientPulse', ambientPulse);
    this.sources.set('ambientLfo', ambientLfo);
  }

  #startAmbient() {
    this.sources.get('ambientDrone')?.start();
    this.sources.get('ambientPulse')?.start();
    this.sources.get('ambientLfo')?.start();
  }
}
