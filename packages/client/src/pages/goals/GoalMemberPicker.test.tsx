// @vitest-environment jsdom
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Task, Track } from "@timedata/shared";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import type { GoalMember } from "../../lib/goalsView.js";
import { GoalMemberPicker } from "./GoalMemberPicker.js";

const task = { id: "task-1", title: "任务", goalId: null } as Task;
const track = { id: "track-1", title: "轨道", goalId: null } as Track;

describe("GoalMemberPicker", () => {
  it("shows unassigned task/track selectors and member remove buttons", async () => {
    const onAssignTask = vi.fn();
    const onAssignTrack = vi.fn();
    const onRemoveMember = vi.fn();
    const member = { kind: "task", id: "member-1", title: "已有任务", completed: false, activityAt: "2026-06-22T00:00:00.000Z", source: task } satisfies GoalMember;
    const { host, root } = await renderDom(
      createElement(GoalMemberPicker, {
        goalId: "goal-1",
        tasks: [task],
        tracks: [track],
        members: [member],
        onAssignTask,
        onAssignTrack,
        onRemoveMember,
      }),
    );

    expect(host.querySelector('button[aria-label="添加任务成员"]')).not.toBeNull();
    expect(host.querySelector('button[aria-label="添加轨道成员"]')).not.toBeNull();
    await click(host.querySelector('button[aria-label="移出目标 已有任务"]'));
    expect(onRemoveMember).toHaveBeenCalledWith("task", "member-1");
    await unmount(root);
  });
});
