export type RowClickZone = "expand" | "open";

const MAX_EXPAND_WIDTH = 240;

export function rowClickZone(offsetX: number, width: number, hasSubtasks: boolean): RowClickZone {
  if (!hasSubtasks) return "open";
  const expandWidth = Math.min((width * 2) / 5, MAX_EXPAND_WIDTH);
  return offsetX < expandWidth ? "expand" : "open";
}
