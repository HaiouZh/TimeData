import type { Goal } from "@timedata/shared";
import { describe, expect, it } from "vitest";
import { buildTrackProjectIndex, groupTracksByProject } from "./trackProjectIndex.js";

function goal(overrides: Partial<Goal> & Pick<Goal, "id" | "title">): Goal {
  return {
    kind: "project",
    status: "active",
    members: [],
    prerequisites: [],
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  } as Goal;
}

describe("buildTrackProjectIndex", () => {
  it("① kind=track 命中产出 name", () => {
    const g = goal({ id: "g1", title: "项目 Alpha", members: [{ kind: "track", id: "tr1" }] });
    const index = buildTrackProjectIndex([g]);
    expect(index.get("tr1")).toEqual({ goalId: "g1", name: "项目 Alpha" });
  });

  it("② 非 project / 非 active goal 不计", () => {
    const theme = goal({
      id: "g2",
      title: "主题",
      kind: "theme" as Goal["kind"],
      members: [{ kind: "track", id: "tr1" }],
    });
    const archived = goal({
      id: "g3",
      title: "归档项目",
      status: "archived" as Goal["status"],
      members: [{ kind: "track", id: "tr2" }],
    });
    const activeProject = goal({ id: "g4", title: "活跃项目", members: [{ kind: "track", id: "tr3" }] });
    const index = buildTrackProjectIndex([theme, archived, activeProject]);
    expect(index.has("tr1")).toBe(false);
    expect(index.has("tr2")).toBe(false);
    expect(index.get("tr3")).toEqual({ goalId: "g4", name: "活跃项目" });
  });

  it("③ 非法 ref 项跳过不炸", () => {
    const g = goal({
      id: "g1",
      title: "项目",
      members: [
        { kind: "task", id: "task1" } as unknown as Goal["members"][number],
        { kind: "track", id: "" } as unknown as Goal["members"][number],
        null as unknown as Goal["members"][number],
        { kind: "track", id: "tr-ok" },
        { kind: "track" } as unknown as Goal["members"][number],
      ],
    });
    const index = buildTrackProjectIndex([g as unknown as Goal]);
    expect(index.size).toBe(1);
    expect(index.get("tr-ok")).toEqual({ goalId: "g1", name: "项目" });
    expect(() => buildTrackProjectIndex([g as unknown as Goal])).not.toThrow();
  });

  it("④ 同轨道多项目取先到", () => {
    const g1 = goal({ id: "g1", title: "先到项目", members: [{ kind: "track", id: "tr1" }] });
    const g2 = goal({ id: "g2", title: "后到项目", members: [{ kind: "track", id: "tr1" }] });
    const index = buildTrackProjectIndex([g1, g2]);
    expect(index.get("tr1")).toEqual({ goalId: "g1", name: "先到项目" });
    const indexReverse = buildTrackProjectIndex([g2, g1]);
    expect(indexReverse.get("tr1")).toEqual({ goalId: "g2", name: "后到项目" });
  });

  it("空 members 与缺字段 goal 跳过", () => {
    const emptyMembers = goal({ id: "g1", title: "空", members: [] });
    const missing = { id: "g2", title: "缺字段", kind: "project", status: "active" } as unknown as Goal;
    const index = buildTrackProjectIndex([emptyMembers, missing]);
    expect(index.size).toBe(0);
  });
});

describe("groupTracksByProject", () => {
  it("空表 → 空 Map", () => {
    expect(groupTracksByProject(new Map()).size).toBe(0);
  });

  it("两轨道同组 + 一轨道另组 → 分组正确且序保持", () => {
    const projectIndex = new Map<string, { goalId: string; name: string }>([
      ["tr1", { goalId: "g1", name: "项目1" }],
      ["tr2", { goalId: "g1", name: "项目1" }],
      ["tr3", { goalId: "g2", name: "项目2" }],
    ]);
    const grouped = groupTracksByProject(projectIndex);
    expect(grouped.get("g1")).toEqual(["tr1", "tr2"]);
    expect(grouped.get("g2")).toEqual(["tr3"]);
    expect([...grouped.keys()]).toEqual(["g1", "g2"]);
  });

  it("保持 projectIndex 迭代序", () => {
    const projectIndex = new Map<string, { goalId: string; name: string }>([
      ["trB", { goalId: "g2", name: "项目2" }],
      ["trA", { goalId: "g1", name: "项目1" }],
      ["trC", { goalId: "g2", name: "项目2" }],
    ]);
    const grouped = groupTracksByProject(projectIndex);
    expect(grouped.get("g2")).toEqual(["trB", "trC"]);
    expect([...grouped.keys()]).toEqual(["g2", "g1"]);
  });
});
