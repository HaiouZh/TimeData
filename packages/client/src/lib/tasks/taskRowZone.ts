export type RowClickZone = "expand" | "open";

export function rowClickZone(offsetX: number, width: number, hasSubtasks: boolean): RowClickZone {
  if (!hasSubtasks) return "open";
  return offsetX < (width * 2) / 5 ? "expand" : "open";
}
