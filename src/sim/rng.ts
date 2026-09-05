/** Seeded mulberry32. All sim randomness goes through this — never Math.random. */
export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = (seed >>> 0) || 1;
  }

  /** Uniform in [0, 1). */
  next(): number {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(n: number): number {
    if (n <= 0) return 0;
    return Math.floor(this.next() * n);
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)]!;
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Inclusive integer range. */
  intRange(lo: number, hi: number): number {
    return lo + this.int(hi - lo + 1);
  }

  state(): number {
    return this.s >>> 0;
  }

  setState(s: number): void {
    this.s = s >>> 0 || 1;
  }

  clone(): Rng {
    const r = new Rng(1);
    r.s = this.s;
    return r;
  }
}

export function mixSeed(seed: number, salt: number): number {
  let h = (seed >>> 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ salt, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
