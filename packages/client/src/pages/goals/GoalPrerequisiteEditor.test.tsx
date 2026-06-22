// @vitest-environment jsdom
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Task } from "@timedata/shared";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import type { GoalMember } from "../../lib/goalsView.js";
import { GoalPrerequisiteEditor } from "./GoalPrerequisiteEditor.js";

const source = { id: "task-1", title: "任务" } as Task;
const members: GoalMember[] = [
  { kind: "task", id: "task-1", title: "写文案", completed: false, activityAt: "2026-06-22T00:00:00.000Z", source },
  { kind: "task", id: "task-2", title: "发布", completed: false, activityAt: "2026-06-22T00:00:00.000Z", source },
];

describe("GoalPrerequisiteEditor", () => {
  it("renders existing edges and removes them", async () => {
    const onChange = vi.fn();
    const { host, root } = await renderDom(
      createElement(GoalPrerequisiteEditor, {
        members,
        prerequisites: [{ blocker: "task-1", blocked: "task-2" }],
        onChange,
      }),
    );

    expect(host.textContent).toContain("写文案 -> 发布");
    await click(host.querySelector('button[aria-label="删除前置关系 写文案 到 发布"]'));
    expect(onChange).toHaveBeenCalledWith([]);
    await unmount(root);
  });
});
