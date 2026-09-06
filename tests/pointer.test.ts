import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyTool, pointerAction } from "../src/ui/pointer";

const appSrc = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../src/app.ts"), "utf8");

describe("plate pointer action", () => {
  it("after paint then kit-select (place) the next click places, it does not paint", () => {
    let s = applyTool("paint");
    expect(s.paintMode).toBe(true);
    expect(
      pointerAction({ tool: s.tool, paintMode: s.paintMode, shiftKey: false, altKey: false, buttons: 1 }),
    ).toBe("paint");

    s = applyTool("place");
    expect(s.tool).toBe("place");
    expect(s.paintMode).toBe(false);
    expect(
      pointerAction({ tool: s.tool, paintMode: s.paintMode, shiftKey: false, altKey: false, buttons: 1 }),
    ).toBe("place");
    expect(appSrc).toContain("pointerAction");
    expect(appSrc).toContain("selectKit");
    expect(appSrc).toContain('applyTool(tool)');
  });

  it("shift still paints while the place tool is active", () => {
    const s = applyTool("place");
    expect(
      pointerAction({ tool: s.tool, paintMode: s.paintMode, shiftKey: true, altKey: false, buttons: 1 }),
    ).toBe("paint");
  });
});
