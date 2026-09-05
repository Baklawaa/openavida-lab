/** Seasonal light multiplier. World.step applies this so fitness keeps moving. */
export function seasonLight(tick: number): number {
  return 0.56 + 0.44 * Math.sin(tick * 0.085);
}

export const TOXIN_PULSE_EVERY = 64;
export const DROUGHT_EVERY = 88;
export const CRASH_EVERY = 120;
