import { describe, expect, it } from "vitest";
import {
  goalCanvasFromPin,
  goalPinFromCanvas,
  memberCanvasFromPin,
  memberPinFromCanvas,
} from "./goalLayoutCoords.js";

describe("goalLayoutCoords", () => {
  it("goal pin is already world/canvas coordinates", () => {
    expect(goalCanvasFromPin({ x: 120, y: -40 })).toEqual({ x: 120, y: -40 });
    expect(goalPinFromCanvas({ x: 120, y: -40 })).toEqual({ x: 120, y: -40 });
  });

  it("member pin stores an offset relative to the goal anchor", () => {
    const anchor = { x: 100, y: 200 };

    expect(memberCanvasFromPin({ x: 30, y: -10 }, anchor)).toEqual({ x: 130, y: 190 });
    expect(memberPinFromCanvas({ x: 130, y: 190 }, anchor)).toEqual({ x: 30, y: -10 });
  });
});
