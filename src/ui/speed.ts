/** How many sim ticks to run this frame. ticksPerSec=0 pauses. */
export function ticksDue(
  accumMs: number,
  dtMs: number,
  ticksPerSec: number,
  maxTicks: number,
): { ticks: number; accumMs: number } {
  if (!(ticksPerSec > 0) || dtMs < 0) return { ticks: 0, accumMs: 0 };
  const interval = 1000 / ticksPerSec;
  let accum = accumMs + dtMs;
  let ticks = 0;
  const cap = Math.max(0, maxTicks);
  while (accum >= interval && ticks < cap) {
    accum -= interval;
    ticks++;
  }
  if (ticks === cap && accum > interval * 4) accum = interval * 4;
  return { ticks, accumMs: accum };
}

export function formatSpeed(ticksPerSec: number): string {
  if (ticksPerSec <= 0) return "pause";
  if (ticksPerSec < 1) return `${ticksPerSec.toFixed(1)} /s`;
  return `${Math.round(ticksPerSec)} /s`;
}
