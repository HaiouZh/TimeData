import { describe, expect, it } from "vitest";
import { rowToTaskRelation, taskRelationToRow } from "./task-relation-rows.js";

describe("task-relation-rows", () => {
  it("实体转行：camelCase → snake_case，且不含 updated_at", () => {
    expect(
      taskRelationToRow({
        blockerKind: "task",
        blockerId: "a",
        blockedKind: "track",
        blockedId: "b",
        type: "blocks",
        createdAt: "2026-08-15T00:00:00.000Z",
        updatedAt: "2026-08-15T01:00:00.000Z",
      }),
    ).toEqual({
      blocker_kind: "task",
      blocker_id: "a",
      blocked_kind: "track",
      blocked_id: "b",
      type: "blocks",
      created_at: "2026-08-15T00:00:00.000Z",
    });
  });

  it("行转实体：snake_case → camelCase", () => {
    expect(
      rowToTaskRelation({
        blocker_kind: "task",
        blocker_id: "a",
        blocked_kind: "task",
        blocked_id: "b",
        type: "blocks",
        created_at: "2026-08-15T00:00:00.000Z",
        updated_at: "2026-08-15T01:00:00.000Z",
      }),
    ).toEqual({
      blockerKind: "task",
      blockerId: "a",
      blockedKind: "task",
      blockedId: "b",
      type: "blocks",
      createdAt: "2026-08-15T00:00:00.000Z",
      updatedAt: "2026-08-15T01:00:00.000Z",
    });
  });

  it("行转实体会走 schema 校验：自反关系被拒", () => {
    expect(() =>
      rowToTaskRelation({
        blocker_kind: "task",
        blocker_id: "a",
        blocked_kind: "task",
        blocked_id: "a",
        type: "blocks",
        created_at: "2026-08-15T00:00:00.000Z",
        updated_at: "2026-08-15T01:00:00.000Z",
      }),
    ).toThrow();
  });
});
