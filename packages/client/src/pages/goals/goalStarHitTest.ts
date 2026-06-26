import type { XY } from "../../lib/goalGalaxyLayout.js";

export interface GoalStarHitTarget {
  goalId: string;
  center: XY;
  width: number;
  height: number;
}

export function hitTestGoalStar(flowPos: XY, stars: readonly GoalStarHitTarget[]): string | null {
  let nearest: { goalId: string; distanceSquared: number } | null = null;

  for (const star of stars) {
    if (star.width <= 0 || star.height <= 0) continue;
    const halfWidth = star.width / 2;
    const halfHeight = star.height / 2;
    const inside =
      flowPos.x >= star.center.x - halfWidth &&
      flowPos.x <= star.center.x + halfWidth &&
      flowPos.y >= star.center.y - halfHeight &&
      flowPos.y <= star.center.y + halfHeight;
    if (!inside) continue;

    const dx = flowPos.x - star.center.x;
    const dy = flowPos.y - star.center.y;
    const distanceSquared = dx * dx + dy * dy;
    if (!nearest || distanceSquared < nearest.distanceSquared) {
      nearest = { goalId: star.goalId, distanceSquared };
    }
  }

  return nearest?.goalId ?? null;
}
