import { describe, expect, it } from "vitest";
import { chooseEdgeHandleSides, type EdgeHandleChoice, type HandleBox } from "./goalEdgeRouting.js";

const box = (x: number, y: number, width = 120, height = 48): HandleBox => ({ x, y, width, height });

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
