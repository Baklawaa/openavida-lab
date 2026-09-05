import { describe, expect, it } from "vitest";
import { viewCrop } from "../src/ui/camera";

describe("plate camera", () => {
  it("zoom 1 shows the whole plate and does not depend on organisms", () => {
    expect(viewCrop(1)).toEqual([0, 0, 1, 1]);
  });

  it("zoom stays centered — no jump to a dense cluster", () => {
    const c = viewCrop(0.5);
    expect(c[0]).toBeCloseTo(0.25);
    expect(c[1]).toBeCloseTo(0.25);
    expect(c[2]).toBeCloseTo(0.75);
    expect(c[3]).toBeCloseTo(0.75);
  });
});
