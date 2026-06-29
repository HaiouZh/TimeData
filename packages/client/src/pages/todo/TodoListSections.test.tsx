// @vitest-environment jsdom

import type { Task } from "@timedata/shared";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { renderDom, unmount } from "../../test/domHarness.js";
import { CollapsibleSection } from "./CollapsibleSection.js";
import { TaskColumn } from "./TaskColumn.js";

function task(id: string, title: string): Task {
  return {
    id,
    title,
    done: false,
    recurrence: null,
    lastDoneAt: null,
    startAt: null,
    scheduledAt: null,
    completedCount: 0,
    sortOrder: 0,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  };
}
const handlers = { onToggle: () => {}, onEdit: () => {}, onDelete: () => {}, onToToday: () => {}, onToInbox: () => {} };

describe("TaskColumn", () => {
  it("渲染标题、计数与任务", async () => {
    const { host, root } = await renderDom(
      createElement(TaskColumn, {
        title: "今天",
        pool: "today",
        tasks: [task("a", "任务A"), task("b", "任务B")],
        emptyText: "今天没有任务",
        ...handlers,
      }),
    );
    expect(host.textContent).toContain("今天");
    expect(host.textContent).toContain("2");
    expect(host.textContent).toContain("任务A");
    await unmount(root);
  });

  it("空列表显示空状态", async () => {
    const { host, root } = await renderDom(
      createElement(TaskColumn, {
        title: "收件箱",
        pool: "inbox",
        tasks: [],
        emptyText: "收件箱为空",
        ...handlers,
      }),
    );
    expect(host.textContent).toContain("收件箱为空");
    await unmount(root);
  });
});

describe("CollapsibleSection", () => {
  it("默认收起，内容不展示在 open 之前", async () => {
    const { host, root } = await renderDom(
      createElement(
        CollapsibleSection,
        {
          title: "即将到来",
          count: 3,
        },
        createElement("p", null, "里面的内容"),
      ),
    );
    const details = host.querySelector("details") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(host.textContent).toContain("即将到来");
    expect(host.textContent).toContain("3");
    await unmount(root);
  });
});
