/**
 * Genome editor vs live inspect. rAF may refresh the inspect panel while a
 * selection exists; it must not clobber #genome-edit or point/indel/dup/apply
 * and load-founder+inject cannot stick.
 */
export type EditorSyncReason = "select" | "refresh" | "apply" | "clear";

export function shouldWriteEditor(reason: EditorSyncReason): boolean {
  return reason === "select" || reason === "apply";
}

export function syncGenomeEditor(
  editor: { value: string },
  sequence: string,
  reason: EditorSyncReason,
): boolean {
  if (!shouldWriteEditor(reason)) return false;
  editor.value = sequence;
  return true;
}
