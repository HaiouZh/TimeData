// @vitest-environment jsdom
import { TaskSchema, type Task, type Track } from "@timedata/shared";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import type { TodoTrackRow } from "../../lib/tasks/todoTrackRows.js";
import { renderDom, unmount } from "../../test/domHarness.js";
import { WaitingSection } from "./WaitingSection.js";

const NOW = new Date("2026-08-18T12:00:00.000Z");

function makeRow(id: string, title: string): TodoTrackRow {
  const track: Track = {
    id,
    title,
    status: "active",
    refs: [],
    createdAt: "2026-07-10T12:00:00.000Z",
    updatedAt: "2026-07-14T12:00:00.000Z",
  };
  return { track, steps: [], zone: "waiting", stepCount: 3, hasOpenStep: false };
}

describe("WaitingSection", () => {
  it("渲染区标题、条数与每条轨道行", async () => {
    const { host, root } = await renderDom(
      <MemoryRouter>
        <WaitingSection
          rows={[makeRow("tr1", "速记 sticky 日期条"), makeRow("tr2", "同步重构")]}
          expandedTrackIds={new Set()}
          onToggleTrackExpand={() => {}}
          now={NOW}
        />
      </MemoryRouter>,
    );
    const section = host.querySelector('[data-testid="todo-section-waiting"]');
    expect(section).not.toBeNull();
    expect(section?.textContent).toContain("在等");
    expect(section?.textContent).toContain("速记 sticky 日期条");
    expect(section?.textContent).toContain("同步重构");
    expect(host.querySelectorAll('[data-testid="todo-track-row"]').length).toBe(2);
    await unmount(root);
  });

  it("没有停滞轨道时整块不渲染", async () => {
    const { host, root } = await renderDom(
      <MemoryRouter>
        <WaitingSection
          rows={[]}
          expandedTrackIds={new Set()}
          onToggleTrackExpand={() => {}}
          now={NOW}
        />
      </MemoryRouter>,
    );
    expect(host.querySelector('[data-testid="todo-section-waiting"]')).toBeNull();
    await unmount(root);
  });

  it("透传展开态：expandedTrackIds 命中的轨道行展开出步骤流", async () => {
    const waitingRow = makeRow("tr1", "速记 sticky 日期条");
    const rowWithStep: TodoTrackRow = {
      ...waitingRow,
      stepCount: 1,
      steps: [
        {
          id: "s1",
          seq: 1,
          trackId: "tr1",
          source: "user",
          content: "上一次推进",
          startedAt: "2026-08-10T10:00:00.000Z",
          endedAt: "2026-08-10T10:05:00.000Z",
          refs: [],
          tags: [],
          createdAt: "2026-08-10T10:00:00.000Z",
          updatedAt: "2026-08-10T10:05:00.000Z",
        },
      ],
    };
    const { host, root } = await renderDom(
      <MemoryRouter>
        <WaitingSection
          rows={[rowWithStep]}
          expandedTrackIds={new Set([rowWithStep.track.id])}
          onToggleTrackExpand={() => {}}
          now={NOW}
        />
      </MemoryRouter>,
    );
    expect(host.querySelector('[data-testid="todo-track-step"]')).not.toBeNull();
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
        <WaitingSection
          rows={[]}
          tasks={[task]}
          blockerTitles={{ [task.id]: ["装修队"] }}
          expandedTrackIds={new Set()}
          onToggleTrackExpand={() => {}}
          now={NOW}
        />
      </MemoryRouter>,
    );
    const section = host.querySelector('[data-testid="todo-section-waiting"]');
    expect(section).not.toBeNull();
    expect(section?.textContent).toContain("等装修队的验收");
    const chip = host.querySelector('[data-testid="waiting-blocker-chip"]');
    expect(chip?.textContent).toBe("等 装修队");
    await unmount(root);
  });

  it("任务与轨道都空时整区不渲染", async () => {
    const { host, root } = await renderDom(
      <MemoryRouter>
        <WaitingSection
          rows={[]}
          tasks={[]}
          expandedTrackIds={new Set()}
          onToggleTrackExpand={() => {}}
          now={NOW}
        />
      </MemoryRouter>,
    );
    expect(host.querySelector('[data-testid="todo-section-waiting"]')).toBeNull();
    await unmount(root);
  });
});
