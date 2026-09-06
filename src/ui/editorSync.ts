/**
 * Genome editor vs live inspect. rAF may refresh the inspect panel while a
 * selection exists; it must not clobber the editor, and point/indel/dup/apply
 * and load-founder+inject cannot stick.
 *
 * - "select": the user inspected an organism — the editor loads its genome.
 * - "peek":   an organism was selected as a side effect (e.g. clicking an
 *             occupied cell with the Place tool) — the editor keeps its edits.
 * - "refresh": rAF re-render of live numbers only.
 * - "apply":  the editor genome was written to the organism.
 */
export type EditorSyncReason = "select" | "peek" | "refresh" | "apply" | "clear";

export function shouldWriteEditor(reason: EditorSyncReason): boolean {
  return reason === "select" || reason === "apply";
}
