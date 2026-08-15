import { describe, expect, it } from "vitest";
import { TaskRelationSchema } from "./entitySchemas.js";
import { decodeTaskRelationKey, encodeTaskRelationKey, taskRelationKey } from "./taskRelations.js";

describe("taskRelationKey", () => {
  it("编码后可无损解码", () => {
    const key = encodeTaskRelationKey("task", "a-1", "track", "b-2");
    expect(decodeTaskRelationKey(key)).toEqual({
      blockerKind: "task",
      blockerId: "a-1",
      blockedKind: "track",
      blockedId: "b-2",
    });
  });

  it("id 里含分隔符也能无损往返", () => {
    const key = encodeTaskRelationKey("task", "a|1", "task", "b|2");
    expect(decodeTaskRelationKey(key)).toEqual({
      blockerKind: "task",
      blockerId: "a|1",
      blockedKind: "task",
      blockedId: "b|2",
    });
  });

  it("taskRelationKey 与 encode 同结果", () => {
    expect(
      taskRelationKey({ blockerKind: "task", blockerId: "a", blockedKind: "task", blockedId: "b" }),
    ).toBe(encodeTaskRelationKey("task", "a", "task", "b"));
  });

  it("段数不对时抛错", () => {
    expect(() => decodeTaskRelationKey("task|a|track")).toThrow(/Invalid task relation key/);
  });

  it("kind 非法时抛错", () => {
    expect(() => decodeTaskRelationKey("note|a|task|b")).toThrow(/Invalid task relation kind/);
  });

  it("空段与纯空白段抛错", () => {
    expect(() => decodeTaskRelationKey("task||task|b")).toThrow(/Invalid task relation key/);
    expect(() => decodeTaskRelationKey("task|%20%20|task|b")).toThrow(/Invalid task relation key/);
  });
});

describe("TaskRelationSchema", () => {
  const base = {
    blockerKind: "task" as const,
    blockerId: "a",
    blockedKind: "task" as const,
    blockedId: "b",
    type: "blocks" as const,
    createdAt: "2026-08-15T00:00:00.000Z",
    updatedAt: "2026-08-15T00:00:00.000Z",
  };

  it("合法关系解析通过", () => {
    expect(TaskRelationSchema.safeParse(base).success).toBe(true);
  });

  it("type 缺省填 blocks", () => {
    const { type, ...withoutType } = base;
    const parsed = TaskRelationSchema.safeParse(withoutType);
    expect(parsed.success && parsed.data.type).toBe("blocks");
  });

  it("自己挡自己被拒", () => {
    expect(TaskRelationSchema.safeParse({ ...base, blockedId: "a" }).success).toBe(false);
  });

  it("同 id 但不同 kind 不算自反", () => {
    expect(
      TaskRelationSchema.safeParse({ ...base, blockedKind: "track", blockedId: "a" }).success,
    ).toBe(true);
  });
});
