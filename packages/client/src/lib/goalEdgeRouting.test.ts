import { describe, expect, it } from "vitest";
import {
  intersectBorder,
  floatingEdgeGeometry,
  computeEdgeRoutings,
  ZERO_ROUTING,
  BASE_BOW,
  SHIFT,
  MAX_BOW,
  type NodeGeom,
} from "./goalEdgeRouting.js";

const geom = (x: number, y: number, width = 120, height = 48): NodeGeom => ({ x, y, width, height });
const pre = (id: string, source: string, target: string) => ({ id, source, target, kind: "prerequisite" });

describe("intersectBorder", () => {
  it("正右方射线交右边框中点", () => {
    expect(intersectBorder({ x: 0, y: 0 }, 60, 24, { x: 300, y: 0 })).toEqual({ x: 60, y: 0 });
  });
  it("正下方射线交下边框中点", () => {
    expect(intersectBorder({ x: 0, y: 0 }, 60, 24, { x: 0, y: 300 })).toEqual({ x: 0, y: 24 });
  });
  it("斜向射线被较矮的上下边框先截住", () => {
    expect(intersectBorder({ x: 0, y: 0 }, 60, 24, { x: 100, y: 100 })).toEqual({ x: 24, y: 24 });
  });
  it("目标与中心重合时退化为中心，不抛错", () => {
    expect(intersectBorder({ x: 5, y: 5 }, 60, 24, { x: 5, y: 5 })).toEqual({ x: 5, y: 5 });
  });
});

describe("floatingEdgeGeometry", () => {
  it("零 routing 时端点落在两端边框、路径为共线(近直线)", () => {
    const g = floatingEdgeGeometry(geom(0, 0), geom(300, 0), ZERO_ROUTING);
    expect(g.sx).toBe(60);
    expect(g.tx).toBe(240);
    expect(g.path).toBe("M60,0 C105,0 195,0 240,0");
  });
  it("bow>0 时控制点沿法向偏移形成弧(末端切线偏离水平)", () => {
    const g = floatingEdgeGeometry(geom(0, 0), geom(300, 0), {
      bow: BASE_BOW,
      bowSide: 1,
      sourceShift: 0,
      targetShift: 0,
    });
    expect(g.path).toBe("M60,0 C105,14 195,14 240,0");
  });
  it("sourceShift/targetShift 沿法向把入出端点推到两侧", () => {
    const g = floatingEdgeGeometry(geom(0, 0), geom(300, 0), {
      bow: 0,
      bowSide: 1,
      sourceShift: 7,
      targetShift: -7,
    });
    expect(g.sy).toBe(7);
    expect(g.ty).toBe(-7);
  });
});

describe("computeEdgeRoutings — 绕障(鼓包方向与强度)", () => {
  const nodes = (entries: Array<[string, NodeGeom]>) => new Map(entries);

  it("无障碍 → baseBow 统一微弧、固定侧、零错开", () => {
    const map = nodes([
      ["a", { x: 0, y: 0, width: 120, height: 48 }],
      ["b", { x: 320, y: 0, width: 120, height: 48 }],
    ]);
    const r = computeEdgeRoutings([pre("e", "a", "b")], map).get("e");
    expect(r).toEqual({ bow: BASE_BOW, bowSide: 1, sourceShift: 0, targetShift: 0 });
  });

  it("水平直连被居中偏下障碍挡住 → 向上鼓(bowSide=-1)、bow 加大", () => {
    const map = nodes([
      ["a", { x: 0, y: 0, width: 120, height: 48 }],
      ["b", { x: 320, y: 0, width: 120, height: 48 }],
      ["o", { x: 160, y: 30, width: 80, height: 80 }],
    ]);
    const r = computeEdgeRoutings([pre("e", "a", "b")], map).get("e");
    expect(r?.bowSide).toBe(-1);
    expect(r?.bow).toBeGreaterThan(BASE_BOW);
    expect(r?.bow).toBeLessThanOrEqual(MAX_BOW);
  });

  it("障碍不在直连路径上 → 保持 baseBow 不额外避让", () => {
    const map = nodes([
      ["a", { x: 0, y: 0, width: 120, height: 48 }],
      ["b", { x: 320, y: 0, width: 120, height: 48 }],
      ["o", { x: 160, y: 200, width: 80, height: 80 }],
    ]);
    const r = computeEdgeRoutings([pre("e", "a", "b")], map).get("e");
    expect(r?.bow).toBe(BASE_BOW);
  });

  it("上方被挡、下方空 → 向下鼓(bowSide=1)", () => {
    const map = nodes([
      ["a", { x: 0, y: 0, width: 120, height: 48 }],
      ["b", { x: 320, y: 0, width: 120, height: 48 }],
      ["o", { x: 160, y: -10, width: 80, height: 40 }],
    ]);
    const r = computeEdgeRoutings([pre("e", "a", "b")], map).get("e");
    expect(r?.bowSide).toBe(1);
    expect(r?.bow).toBeGreaterThan(BASE_BOW);
  });

  it("大障碍整片罩住(无干净解) → bow 封顶、不抛错", () => {
    const map = nodes([
      ["a", { x: 0, y: 0, width: 120, height: 48 }],
      ["b", { x: 320, y: 0, width: 120, height: 48 }],
      ["o", { x: 160, y: 0, width: 400, height: 400 }],
    ]);
    const r = computeEdgeRoutings([pre("e", "a", "b")], map).get("e");
    expect(r?.bow).toBeLessThanOrEqual(MAX_BOW);
  });

  it("tether 边 → 零 routing(无弧)", () => {
    const map = nodes([
      ["g", { x: 0, y: 0, width: 144, height: 144 }],
      ["a", { x: 200, y: 0, width: 120, height: 48 }],
    ]);
    const r = computeEdgeRoutings([{ id: "t", source: "g", target: "a", kind: "tether" }], map).get("t");
    expect(r).toEqual({ bow: 0, bowSide: 1, sourceShift: 0, targetShift: 0 });
  });
});

describe("computeEdgeRoutings — 入出端点错开", () => {
  it("同节点一进一出且方向接近 → 按角色把两端推到两侧", () => {
    const map = new Map<string, NodeGeom>([
      ["A", { x: 0, y: 0, width: 120, height: 48 }],
      ["B", { x: 300, y: 0, width: 120, height: 48 }],
      ["C", { x: 300, y: 6, width: 120, height: 48 }],
    ]);
    const routings = computeEdgeRoutings(
      [pre("out", "A", "B"), pre("in", "C", "A")],
      map,
    );
    expect(routings.get("out")?.sourceShift).toBe(-SHIFT); // A 是 out 边的 source
    expect(routings.get("in")?.targetShift).toBe(SHIFT); // A 是 in 边的 target
  });
});