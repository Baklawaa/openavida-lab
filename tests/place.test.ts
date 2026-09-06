import { describe, expect, it } from "vitest";
import {
  TERRAIN,
  World,
  decodeGenome,
  genomeForKit,
  paintTerrain,
  placeOrganismAt,
} from "../src/sim/index";

describe("place substances and organisms", () => {
  it("painting a named substance changes the intended cell/field", () => {
    const w = new World({ width: 16, height: 16, seed: 1 });
    expect(w.organisms.length).toBe(0);
    const i = 4 * 16 + 4;
    paintTerrain(w, 4, 4, 0, "barrier");
    expect(w.terrain[i]).toBe(TERRAIN.barrier);
    const n = 6 * 16 + 6;
    const before = w.fields.nutrient[n]!;
    paintTerrain(w, 6, 6, 1, "nutrientBlob", 0.8);
    expect(w.fields.nutrient[n]!).toBeGreaterThan(before);
    paintTerrain(w, 8, 8, 0, "toxinVent");
    expect(w.terrain[8 * 16 + 8]).toBe(TERRAIN.toxinVent);
  });

  it("placing one organism at (x,y) uses the chosen genome on that cell", () => {
    const w = new World({ width: 16, height: 16, seed: 3 });
    const g = decodeGenome(genomeForKit("phototroph")).sequence;
    const child = placeOrganismAt(w, 5, 7, g);
    expect(child).toBeTruthy();
    expect(w.organisms.length).toBe(1);
    expect(child!.x).toBe(5);
    expect(child!.y).toBe(7);
    expect(child!.genome).toBe(g);
    expect(w.organismAt(5, 7)?.id).toBe(child!.id);
    expect(placeOrganismAt(w, 5, 7, g)).toBeNull();
  });
});
