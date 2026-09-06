import { describe, expect, it } from "vitest";
import {
  RECIPE_QUERY_MAX,
  World,
  applyRecipe,
  buildRecipeShareURL,
  founderHeterotroph,
  founderPhototroph,
  parseRecipe,
  placeOrganismAt,
  recipeFromQuery,
  recipeFromWorld,
  recipeToQuery,
  type Recipe,
} from "../src/sim/index";

describe("recipes", () => {
  it("record then replay reproduces hashState for the same seed", () => {
    const w = new World({ width: 32, height: 32, seed: 7, startPopulation: 0 });
    expect(w.recording).toEqual([]);
    w.paint(5, 6, 2, "nutrientVent");
    w.paint(8, 8, 1, "nutrientBlob", 0.9);
    w.defineStrain(founderHeterotroph(), { name: "Hétéro", manual: true });
    w.injectStrain(founderHeterotroph(), 6, 10, 10);
    placeOrganismAt(w, 4, 4, founderPhototroph());
    for (let i = 0; i < 12; i++) w.step();
    const steps = w.recording!.filter((o) => o.type === "step");
    expect(steps).toHaveLength(1);
    expect(steps[0]).toEqual({ type: "step", n: 12 });
    expect(w.recording!.some((o) => o.type === "inject")).toBe(true);
    expect(w.recording!.filter((o) => o.type === "place")).toHaveLength(1);
    const recipe = recipeFromWorld(w);
    const copy = applyRecipe(recipe);
    expect(copy.hashState()).toBe(w.hashState());
    expect(copy.tick).toBe(w.tick);
    expect(copy.organisms.length).toBe(w.organisms.length);
  });

  it("query encoding round-trips", () => {
    const recipe: Recipe = {
      version: 1,
      params: new World({ width: 16, height: 16, seed: 99 }).params,
      ops: [
        { type: "paint", x: 2, y: 3, radius: 1, brush: "toxinVent" },
        { type: "place", x: 4, y: 5, genome: founderPhototroph() },
        { type: "step", n: 3 },
      ],
    };
    const q = recipeToQuery(recipe);
    expect(q.startsWith("recipe=")).toBe(true);
    expect(q.slice("recipe=".length)).not.toMatch(/[+/=]/);
    const back = recipeFromQuery(q);
    expect(back).toEqual(recipe);
    expect(recipeFromQuery("https://openavida.lab/?" + q + "#x")).toEqual(recipe);
    expect(parseRecipe({ version: 1, params: recipe.params, ops: recipe.ops })).toEqual(recipe);
    expect(recipeFromQuery("seed=1")).toBeNull();
  });

  it("falls back to a params-only URL when the encoded recipe exceeds 6000 characters", () => {
    const ops = Array.from({ length: 40 }, (_, i) => ({
      type: "place" as const,
      x: i % 16,
      y: 1,
      genome: "ATGC".repeat(80),
    }));
    const recipe: Recipe = {
      version: 1,
      params: new World({ seed: 42, width: 16, height: 16 }).params,
      ops,
    };
    expect(recipeToQuery(recipe).length).toBeGreaterThan(RECIPE_QUERY_MAX);
    const { url, truncated } = buildRecipeShareURL(recipe, "https://openavida.lab", "/");
    expect(truncated).toBe(true);
    expect(url).not.toContain("recipe=");
    expect(url).toContain("seed=42");
    const small: Recipe = { version: 1, params: recipe.params, ops: [{ type: "step", n: 2 }] };
    const short = buildRecipeShareURL(small, "https://openavida.lab", "/");
    expect(short.truncated).toBe(false);
    expect(short.url).toContain("recipe=");
    expect(recipeFromQuery(short.url)?.ops).toEqual(small.ops);
  });
});
