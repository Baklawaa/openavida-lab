/** Zoom 1 = whole plate. Never follows organisms — that camera jump feels like teleporting. */
export function viewCrop(zoom: number): [number, number, number, number] {
  const z = Math.max(0.3, Math.min(1, zoom));
  const m = (1 - z) / 2;
  return [m, m, m + z, m + z];
}
