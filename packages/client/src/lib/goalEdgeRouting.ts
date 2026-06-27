export type EdgeHandleSide = "left" | "right" | "top" | "bottom";

export interface HandleBox {
  /** 节点可视框中心（已折算 offset） */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EdgeHandleChoice {
  source: EdgeHandleSide;
  target: EdgeHandleSide;
}

interface Point {
  x: number;
  y: number;
}

interface Rect {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

const SIDES: readonly EdgeHandleSide[] = ["top", "right", "bottom", "left"];

/** 现状选口：只看两端相对位置，横向错开走左右口、纵向错开走上下口。 */
function baseSides(source: HandleBox, target: HandleBox): EdgeHandleChoice {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? { source: "right", target: "left" } : { source: "left", target: "right" };
  }
  return dy >= 0 ? { source: "bottom", target: "top" } : { source: "top", target: "bottom" };
}

function handlePoint(box: HandleBox, side: EdgeHandleSide): Point {
  switch (side) {
    case "left":
      return { x: box.x - box.width / 2, y: box.y };
    case "right":
      return { x: box.x + box.width / 2, y: box.y };
    case "top":
      return { x: box.x, y: box.y - box.height / 2 };
    case "bottom":
      return { x: box.x, y: box.y + box.height / 2 };
  }
}

function rectOf(box: HandleBox): Rect {
  return {
    minX: box.x - box.width / 2,
    maxX: box.x + box.width / 2,
    minY: box.y - box.height / 2,
    maxY: box.y + box.height / 2,
  };
}

/** 线段 a→b 是否与矩形相交（Liang–Barsky 裁剪，含穿过内部）。 */
function segmentHitsRect(a: Point, b: Point, rect: Rect): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const edges: Array<[number, number]> = [
    [-dx, a.x - rect.minX],
    [dx, rect.maxX - a.x],
    [-dy, a.y - rect.minY],
    [dy, rect.maxY - a.y],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false; // 平行于该边界且落在外侧
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }
  return t0 <= t1;
}

function crossings(a: Point, b: Point, obstacles: Rect[]): number {
  let count = 0;
  for (const rect of obstacles) {
    if (segmentHitsRect(a, b, rect)) count += 1;
  }
  return count;
}

function segLength(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * 为一条线选出入口：先看现状选口是否穿过别的节点；不穿就保持现状（不无谓改线），
 * 穿了就枚举四向口对，选穿到的节点最少、并列时线段最短的那对。
 */
export function chooseEdgeHandleSides(
  source: HandleBox,
  target: HandleBox,
  obstacles: HandleBox[],
): EdgeHandleChoice {
  const base = baseSides(source, target);
  if (obstacles.length === 0) return base;

  const rects = obstacles.map(rectOf);
  const baseHit = crossings(handlePoint(source, base.source), handlePoint(target, base.target), rects);
  if (baseHit === 0) return base;

  let best = base;
  let bestCrossings = baseHit;
  let bestLength = segLength(handlePoint(source, base.source), handlePoint(target, base.target));
  for (const s of SIDES) {
    for (const t of SIDES) {
      const a = handlePoint(source, s);
      const b = handlePoint(target, t);
      const c = crossings(a, b, rects);
      const len = segLength(a, b);
      if (c < bestCrossings || (c === bestCrossings && len < bestLength)) {
        best = { source: s, target: t };
        bestCrossings = c;
        bestLength = len;
      }
    }
  }
  return best;
}
