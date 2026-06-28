import { describe, expect, it } from "vitest";
import {
  chooseEdgeHandleSides,
  intersectBorder,
  floatingEdgeGeometry,
  ZERO_ROUTING,
  BASE_BOW,
  type EdgeHandleChoice,
  type HandleBox,
  type NodeGeom,
} from "./goalEdgeRouting.js";

const box = (x: number, y: number, width = 120, height = 48): HandleBox => ({ x, y, width, height });
const geom = (x: number, y: number, width = 120, height = 48): NodeGeom => ({ x, y, width, height });

describe("chooseEdgeHandleSides", () => {
  describe("无障碍时退化为现状选口（按相对位置选最近的一对口）", () => {
    it.each<[string, HandleBox, HandleBox, EdgeHandleChoice]>([
      ["水平向右 → right/left", box(0, 0), box(320, 0), { source: "right", target: "left" }],
      ["水平向左 → left/right", box(320, 0), box(0, 0), { source: "left", target: "right" }],
      ["垂直向下 → bottom/top", box(0, 0), box(0, 320), { source: "bottom", target: "top" }],
      ["垂直向上 → top/bottom", box(0, 320), box(0, 0), { source: "top", target: "bottom" }],
    ])("%s", (_name, source, target, expected) => {
      expect(chooseEdgeHandleSides(source, target, [])).toEqual(expected);
    });
  });

  describe("现状直连被障碍挡住时换口绕开", () => {
    it("水平直连被居中偏下障碍挡住 → 两端改走 top 从上方绕", () => {
      const obstacle = box(160, 30, 80, 80);
      expect(chooseEdgeHandleSides(box(0, 0), box(320, 0), [obstacle])).toEqual({ source: "top", target: "top" });
    });
  });

  describe("边界与稳定性", () => {
    it("障碍不在直连路径上时保持现状选口（不无谓改线）", () => {
      const farObstacle = box(160, 200, 80, 80);
      expect(chooseEdgeHandleSides(box(0, 0), box(320, 0), [farObstacle])).toEqual({
        source: "right",
        target: "left",
      });
    });

    it("绕开一侧障碍又会顶到另一障碍时，选穿到最少的那侧", () => {
      // 障碍盖住 y=0(挡 right/left) 和 y=-24(挡 top)，但 y=24(bottom) 是空的
      const obstacle = box(160, -10, 80, 40);
      expect(chooseEdgeHandleSides(box(0, 0), box(320, 0), [obstacle])).toEqual({
        source: "bottom",
        target: "bottom",
      });
    });

    it("被大障碍整片罩住(无干净解)时不崩，退回最短的一对口", () => {
      const blob = box(160, 0, 400, 400);
      expect(chooseEdgeHandleSides(box(0, 0), box(320, 0), [blob])).toEqual({
        source: "right",
        target: "left",
      });
    });
  });
});

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
