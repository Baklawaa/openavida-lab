/**
 * Overlay helpers for the plate: normalising a scalar field for the R8 overlay
 * texture and describing what the exudate layer currently contains.
 *
 * Pure and DOM-free so both can be unit tested; the renderer and the app share
 * these constants so the layer's contrast is defined in exactly one place.
 */
import type { World } from "../sim/index";

/** Default overlay opacity, used by the strain heat map. */
export const DEFAULT_OVERLAY_ALPHA = 0.42;
/** Alpha of the exudate layer (the strain heat map keeps the renderer default). */
export const EXUDATE_OVERLAY_ALPHA = 0.62;
/** Contrast applied to the normalised overlay before it becomes a byte. */
export const OVERLAY_GAMMA = 0.5;

const LUT_SIZE = 1024;
const GAMMA_LUT = (() => {
  const lut = new Uint8Array(LUT_SIZE);
  for (let i = 0; i < LUT_SIZE; i++) {
    lut[i] = Math.round(Math.pow(i / (LUT_SIZE - 1), OVERLAY_GAMMA) * 255);
  }
  return lut;
})();

/**
 * Map a normalised 0–1 overlay value to its byte. The gamma is applied here,
 * before quantisation, so a cell at 2 % of the maximum stays visible (36/255
 * instead of 5/255) without a per-cell pow on a large plate.
 */
export function overlayByte(v: number): number {
  const clamped = v < 0 ? 0 : v > 1 ? 1 : v;
  return GAMMA_LUT[Math.round(clamped * (LUT_SIZE - 1))]!;
}

export interface OverlayStats {
  /** Largest value in the source field. */
  max: number;
  /** Cells holding a positive value. */
  producers: number;
}

/**
 * Copy `src` into `out` normalised by its own maximum (all zeros when the
 * field is empty). Returns the statistics the plate note displays.
 */
export function normalizeOverlay(src: Float32Array, out: Float32Array): OverlayStats {
  const n = Math.min(src.length, out.length);
  let max = 0;
  let producers = 0;
  for (let i = 0; i < n; i++) {
    const v = src[i]!;
    if (v > max) max = v;
    if (v > 0) producers++;
  }
  const scale = max > 0 ? 1 / max : 0;
  for (let i = 0; i < n; i++) out[i] = src[i]! * scale;
  for (let i = n; i < out.length; i++) out[i] = 0;
  return { max, producers };
}

/**
 * One line describing the exudate layer, so a faint plate is never ambiguous:
 * it either holds exudate (with its magnitude) or it does not.
 */
export function describeExudate(world: World): string {
  const field = world.fields.exudate;
  let max = 0;
  let total = 0;
  let cells = 0;
  for (let i = 0; i < field.length; i++) {
    const v = field[i]!;
    if (v > max) max = v;
    if (v > 0) {
      total += v;
      cells++;
    }
  }
  if (max <= 0) return "aucun exsudat : aucun phototrophe productif";
  // Cells the overlay actually lights up (above 1 % of the peak), not every
  // cell that holds a trace from diffusion.
  let visible = 0;
  const floor = max * 0.01;
  for (let i = 0; i < field.length; i++) if (field[i]! > floor) visible++;
  const producers = world.lastExudate;
  return `${producers} producteur${producers > 1 ? "s" : ""} · ${visible} cellule${visible > 1 ? "s" : ""} éclairée${visible > 1 ? "s" : ""} · max ${max.toFixed(3)} · total ${total.toFixed(2)}`;
}
