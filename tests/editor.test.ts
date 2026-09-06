import { describe, expect, it } from "vitest";
import { decodeGenome, pointMutate, World } from "../src/sim/index";
import { Rng } from "../src/sim/rng";
import { shouldWriteEditor } from "../src/ui/editorSync";

describe("genome editor vs rAF inspect refresh", () => {
  it("refresh and peek must not write the editor; select and apply may", () => {
    expect(shouldWriteEditor("refresh")).toBe(false);
    expect(shouldWriteEditor("select")).toBe(true);
    expect(shouldWriteEditor("apply")).toBe(true);
    expect(shouldWriteEditor("clear")).toBe(false);
    expect(shouldWriteEditor("peek")).toBe(false);
  });

  it("point-mutate then replaceGenome (apply) changes the selected organism", () => {
    const w = new World({ width: 16, height: 16, startPopulation: 8, seed: 17 });
    const org = w.organisms[0]!;
    const id = org.id;
    const original = org.genome;
    const edited = pointMutate(original, new Rng(3));
    expect(edited).not.toBe(original);
    expect(w.replaceGenome(id, edited)).toBe(true);
    const after = w.organisms.find((o) => o.id === id);
    expect(after).toBeTruthy();
    expect(after!.genome).toBe(decodeGenome(edited).sequence);
    expect(after!.genome).not.toBe(original);
  });
});
