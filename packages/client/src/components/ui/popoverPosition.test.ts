import { describe, expect, it } from "vitest";
import { computePopoverPosition } from "./popoverPosition.js";

describe("computePopoverPosition", () => {
  it("优先放在锚点下方，间距为 6", () => {
    expect(
      computePopoverPosition(
        { left: 80, top: 40, right: 140, bottom: 70, width: 60, height: 30 },
        { width: 120, height: 90 },
        { width: 400, height: 300 },
      ),
    ).toEqual({ left: 80, top: 76 });
  });

  it("下方空间不足时翻到上方", () => {
    expect(
      computePopoverPosition(
        { left: 80, top: 210, right: 140, bottom: 240, width: 60, height: 30 },
        { width: 120, height: 90 },
        { width: 400, height: 300 },
      ),
    ).toEqual({ left: 80, top: 114 });
  });

  it("右侧溢出时向左夹住在视口内", () => {
    expect(
      computePopoverPosition(
        { left: 270, top: 40, right: 310, bottom: 70, width: 40, height: 30 },
        { width: 120, height: 90 },
        { width: 320, height: 300 },
      ),
    ).toEqual({ left: 194, top: 76 });
  });

  it("左侧也不会越过视口间距", () => {
    expect(
      computePopoverPosition(
        { left: -20, top: 40, right: 40, bottom: 70, width: 60, height: 30 },
        { width: 120, height: 90 },
        { width: 320, height: 300 },
      ),
    ).toEqual({ left: 6, top: 76 });
  });
});
