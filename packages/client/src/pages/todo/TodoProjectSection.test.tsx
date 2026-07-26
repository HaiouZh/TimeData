// @vitest-environment jsdom

import { DndContext } from "@dnd-kit/core";
import type { Task } from "@timedata/shared";
import { act } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TodoProjectGroup } from "../../lib/tasks/goalMembership.js";
import { getProjectZoneIntroDismissed, setProjectZoneIntroDismissed } from "../../lib/tasks/workbenchPrefs.js";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import { TaskRow } from "./TaskRow.js";
import { ProjectNameChip, ProjectZoneIntroBar, TodoProjectSection } from "./TodoProjectSection.js";
import { projectContainerId } from "./todoDnd.js";

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

function sectionElement(props: Partial<Parameters<typeof TodoProjectSection>[0]> = {}) {
  return (
    <MemoryRouter>
      <TodoProjectSection
        groups={props.groups ?? []}
        handSessionId={props.handSessionId ?? null}
        now={props.now ?? NOW}
        revealGoals={props.revealGoals ?? []}
        onRevealConsumed={props.onRevealConsumed ?? vi.fn()}
        onExitProject={props.onExitProject ?? vi.fn()}
        dropBlocked={props.dropBlocked ?? null}
        {...handlers}
      />
    </MemoryRouter>
  );
}

function renderSection(props: Partial<Parameters<typeof TodoProjectSection>[0]> = {}) {
  return renderDom(sectionElement(props));
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

  it("revealGoals 展开指定组并回报消费（jsdom 无 scrollIntoView 也不抛）", async () => {
    setProjectZoneIntroDismissed(true);
    const groups = [group({ goalId: "g1", tasks: [task({ id: "t1", title: "刷墙" })] })];
    const { host, root } = await renderSection({ groups });
    expect(host.textContent).not.toContain("刷墙");

    await unmount(root);

    const onRevealConsumed = vi.fn();
    const second = await renderSection({ groups, revealGoals: ["g1"], onRevealConsumed });
    expect(second.host.textContent).toContain("刷墙");
    // 消费必须回报给宿主清空，否则跨断点重挂时这条意图会被 mount effect 重放一遍。
    expect(onRevealConsumed).toHaveBeenCalledWith(["g1"]);
    await unmount(second.root);
  });

  it("目标组这一帧还没渲染出来：意图不消费也不丢，组出现后补上展开", async () => {
    // 成员刚升根 / 刚被清掉重复时，宿主查一次库就置位，而项目区要等 listTasks 整轮重算才产出这一组——
    // 前者几乎必然先落。此时 rowRefs 上没有节点，脉冲式实现会静默跳过滚动且永不重试。
    setProjectZoneIntroDismissed(true);
    const onRevealConsumed = vi.fn();
    const revealGoals = ["g1"];
    const { host, root } = await renderDom(sectionElement({ groups: [], revealGoals, onRevealConsumed }));
    expect(onRevealConsumed).not.toHaveBeenCalled();

    const groups = [group({ goalId: "g1", tasks: [task({ id: "t1", title: "刷墙" })] })];
    await act(async () => root.render(sectionElement({ groups, revealGoals, onRevealConsumed })));

    expect(host.textContent).toContain("刷墙");
    expect(onRevealConsumed).toHaveBeenCalledWith(["g1"]);
    await unmount(root);
  });
});

describe("TodoProjectSection 落点", () => {
  function renderWithDnd(props: Partial<Parameters<typeof TodoProjectSection>[0]> = {}) {
    // 生产里本组件挂在 TodoPage 顶层 DndContext 之下，落点要真的注册进去才算数。
    return renderDom(<DndContext>{sectionElement(props)}</DndContext>);
  }

  it("每组渲染一个 project:<goalId> 落点，且落点包住展开态的内容区", async () => {
    setProjectZoneIntroDismissed(false); // 首次默认展开
    const { host, root } = await renderWithDnd({
      groups: [group({ goalId: "g1", tasks: [task({ id: "t1" })] })],
    });
    const card = host.querySelector('[data-testid="project-group"][data-goal-id="g1"]');
    expect(card?.getAttribute("data-droppable-id")).toBe(projectContainerId("g1"));
    // 展开态的行在落点内部，而不是它的兄弟节点
    expect(card?.querySelector('[aria-label="打开 任务 t1"]')).not.toBeNull();
    await unmount(root);
  });

  it("拖着一条可入组的任务时组块是可落态", async () => {
    const { host, root } = await renderWithDnd({
      groups: [group({ goalId: "g1" })],
      dropBlocked: false,
    });
    const card = host.querySelector('[data-testid="project-group"][data-goal-id="g1"]');
    expect(card?.getAttribute("data-drop-blocked")).toBe("false");
    await unmount(root);
  });

  // 本条**只锁渲染，不覆盖任何一支判定**：dropBlocked 的判定已整个上移到 TodoPage（子任务不在任何
  // bucket 里，组件根本查不到它的行）。曾经这里摆着「子任务那支」「重复待办那支」两条，但两条逐行等价、
  // 走同一条渲染路径，名字里的两支在组件里早已不存在——那是对「两条各锁一半」这个标注规范的假冒，
  // 会抬高下一轮误删真双胞胎的概率（参见 goalMembership.test.ts 里那对外观相同但性质相反的真双胞胎）。
  // 真闸在 TodoPage.test.tsx 的《拖起子任务或重复待办时项目组块进禁止态，拖起根任务则是可落态》。
  it("dropBlocked=true 时组块进禁止态", async () => {
    const { host, root } = await renderWithDnd({
      groups: [group({ goalId: "g1" })],
      dropBlocked: true,
    });
    const card = host.querySelector('[data-testid="project-group"][data-goal-id="g1"]');
    expect(card?.getAttribute("data-drop-blocked")).toBe("true");
    await unmount(root);
  });

  it("没在拖时不给任何态（data-drop-blocked 缺席）", async () => {
    const { host, root } = await renderWithDnd({ groups: [group({ goalId: "g1" })], dropBlocked: null });
    const card = host.querySelector('[data-testid="project-group"][data-goal-id="g1"]');
    expect(card?.hasAttribute("data-drop-blocked")).toBe(false);
    await unmount(root);
  });

  it("组内的行不渲染拖柄：项目区不注册 draggable，同一 taskId 不会在页面里被登记两次", async () => {
    setProjectZoneIntroDismissed(false);
    const { host, root } = await renderWithDnd({
      groups: [group({ goalId: "g1", tasks: [task({ id: "t1" })] })],
    });
    expect(host.querySelector('[data-testid="task-row-grab-area"]')).toBeNull();
    await unmount(root);
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
