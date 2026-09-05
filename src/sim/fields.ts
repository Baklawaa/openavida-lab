import { clamp } from "./mapping";
import { TERRAIN, type EnvSample, type SimParams } from "./types";

export const FIELD_NAMES = ["nutrient", "toxin", "temperature", "light"] as const;
export type FieldName = (typeof FIELD_NAMES)[number];

/**
 * Four scalar fields on a dense grid. Diffusion is a 4-neighbor Jacobi step
 * that does not cross barriers. World.step calls advance() — tests can also
 * call diffuseFrom() to drive the same kernel.
 */
export class Fields {
  readonly w: number;
  readonly h: number;
  nutrient: Float32Array;
  toxin: Float32Array;
  temperature: Float32Array;
  light: Float32Array;
  solar: Float32Array;
  private scratch: Float32Array;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    const n = w * h;
    this.nutrient = new Float32Array(n);
    this.toxin = new Float32Array(n);
    this.temperature = new Float32Array(n);
    this.light = new Float32Array(n);
    this.solar = new Float32Array(n);
    this.scratch = new Float32Array(n);
  }

  idx(x: number, y: number): number {
    return y * this.w + x;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  sample(x: number, y: number): EnvSample {
    const i = this.idx(x, y);
    return {
      nutrient: this.nutrient[i]!,
      toxin: this.toxin[i]!,
      temperature: this.temperature[i]!,
      light: this.light[i]!,
    };
  }

  get(name: FieldName): Float32Array {
    return this[name];
  }

  addBlob(name: FieldName, cx: number, cy: number, radius: number, amount: number): void {
    const field = this.get(name);
    const r = Math.max(0, radius);
    const r2 = r * r;
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(this.w - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(this.h - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
        if (d2 > r2) continue;
        const fall = 1 - Math.sqrt(d2) / (r + 0.001);
        const i = this.idx(x, y);
        field[i] = clamp(field[i]! + amount * fall, 0, 4);
      }
    }
  }

  /**
   * One Jacobi diffusion step. Barriers are excluded from the neighbor
   * average so material does not flow through walls.
   */
  diffuse(src: Float32Array, dst: Float32Array, rate: number, terrain: Uint8Array): void {
    const w = this.w;
    const h = this.h;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (terrain[i] === TERRAIN.barrier) {
          dst[i] = src[i]! * 0.92;
          continue;
        }
        let sum = src[i]!;
        let n = 1;
        if (x > 0 && terrain[i - 1] !== TERRAIN.barrier) {
          sum += src[i - 1]!;
          n++;
        }
        if (x < w - 1 && terrain[i + 1] !== TERRAIN.barrier) {
          sum += src[i + 1]!;
          n++;
        }
        if (y > 0 && terrain[i - w] !== TERRAIN.barrier) {
          sum += src[i - w]!;
          n++;
        }
        if (y < h - 1 && terrain[i + w] !== TERRAIN.barrier) {
          sum += src[i + w]!;
          n++;
        }
        const avg = sum / n;
        dst[i] = src[i]! + rate * (avg - src[i]!);
      }
    }
  }

  /** Diffuse all four fields from a local impulse — used by tests and step. */
  diffuseAll(rate: number, terrain: Uint8Array): void {
    const s = this.scratch;
    this.diffuse(this.nutrient, s, rate, terrain);
    this.nutrient.set(s);
    this.diffuse(this.toxin, s, rate, terrain);
    this.toxin.set(s);
    this.diffuse(this.temperature, s, rate, terrain);
    this.temperature.set(s);
    this.diffuse(this.light, s, rate, terrain);
    this.light.set(s);
  }

  applyVentsAndDecay(terrain: Uint8Array, params: SimParams, lightScale = 1): void {
    const n = this.w * this.h;
    const sun = lightScale < 0 ? 0 : lightScale;
    for (let i = 0; i < n; i++) {
      const t = terrain[i]!;
      if (t === TERRAIN.nutrientVent) this.nutrient[i] = this.nutrient[i]! + 0.08;
      if (t === TERRAIN.toxinVent) this.toxin[i] = this.toxin[i]! + 0.07;
      if (t === TERRAIN.thermalVent) this.temperature[i] = this.temperature[i]! + 0.05;
      this.nutrient[i] = clamp(this.nutrient[i]! * (1 - params.nutrientDecay), 0, 4);
      this.toxin[i] = clamp(this.toxin[i]! * (1 - params.toxinDecay), 0, 4);
      this.temperature[i] = clamp(this.temperature[i]! * (1 - params.temperatureDecay), 0, 1.5);
      const shade = t === TERRAIN.shade ? 0.35 : 1;
      this.light[i] = clamp(
        this.light[i]! * (1 - params.lightDecay) + this.solar[i]! * 0.08 * shade * sun,
        0,
        2,
      );
    }
  }

  advance(terrain: Uint8Array, params: SimParams, lightScale = 1): void {
    this.diffuseAll(params.diffusionRate, terrain);
    this.applyVentsAndDecay(terrain, params, lightScale);
  }

  consumeNutrient(x: number, y: number, amount: number): number {
    const i = this.idx(x, y);
    const have = this.nutrient[i]!;
    const take = have < amount ? have : amount;
    this.nutrient[i] = have - take;
    return take;
  }

  checksum(): number {
    let h = 2166136261;
    const mix = (arr: Float32Array) => {
      for (let i = 0; i < arr.length; i += 7) {
        h ^= Math.round(arr[i]! * 1000);
        h = Math.imul(h, 16777619);
      }
    };
    mix(this.nutrient);
    mix(this.toxin);
    mix(this.temperature);
    mix(this.light);
    return h >>> 0;
  }

  copyFrom(other: Fields): void {
    this.nutrient.set(other.nutrient);
    this.toxin.set(other.toxin);
    this.temperature.set(other.temperature);
    this.light.set(other.light);
    this.solar.set(other.solar);
  }

  toArrays(): {
    nutrient: number[];
    toxin: number[];
    temperature: number[];
    light: number[];
    solar: number[];
  } {
    return {
      nutrient: Array.from(this.nutrient),
      toxin: Array.from(this.toxin),
      temperature: Array.from(this.temperature),
      light: Array.from(this.light),
      solar: Array.from(this.solar),
    };
  }

  fromArrays(data: {
    nutrient: number[];
    toxin: number[];
    temperature: number[];
    light: number[];
    solar: number[];
  }): void {
    this.nutrient.set(data.nutrient);
    this.toxin.set(data.toxin);
    this.temperature.set(data.temperature);
    this.light.set(data.light);
    this.solar.set(data.solar);
  }

  packRGBA(out: Uint8Array): void {
    const n = this.w * this.h;
    for (let i = 0; i < n; i++) {
      out[i * 4] = toByte(this.nutrient[i]!);
      out[i * 4 + 1] = toByte(this.toxin[i]!);
      out[i * 4 + 2] = toByte(this.temperature[i]!);
      out[i * 4 + 3] = toByte(this.light[i]!);
    }
  }
}

function toByte(v: number): number {
  const x = v * 160;
  if (x <= 0) return 0;
  if (x >= 255) return 255;
  return x | 0;
}
