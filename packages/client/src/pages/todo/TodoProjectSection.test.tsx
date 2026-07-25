// @vitest-environment jsdom

import type { Task } from "@timedata/shared";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TodoProjectGroup } from "../../lib/tasks/goalMembership.js";
import { getProjectZoneIntroDismissed, setProjectZoneIntroDismissed } from "../../lib/tasks/workbenchPrefs.js";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import { TaskRow } from "./TaskRow.js";
import { ProjectNameChip, ProjectZoneIntroBar, TodoProjectSection } from "./TodoProjectSection.js";

const NOW = new Date("2026-07-25T10:00:00.000Z");

function task(overrides: Partial<Task> & Pick<Task, "id">): Task {
  return {
    parentId: null,
    title: `任务 ${overrides.id}`,
    done: false,
    recurrence: null,
    lastDoneAt: null,
    startAt: null,
    scheduledAt: null,
    completedCount: 0,
    completedAt: null,
    tags: [],
    sortOrder: 0,
    weight: 0,
    ruleId: null,
    sessionId: null,
    skipped: false,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  } as Task;
}

function group(overrides: Partial<TodoProjectGroup> & Pick<TodoProjectGroup, "goalId">): TodoProjectGroup {
  return { goalTitle: `目标 ${overrides.goalId}`, tasks: [], doneTasks: [], ...overrides };
}

const handlers = {
  onToggle: vi.fn(),
  onEdit: vi.fn(),
  onDelete: vi.fn(),
  onToToday: vi.fn(),
  onToInbox: vi.fn(),
};

function renderSection(props: Partial<Parameters<typeof TodoProjectSection>[0]> = {}) {
  return renderDom(
    <MemoryRouter>
      <TodoProjectSection
        groups={props.groups ?? []}
        handSessionId={props.handSessionId ?? null}
        now={props.now ?? NOW}
        revealGoal={props.revealGoal ?? null}
        onExitProject={props.onExitProject ?? vi.fn()}
        {...handlers}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  setProjectZoneIntroDismissed(false);
});

describe("TodoProjectSection", () => {
  it("零组时不渲染任何东西", async () => {
    const { host, root } = await renderSection();
    expect(host.textContent).toBe("");
    await unmount(root);
  });

  it("提示条未关闭时首次默认展开全部组", async () => {
    const { host, root } = await renderSection({
      groups: [group({ goalId: "g1", goalTitle: "装修", tasks: [task({ id: "t1", title: "刷墙" })] })],
    });
    expect(host.textContent).toContain("刷墙");
    await unmount(root);
  });

  it("提示条已关闭时默认全折叠，点组头才展开", async () => {
    setProjectZoneIntroDismissed(true);
    const { host, root } = await renderSection({
      groups: [group({ goalId: "g1", goalTitle: "装修", tasks: [task({ id: "t1", title: "刷墙" })] })],
    });
    expect(host.textContent).toContain("装修");
    expect(host.textContent).not.toContain("刷墙");

    await click(host.querySelector('[data-testid="project-group-toggle"]'));
    expect(host.textContent).toContain("刷墙");
    await unmount(root);
  });

  it("有未完成成员时显示「还剩 N / 共 M」，不出现去归档入口", async () => {
    const { host, root } = await renderSection({
      groups: [
        group({
          goalId: "g1",
          goalTitle: "装修",
          tasks: [task({ id: "t1" }), task({ id: "t2" })],
          doneTasks: [task({ id: "d1", done: true })],
        }),
      ],
    });
    expect(host.textContent).toContain("还剩 2 / 共 3");
    expect(host.querySelector('a[href="/goals/g1"]')).toBeNull();
    await unmount(root);
  });

  it("成员全部完成时显示「已完成 · M 条」并给出去归档深链", async () => {
    const { host, root } = await renderSection({
      groups: [group({ goalId: "g1", goalTitle: "装修", doneTasks: [task({ id: "d1", done: true })] })],
    });
    expect(host.textContent).toContain("已完成 · 1 条");
    const link = host.querySelector('a[href="/goals/g1"]');
    expect(link?.textContent).toBe("去归档");
    await unmount(root);
  });

  it("状态点：排今天的成员显示「今天」，躺着的不挂胶囊", async () => {
    const { host, root } = await renderSection({
      groups: [
        group({
          goalId: "g1",
          tasks: [task({ id: "t1", scheduledAt: "2026-07-25T00:00:00.000Z" }), task({ id: "t2" })],
        }),
      ],
    });
    const chips = host.querySelectorAll('[data-testid="project-member-state"]');
    expect(chips).toHaveLength(1);
    expect(chips[0]?.textContent).toBe("今天");
    await unmount(root);
  });

  it("状态点：在手头优先于时间轴", async () => {
    const { host, root } = await renderSection({
      handSessionId: "s1",
      groups: [
        group({ goalId: "g1", tasks: [task({ id: "t1", sessionId: "s1", scheduledAt: "2026-07-25T00:00:00.000Z" })] }),
      ],
    });
    expect(host.querySelector('[data-testid="project-member-state"]')?.textContent).toBe("在手头");
    await unmount(root);
  });

  it("退出项目动作带上所属 goalId 与该行任务", async () => {
    const onExitProject = vi.fn();
    const member = task({ id: "t1", title: "刷墙" });
    const { host, root } = await renderSection({
      onExitProject,
      groups: [group({ goalId: "g1", tasks: [member] })],
    });
    await click(host.querySelector('button[aria-label="退出项目 刷墙"]'));
    expect(onExitProject).toHaveBeenCalledTimes(1);
    expect(onExitProject).toHaveBeenCalledWith("g1", member);
    await unmount(root);
  });

  it("已完成成员收在折叠子区里（默认不展开），未完成的在子区之外", async () => {
    const { host, root } = await renderSection({
      groups: [
        group({
          goalId: "g1",
          tasks: [task({ id: "t1", title: "刷墙" })],
          doneTasks: [task({ id: "d1", title: "已刷好", done: true })],
        }),
      ],
    });
    const details = host.querySelector("details") as HTMLDetailsElement;
    expect(details).not.toBeNull();
    // `<details open={false}>` 只是收起呈现，子树仍在 DOM 里（同 AtHandSection 的「本场已完成」），
    // 所以判「没列出来」只能看 open 属性 + 归属，**不能**用 host.textContent 的 not.toContain。
    expect(details.open).toBe(false);
    expect(details.textContent).toContain("已刷好");
    expect(host.textContent).toContain("刷墙");
    expect(details.textContent ?? "").not.toContain("刷墙");
    await unmount(root);
  });

  it("revealGoal 展开指定组（jsdom 无 scrollIntoView 也不抛）", async () => {
    setProjectZoneIntroDismissed(true);
    const groups = [group({ goalId: "g1", tasks: [task({ id: "t1", title: "刷墙" })] })];
    const { host, root } = await renderSection({ groups });
    expect(host.textContent).not.toContain("刷墙");

    await unmount(root);

    const second = await renderSection({ groups, revealGoal: { id: "g1", nonce: 1 } });
    expect(second.host.textContent).toContain("刷墙");
    await unmount(second.root);
  });
});

describe("ProjectZoneIntroBar", () => {
  it("首次显示条数与组数，关闭后消失并记住偏好", async () => {
    const { host, root } = await renderDom(<ProjectZoneIntroBar memberCount={5} groupCount={2} />);
    expect(host.textContent).toContain("5 条任务已归入 2 个项目");

    await click(host.querySelector('button[aria-label="知道了"]'));
    expect(host.querySelector('[data-testid="project-zone-intro"]')).toBeNull();
    expect(getProjectZoneIntroDismissed()).toBe(true);
    await unmount(root);
  });

  it("零成员或已关闭时不渲染", async () => {
    const empty = await renderDom(<ProjectZoneIntroBar memberCount={0} groupCount={0} />);
    expect(empty.host.textContent).toBe("");
    await unmount(empty.root);

    setProjectZoneIntroDismissed(true);
    const dismissed = await renderDom(<ProjectZoneIntroBar memberCount={5} groupCount={2} />);
    expect(dismissed.host.textContent).toBe("");
    await unmount(dismissed.root);
  });
});

describe("ProjectNameChip", () => {
  it("显示组名；点击回调组 id 且不触发行的打开详情", async () => {
    const onOpen = vi.fn();
    const onEdit = vi.fn();
    const { host, root } = await renderDom(
      <TaskRow
        task={task({ id: "t1", title: "刷墙" })}
        pool="today"
        metaChip={<ProjectNameChip chip={{ goalId: "g1", goalTitle: "装修" }} onOpen={onOpen} />}
        {...handlers}
        onEdit={onEdit}
      />,
    );
    const chip = host.querySelector('[data-testid="project-name-chip"]');
    expect(chip?.textContent).toContain("装修");

    await click(chip);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith("g1");
    // 行本身是 role="link"，点 chip 不能顺手把详情抽屉也打开。
    expect(onEdit).not.toHaveBeenCalled();
    await unmount(root);
  });
});
