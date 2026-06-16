export type RowClickZone = "expand" | "open";

const MAX_EXPAND_WIDTH = 140;

export function rowClickZone(offsetX: number, width: number, hasSubtasks: boolean): RowClickZone {
  if (!hasSubtasks) return "open";
  const expandWidth = Math.min(width / 3, MAX_EXPAND_WIDTH);
  return offsetX < expandWidth ? "expand" : "open";
}
