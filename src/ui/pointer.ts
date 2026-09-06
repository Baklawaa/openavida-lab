/** Click on the plate: paint substance, place one organism, or inspect. */

export type LabTool = "inspect" | "paint" | "place";
export type PointerAction = "paint" | "place" | "inspect";

export function applyTool(tool: LabTool): { tool: LabTool; paintMode: boolean } {
  return { tool, paintMode: tool === "paint" };
}

/**
 * Kit-select must go through applyTool("place") so paintMode is cleared.
 * Shift / Alt / right-button still paint as a shortcut.
 */
export function pointerAction(args: {
  tool: LabTool;
  paintMode: boolean;
  shiftKey: boolean;
  altKey: boolean;
  buttons: number;
}): PointerAction {
  if (args.shiftKey || args.altKey || args.buttons === 2) return "paint";
  if (args.tool === "paint" || args.paintMode) return "paint";
  if (args.tool === "place") return "place";
  return "inspect";
}
