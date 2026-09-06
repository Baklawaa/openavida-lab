import { describe, expect, it } from "vitest";
import {
  addBlock,
  blocksFromGenome,
  decodeGenome,
  genomeFromBlocks,
  moveBlock,
  removeBlock,
  setBlockStrength,
} from "../src/sim/index";

describe("visual gene-block builder", () => {
  it("assembles a genome whose phenotype tracks the blocks", () => {
    const photo = genomeFromBlocks([{ trait: "photo", strength: 6 }]);
    const eat = genomeFromBlocks([{ trait: "uptake", strength: 6 }]);
    const photoPh = decodeGenome(photo).phenotype;
    const eatPh = decodeGenome(eat).phenotype;
    expect(photoPh.photo).toBeGreaterThan(eatPh.photo);
    expect(eatPh.uptake).toBeGreaterThan(photoPh.uptake);
    const mixed = genomeFromBlocks([
      { trait: "photo", strength: 4 },
      { trait: "resist", strength: 5 },
    ]);
    const mixedPh = decodeGenome(mixed).phenotype;
    expect(mixedPh.resist).toBeGreaterThan(photoPh.resist);
    const round = blocksFromGenome(mixed);
    expect(round.length).toBeGreaterThanOrEqual(2);
    expect(round[0]!.trait).toBe("photo");
    expect(round.some((b) => b.trait === "resist")).toBe(true);
  });

  it("add / strength / move / remove keep a valid cassette list", () => {
    let blocks = addBlock([], "photo");
    blocks = addBlock(blocks, "resist");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.strength).toBe(3);
    blocks = setBlockStrength(blocks, 0, 8);
    expect(blocks[0]!.strength).toBe(8);
    blocks = setBlockStrength(blocks, 0, 99);
    expect(blocks[0]!.strength).toBe(8);
    blocks = setBlockStrength(blocks, 0, 0);
    expect(blocks[0]!.strength).toBe(1);
    blocks = moveBlock(blocks, 0, 1);
    expect(blocks[0]!.trait).toBe("resist");
    expect(blocks[1]!.trait).toBe("photo");
    blocks = removeBlock(blocks, 0);
    expect(blocks).toEqual([{ trait: "photo", strength: 1 }]);
    expect(decodeGenome(genomeFromBlocks(blocks)).genes.length).toBeGreaterThanOrEqual(1);
  });
});
