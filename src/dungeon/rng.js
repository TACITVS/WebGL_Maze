/**
 * Deterministic pseudo random number generator.
 *
 * The whole dungeon is a pure function of one seed, so a seed is enough to
 * reproduce a level exactly. xorshift32 is small, fast and has a long enough
 * period for level generation.
 */
export class RNG {
  constructor(seed) {
    this.state = (seed >>> 0) || 0x9e3779b9;
    // Mix the seed a little so that neighbouring seeds diverge immediately.
    for (let i = 0; i < 8; i += 1) this.next();
  }

  /** Float in [0, 1). */
  next() {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state / 4294967296;
  }

  /** Integer in [0, n). */
  int(n) {
    return Math.floor(this.next() * n);
  }

  /** Integer in [a, b] inclusive. */
  range(a, b) {
    return a + this.int(b - a + 1);
  }

  /** Float in [a, b). */
  float(a, b) {
    return a + (b - a) * this.next();
  }

  /** True with probability p. */
  chance(p) {
    return this.next() < p;
  }

  /** Uniformly pick one element. */
  pick(list) {
    return list[this.int(list.length)];
  }

  /** In-place Fisher-Yates shuffle. */
  shuffle(list) {
    for (let i = list.length - 1; i > 0; i -= 1) {
      const j = this.int(i + 1);
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  }
}
