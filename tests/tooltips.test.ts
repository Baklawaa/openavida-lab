import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CONTROL_HELP, LAB_CONTROL_IDS, attachControlHelp } from "../src/ui/help";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appSrc = readFileSync(resolve(root, "src/app.ts"), "utf8");

describe("control help catalog", () => {
  it("covers every labeled lab control with a non-empty explanation", () => {
    expect(LAB_CONTROL_IDS.length).toBeGreaterThan(30);
    expect(appSrc).toContain("attachControlHelp");
    for (const id of LAB_CONTROL_IDS) {
      const text = CONTROL_HELP[id];
      expect(text, id).toBeTruthy();
      expect(text!.trim().length, id).toBeGreaterThan(12);
      const token = id.startsWith("brush-")
        ? id.slice("brush-".length)
        : id.startsWith("kit-")
          ? id.slice("kit-".length)
          : id;
      expect(appSrc.includes(id) || appSrc.includes(token), `UI references ${id}`).toBe(true);
    }
  });

  it("attachControlHelp writes title + data-help from the same catalog", () => {
    const want = ["btn-pause", "btn-inject", "zoom-top"];
    const store = new Map<string, Record<string, string>>();
    const fakeRoot = {
      querySelector(sel: string) {
        const id = sel.startsWith("#") ? sel.slice(1) : sel;
        if (!want.includes(id)) return null;
        const attrs: Record<string, string> = {};
        store.set(id, attrs);
        return {
          setAttribute(name: string, value: string) {
            attrs[name] = value;
          },
        };
      },
      addEventListener() {},
    };
    const attached = attachControlHelp(fakeRoot as unknown as ParentNode, { hidden: true } as HTMLElement);
    expect(attached).toBe(3);
    for (const id of want) {
      expect(store.get(id)?.title).toBe(CONTROL_HELP[id]);
      expect(store.get(id)?.["data-help"]).toBe(CONTROL_HELP[id]);
    }
  });
});
