import { Emitter } from '../core/emitter.js';

/**
 * Centralized mutable game state with observable properties.
 */
export class GameStateManager extends Emitter {
  constructor() {
    super();
    this.reset();
  }

  get score() {
    return this.#score;
  }

  set score(value) {
    this.#score = value;
    this.emit('scoreChanged', this.#score);
  }

  get health() {
    return this.#health;
  }

  set health(value) {
    const normalized = Math.max(0, Math.min(100, value));
    if (normalized === this.#health) return;
    this.#health = normalized;
    this.emit('healthChanged', this.#health);
  }

  get energy() {
    return this.#energy;
  }

  set energy(value) {
    const normalized = Math.max(0, Math.min(100, value));
    if (normalized === this.#energy) return;
    this.#energy = normalized;
    this.emit('energyChanged', this.#energy);
  }

  get level() {
    return this.#level;
  }

  set level(value) {
    this.#level = value;
    this.emit('levelChanged', this.#level);
  }

  addScore(points, multiplier = 1) {
    this.score += points * multiplier;
  }

  reset() {
    this.#score = 0;
    this.#health = 100;
    this.#energy = 100;
    this.#level = 1;
  }

  #score = 0;
  #health = 100;
  #energy = 100;
  #level = 1;
}
