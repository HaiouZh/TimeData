// @vitest-environment jsdom
import { type Task, TaskSchema } from "@timedata/shared";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { renderDom, unmount } from "../../test/domHarness.js";
import { WaitingSection } from "./WaitingSection.js";

describe("WaitingSection", () => {
  let taskSeq = 0;
  function makeTask(title: string): Task {
    taskSeq += 1;
    return TaskSchema.parse({
      id: `task-ws-${taskSeq}`,
      parentId: null,
      title,
      done: false,
      recurrence: null,
      lastDoneAt: null,
      startAt: null,
      scheduledAt: null,
      completedCount: 0,
      weight: 0,
      completedAt: null,
      tags: [],
      ruleId: null,
      sessionId: null,
      skipped: false,
      sortOrder: taskSeq,
      createdAt: "2026-07-10T12:00:00.000Z",
      updatedAt: "2026-07-10T12:00:00.000Z",
    });
  }

  it("渲染区标题、条数与任务行", async () => {
    const taskA = makeTask("速记 sticky 日期条");
    const taskB = makeTask("同步重构");
    const { host, root } = await renderDom(
      <MemoryRouter>
        <WaitingSection tasks={[taskA, taskB]} />
      </MemoryRouter>,
    );
    const section = host.querySelector('[data-testid="todo-section-waiting"]');
    expect(section).not.toBeNull();
    expect(section?.textContent).toContain("在等");
    expect(section?.textContent).toContain("速记 sticky 日期条");
    expect(section?.textContent).toContain("同步重构");
    // 计数为 tasks.length
    expect(section?.textContent).toContain("2");
    await unmount(root);
  });
});

describe("WaitingSection 任务行", () => {
  let taskSeq = 0;
  function makeTask(title: string): Task {
    taskSeq += 1;
    return TaskSchema.parse({
      id: `task-${taskSeq}`,
      parentId: null,
      title,
      done: false,
      recurrence: null,
      lastDoneAt: null,
      startAt: null,
      scheduledAt: null,
      completedCount: 0,
      weight: 0,
      completedAt: null,
      tags: [],
      ruleId: null,
      sessionId: null,
      skipped: false,
      sortOrder: taskSeq,
      createdAt: "2026-07-10T12:00:00.000Z",
      updatedAt: "2026-07-10T12:00:00.000Z",
    });
  }

  it("任务行渲染出标题与「等 XX」", async () => {
    const task = makeTask("等装修队的验收");
    const { host, root } = await renderDom(
      <MemoryRouter>
        <WaitingSection tasks={[task]} blockerTitles={{ [task.id]: ["装修队"] }} />
      </MemoryRouter>,
    );
    const section = host.querySelector('[data-testid="todo-section-waiting"]');
    expect(section).not.toBeNull();
    expect(section?.textContent).toContain("等装修队的验收");
    const chip = host.querySelector('[data-testid="waiting-blocker-chip"]');
    expect(chip?.textContent).toBe("等 装修队");
    await unmount(root);
  });

  it("任务空时整区不渲染", async () => {
    const { host, root } = await renderDom(
      <MemoryRouter>
        <WaitingSection tasks={[]} />
      </MemoryRouter>,
    );
    expect(host.querySelector('[data-testid="todo-section-waiting"]')).toBeNull();
    await unmount(root);
  });
});
