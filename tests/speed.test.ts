import { describe, expect, it } from "vitest";
import { formatSpeed, ticksDue } from "../src/ui/speed";

describe("speed slider → sim ticks", () => {
  it("0 ticks/s yields no steps (pause)", () => {
    expect(ticksDue(0, 16, 0, 24).ticks).toBe(0);
    expect(formatSpeed(0)).toBe("pause");
  });

  it("2 ticks/s waits ~500ms per step so the plate is watchable", () => {
    const a = ticksDue(0, 16, 2, 24);
    expect(a.ticks).toBe(0);
    expect(a.accumMs).toBe(16);
    const b = ticksDue(a.accumMs, 500, 2, 24);
    expect(b.ticks).toBe(1);
    const c = ticksDue(0, 1000, 2, 24);
    expect(c.ticks).toBe(2);
  });

  it("old 1×-per-frame rate (~60/s) is still reachable at the slider max", () => {
    const r = ticksDue(0, 16.67, 60, 24);
    expect(r.ticks).toBe(1);
  });
});
