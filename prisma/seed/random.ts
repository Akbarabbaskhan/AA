/**
 * A seeded PRNG, so the seed is reproducible.
 *
 * "Idempotent, under 60 seconds" — idempotent means running it twice produces the same
 * school, not a second one with different names. Math.random would break that.
 */
export class Rng {
  private state: number;

  constructor(seed = 0x5eed_1e55) {
    this.state = seed >>> 0;
  }

  /** xorshift32 — fast, deterministic, and good enough for demo data. */
  next(): number {
    let x = this.state;
    x ^= x << 13;
    x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5;
    x >>>= 0;
    this.state = x;
    return x / 0x1_0000_0000;
  }

  int(minInclusive: number, maxInclusive: number): number {
    return minInclusive + Math.floor(this.next() * (maxInclusive - minInclusive + 1));
  }

  pick<T>(items: readonly T[]): T {
    const item = items[this.int(0, items.length - 1)];
    if (item === undefined) throw new Error('Cannot pick from an empty list');
    return item;
  }

  /** Picks `count` distinct items. */
  sample<T>(items: readonly T[], count: number): T[] {
    const pool = [...items];
    const taken: T[] = [];
    const wanted = Math.min(count, pool.length);
    for (let index = 0; index < wanted; index += 1) {
      const [item] = pool.splice(this.int(0, pool.length - 1), 1);
      if (item !== undefined) taken.push(item);
    }
    return taken;
  }

  bool(probability: number): boolean {
    return this.next() < probability;
  }

  /** Box–Muller, clamped — for marks and attendance that form a believable curve. */
  normal(mean: number, stdDev: number, min: number, max: number): number {
    const u1 = Math.max(this.next(), 1e-9);
    const u2 = this.next();
    const value = mean + stdDev * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return Math.min(max, Math.max(min, value));
  }
}
