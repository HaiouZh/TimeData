export type GoalGraphLod = "near" | "far";

export function lodFromZoom(zoom: number): GoalGraphLod {
  if (!Number.isFinite(zoom)) {
    return "near";
  }

  return zoom < 0.72 ? "far" : "near";
}
