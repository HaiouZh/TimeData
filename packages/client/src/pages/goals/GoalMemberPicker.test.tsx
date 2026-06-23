// @vitest-environment jsdom
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import type { GoalMemberRef, Task, Track } from "@timedata/shared";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import type { GoalMember } from "../../lib/goalsView.js";
import { GoalMemberPicker } from "./GoalMemberPicker.js";

const task = { id: "task-1", title: "任务" } as Task;
const track = { id: "track-1", title: "轨道" } as Track;

describe("GoalMemberPicker", () => {
  it("shows selectable task/track candidates and removes members by typed ref", async () => {
    const onAddMember = vi.fn<(ref: GoalMemberRef) => void>();
    const onRemoveMember = vi.fn();
    const member = { kind: "task", id: "member-1", title: "已有任务", completed: false, activityAt: "2026-06-22T00:00:00.000Z", source: task } satisfies GoalMember;
    const { host, root } = await renderDom(
      createElement(GoalMemberPicker, {
        tasks: [task],
        tracks: [track],
        members: [member],
        onAddMember,
        onRemoveMember,
      }),
    );

    expect(host.querySelector('button[aria-label="添加任务成员"]')).not.toBeNull();
    expect(host.querySelector('button[aria-label="添加轨道成员"]')).not.toBeNull();
    await click(host.querySelector('button[aria-label="移出目标 已有任务"]'));
    expect(onRemoveMember).toHaveBeenCalledWith({ kind: "task", id: "member-1" });
    await unmount(root);
  });
});
