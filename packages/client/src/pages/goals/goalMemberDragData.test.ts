import { describe, expect, it, vi } from "vitest";
import { GOAL_MEMBER_DRAG_MIME, readDragRef, writeDragRef } from "./goalMemberDragData.js";

function fakeDataTransfer(initial: Record<string, string> = {}) {
  const store: Record<string, string> = { ...initial };
  return {
    effectAllowed: "",
    setData: vi.fn((type: string, value: string) => {
      store[type] = value;
    }),
    getData: (type: string) => store[type] ?? "",
  };
}

describe("goalMemberDragData", () => {
  it("round-trips a member ref through dataTransfer", () => {
    const dataTransfer = fakeDataTransfer();

    writeDragRef(dataTransfer as unknown as DataTransfer, { kind: "task", id: "a" });

    expect(dataTransfer.setData).toHaveBeenCalledWith(GOAL_MEMBER_DRAG_MIME, JSON.stringify({ kind: "task", id: "a" }));
    expect(dataTransfer.effectAllowed).toBe("copy");
    expect(readDragRef(dataTransfer as unknown as DataTransfer)).toEqual({ kind: "task", id: "a" });
  });

  it("returns null for empty or malformed payloads", () => {
    expect(readDragRef(fakeDataTransfer() as unknown as DataTransfer)).toBeNull();
    expect(readDragRef(fakeDataTransfer({ [GOAL_MEMBER_DRAG_MIME]: "not json" }) as unknown as DataTransfer)).toBeNull();
    expect(readDragRef(fakeDataTransfer({ [GOAL_MEMBER_DRAG_MIME]: '{"kind":"goal","id":"x"}' }) as unknown as DataTransfer)).toBeNull();
    expect(readDragRef(fakeDataTransfer({ [GOAL_MEMBER_DRAG_MIME]: '{"kind":"task","id":""}' }) as unknown as DataTransfer)).toBeNull();
  });
});
