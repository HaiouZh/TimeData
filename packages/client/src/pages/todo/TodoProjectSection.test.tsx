// @vitest-environment jsdom

import { DndContext } from "@dnd-kit/core";
import type { Task } from "@timedata/shared";
import { act } from "react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TodoProjectGroup } from "../../lib/tasks/goalMembership.js";
import { GOAL_MEMBERS_MAX } from "../../lib/tasks/goalMembership.js";
import { DEFAULT_TODO_GRAVITY_SETTINGS } from "../../lib/tasks/gravity.js";
import { sortProjectMembers } from "../../lib/tasks/projectZone.js";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import { TaskRow } from "./TaskRow.js";
import { ProjectNameChip, TodoProjectSection } from "./TodoProjectSection.js";
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
  return {
    goalTitle: `目标 ${overrides.goalId}`,
    tasks: [],
    doneCount: 0,
    recentDoneCount: 0,
    memberCount: 0,
    pendingChildByMember: new Map(),
    blockedByMember: new Map(),
    ...overrides,
  };
}

const handlers = {
  onToggle: vi.fn(),
  onEdit: vi.fn(),
  onDelete: vi.fn(),
  onToToday: vi.fn(),
  onToInbox: vi.fn(),
};

/**
 * 折叠态下「下一步」徽章也会显示首条未完成成员的标题，所以「组内没渲染任务行」这件事
 * 不能直接用 host.textContent 查标题——要先把徽章文本摘掉再看。
 * 用 cloneNode 摘，不动真实 DOM，后续断言不受影响。
 */
function textWithoutNextBadge(host: HTMLElement): string {
  const clone = host.cloneNode(true) as HTMLElement;
  for (const badge of clone.querySelectorAll('[data-testid="project-next-badge"]')) badge.remove();
  return clone.textContent ?? "";
}

function sectionElement(props: Partial<Parameters<typeof TodoProjectSection>[0]> = {}) {
  return (
    <MemoryRouter>
      <TodoProjectSection
        groups={props.groups ?? []}
        filterActive={props.filterActive}
        hasActiveProjects={props.hasActiveProjects ?? (props.groups?.length ?? 0) > 0}
        projectTints={props.projectTints ?? new Map()}
        handSessionId={props.handSessionId ?? null}
        now={props.now ?? NOW}
        revealGoals={props.revealGoals ?? []}
        onRevealConsumed={props.onRevealConsumed ?? vi.fn()}
        onExitProject={props.onExitProject ?? vi.fn()}
        onCreateTask={props.onCreateTask ?? vi.fn(async () => task({ id: "created" }))}
        onRenameGoal={props.onRenameGoal ?? vi.fn(async () => undefined)}
        onOpenGoal={props.onOpenGoal ?? vi.fn()}
        dropBlocked={props.dropBlocked ?? null}
        trackChipFor={props.trackChipFor}
        indentTargetId={props.indentTargetId ?? null}
        revealChildren={props.revealChildren ?? null}
        projectTrackRows={props.projectTrackRows}
        gravitySettings={props.gravitySettings ?? { ...DEFAULT_TODO_GRAVITY_SETTINGS, enabled: false }}
        dormantGoalIds={props.dormantGoalIds ?? new Set<string>()}
        onPromoteToTrack={props.onPromoteToTrack}
        onBumpTask={props.onBumpTask}
        onToggle={props.onToggle ?? handlers.onToggle}
        onEdit={props.onEdit ?? handlers.onEdit}
        onDelete={props.onDelete ?? handlers.onDelete}
        onToToday={props.onToToday ?? handlers.onToToday}
        onToInbox={props.onToInbox ?? handlers.onToInbox}
        onToHand={props.onToHand}
      />
    </MemoryRouter>
  );
}

function renderSection(props: Partial<Parameters<typeof TodoProjectSection>[0]> = {}) {
  return renderDom(sectionElement(props));
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("TodoProjectSection", () => {
  it("零组时不渲染任何东西", async () => {
    const { host, root } = await renderSection();
    expect(host.textContent).toBe("");
    await unmount(root);
  });

  it("默认全折叠，点组头才展开", async () => {
    const { host, root } = await renderSection({
      groups: [group({ goalId: "g1", goalTitle: "装修", tasks: [task({ id: "t1", title: "刷墙" })] })],
    });
    expect(host.textContent).toContain("装修");
    expect(textWithoutNextBadge(host)).not.toContain("刷墙");

    await click(host.querySelector('[data-testid="project-group-toggle"]'));
    expect(host.textContent).toContain("刷墙");
    await unmount(root);
  });

  // 成员行的行动作按两根**独立**的轴渲染：抓手看焦点轴、换池箭头看时间轴。
  // 组内列表按 pool="inbox" 铺（组内不排序也不换池），若行动作也跟着这个列表级 pool 走，
  // 已在手头的行照样挂着「抓到手头」、已排今天的行照样挂着「排进今天」——两个都是空动作。
  describe("成员行动作按真实状态渲染", () => {
    async function expandedRowButtons(taskOverrides: Partial<Task> & Pick<Task, "id">, handSessionId: string | null) {
      const rendered = await renderSection({
        handSessionId,
        onToHand: vi.fn(),
        groups: [group({ goalId: "g1", goalTitle: "装修", tasks: [task(taskOverrides)] })],
      });
      await click(rendered.host.querySelector('[data-testid="project-group-toggle"]'));
      return rendered;
    }

    it("已抓到手头的成员：不再显示「抓到手头」按钮", async () => {
      const { host, root } = await expandedRowButtons({ id: "t1", title: "刷墙", sessionId: "s1" }, "s1");
      expect(host.querySelector('[aria-label^="抓到手头"]')).toBeNull();
      await unmount(root);
    });

    it("sessionId 是历史指针：不等于当前活跃场的成员，「抓到手头」照常在", async () => {
      const { host, root } = await expandedRowButtons({ id: "t1", title: "刷墙", sessionId: "旧场" }, "s1");
      expect(host.querySelector('[aria-label^="抓到手头"]')).not.toBeNull();
      await unmount(root);
    });

    it("已排今天的成员：换池按钮是「回收件箱」，不是「排进今天」", async () => {
      const { host, root } = await expandedRowButtons(
        { id: "t1", title: "刷墙", scheduledAt: "2026-07-25T00:00:00.000Z" },
        null,
      );
      expect(host.querySelector('[aria-label^="回收件箱"]')).not.toBeNull();
      expect(host.querySelector('[aria-label^="排进今天"]')).toBeNull();
      await unmount(root);
    });

    it("躺着的成员：换池按钮是「排进今天」", async () => {
      const { host, root } = await expandedRowButtons({ id: "t1", title: "刷墙" }, null);
      expect(host.querySelector('[aria-label^="排进今天"]')).not.toBeNull();
      expect(host.querySelector('[aria-label^="回收件箱"]')).toBeNull();
      await unmount(root);
    });

    it("排到未来的成员：换池按钮仍是「排进今天」——它还没到今天", async () => {
      const { host, root } = await expandedRowButtons(
        { id: "t1", title: "刷墙", scheduledAt: "2026-08-20T00:00:00.000Z" },
        null,
      );
      expect(host.querySelector('[aria-label^="排进今天"]')).not.toBeNull();
      expect(host.querySelector('[aria-label^="回收件箱"]')).toBeNull();
      await unmount(root);
    });

    it("在手头且已排今天：抓手关掉，箭头仍按时间轴指「回收件箱」——两根轴谁也不遮谁", async () => {
      const { host, root } = await expandedRowButtons(
        { id: "t1", title: "刷墙", sessionId: "s1", scheduledAt: "2026-07-25T00:00:00.000Z" },
        "s1",
      );
      expect(host.querySelector('[aria-label^="抓到手头"]')).toBeNull();
      expect(host.querySelector('[aria-label^="回收件箱"]')).not.toBeNull();
      await unmount(root);
    });
  });

  it("有未完成成员时显示「还剩 N · 近 7 天 +M」，不出现去归档入口", async () => {
    const { host, root } = await renderSection({
      groups: [
        group({
          goalId: "g1",
          goalTitle: "装修",
          tasks: [task({ id: "t1" }), task({ id: "t2" })],
          doneCount: 9,
          recentDoneCount: 5,
        }),
      ],
    });
    expect(host.textContent).toContain("还剩 2 · 近 7 天 +5");
    expect(host.textContent).not.toContain("共 11");
    expect(host.querySelector('a[href="/goals/g1"]')).toBeNull();
    await unmount(root);
  });

  it("窗口内没动静时不画 +0，只剩「还剩 N」", async () => {
    const { host, root } = await renderSection({
      groups: [group({ goalId: "g1", tasks: [task({ id: "t1" })], doneCount: 40, recentDoneCount: 0 })],
    });
    expect(host.textContent).toContain("还剩 1");
    expect(host.textContent).not.toContain("+0");
    expect(host.textContent).not.toContain("近 7 天");
    await unmount(root);
  });

  it("成员全部完成时显示「已完成 · M 条」并给出去归档深链", async () => {
    const { host, root } = await renderSection({
      groups: [group({ goalId: "g1", goalTitle: "装修", doneCount: 1 })],
    });
    expect(host.textContent).toContain("已完成 · 1 条");
    const link = host.querySelector('a[href="/goals/g1"]');
    expect(link?.textContent).toBe("去归档");
    await unmount(root);
  });

  it("项目标题行的加号只在未完成组出现，点击后展开并聚焦就地输入", async () => {
    const { host, root } = await renderSection({
      groups: [
        group({ goalId: "g1", goalTitle: "装修", tasks: [task({ id: "t1" })] }),
        group({ goalId: "g2", goalTitle: "已完", doneCount: 1 }),
      ],
    });
    const plus = host.querySelector('button[aria-label="在项目 装修中创建任务"]');
    expect(plus).not.toBeNull();
    expect(host.querySelector('button[aria-label="在项目 已完中创建任务"]')).toBeNull();
    const toggle = host.querySelector('[data-goal-id="g1"] [data-testid="project-group-toggle"]');
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");

    await click(plus);
    const input = host.querySelector('input[aria-label="在项目 装修中新建任务"]') as HTMLInputElement | null;
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);
    await unmount(root);
  });

  it("项目内创建回车只提交非空标题，成功后清空但保持输入框打开，Esc 收起", async () => {
    const onCreateTask = vi.fn(async (_goalId: string, title: string) => task({ id: title, title }));
    const { host, root } = await renderSection({
      onCreateTask,
      groups: [group({ goalId: "g1", goalTitle: "装修", tasks: [task({ id: "t1" })] })],
    });
    await click(host.querySelector('button[aria-label="在项目 装修中创建任务"]'));
    const input = () => host.querySelector('input[aria-label="在项目 装修中新建任务"]') as HTMLInputElement;
    const submit = async (value: string) => {
      const field = input();
      await act(async () => {
        setInputValue(field, value);
        field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      });
    };

    await submit("  ");
    expect(onCreateTask).not.toHaveBeenCalled();
    await submit("先做这条");
    expect(onCreateTask).toHaveBeenCalledWith("g1", "先做这条");
    expect(input().value).toBe("");
    await submit("再做这条");
    expect(onCreateTask).toHaveBeenCalledTimes(2);
    expect(input().value).toBe("");

    await act(async () => input().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(host.querySelector('input[aria-label="在项目 装修中新建任务"]')).toBeNull();
    await unmount(root);
  });

  it("项目内创建用 ref 闸拦住在途重复 Enter，输入法组合态 Enter 不提交", async () => {
    const pending = deferred<Task>();
    const onCreateTask = vi.fn(() => pending.promise);
    const { host, root } = await renderSection({
      onCreateTask,
      groups: [group({ goalId: "g1", goalTitle: "装修", tasks: [task({ id: "old", title: "旧任务" })] })],
    });
    await click(host.querySelector('button[aria-label="在项目 装修中创建任务"]'));
    const input = host.querySelector('input[aria-label="在项目 装修中新建任务"]') as HTMLInputElement;

    await act(async () => {
      setInputValue(input, "候选确认");
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, isComposing: true }));
    });
    expect(onCreateTask).not.toHaveBeenCalled();

    await act(async () => {
      setInputValue(input, "第一条");
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    expect(onCreateTask).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.resolve(task({ id: "first", title: "第一条" }));
      await pending.promise;
    });
    await unmount(root);
  });

  it("连续项目内创建后，最近创建的 idle 任务排在最前", async () => {
    const oldTask = task({ id: "old", title: "旧任务" });
    const first = task({ id: "first", title: "第一条" });
    const second = task({ id: "second", title: "第二条" });
    const onCreateTask = vi.fn(async (_goalId: string, title: string) => (title === "第一条" ? first : second));
    let groups = [group({ goalId: "g1", goalTitle: "装修", tasks: [oldTask] })];
    const { host, root } = await renderDom(sectionElement({ groups, onCreateTask }));
    await click(host.querySelector('button[aria-label="在项目 装修中创建任务"]'));
    const submit = async (value: string) => {
      const field = host.querySelector('input[aria-label="在项目 装修中新建任务"]') as HTMLInputElement;
      await act(async () => {
        setInputValue(field, value);
        field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      });
    };

    await submit("第一条");
    groups = [group({ goalId: "g1", goalTitle: "装修", tasks: [oldTask, first] })];
    await act(async () => root.render(sectionElement({ groups, onCreateTask })));
    await submit("第二条");
    groups = [group({ goalId: "g1", goalTitle: "装修", tasks: [oldTask, first, second] })];
    await act(async () => root.render(sectionElement({ groups, onCreateTask })));

    const labels = Array.from(host.querySelectorAll('[data-goal-id="g1"] [aria-label^="打开 "]')).map((el) =>
      el.getAttribute("aria-label"),
    );
    expect(labels.slice(0, 3)).toEqual(["打开 第二条", "打开 第一条", "打开 旧任务"]);
    await unmount(root);
  });

  it("加号与更多按钮点击不穿透成组展开/折叠，多选态由宿主 inert 接管", async () => {
    const { host, root } = await renderSection({ groups: [group({ goalId: "g1", tasks: [task({ id: "t1" })] })] });
    const toggle = host.querySelector('[data-testid="project-group-toggle"]');
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    await click(host.querySelector('button[aria-label="项目 目标 g1 更多操作"]'));
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    expect(host.querySelector('[role="menu"]')).not.toBeNull();
    await click(host.querySelector('button[aria-label="项目 目标 g1 更多操作"]'));
    await click(host.querySelector('button[aria-label="在项目 目标 g1中创建任务"]'));
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    await click(host.querySelector('button[aria-label="项目 目标 g1 更多操作"]'));
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector('[role="menu"]')).not.toBeNull();
    await unmount(root);
  });

  it("更多菜单首项聚焦，Escape/外部点击关闭且焦点回到触发按钮", async () => {
    const { host, root } = await renderSection({ groups: [group({ goalId: "g1", tasks: [task({ id: "t1" })] })] });
    const trigger = host.querySelector('button[aria-label="项目 目标 g1 更多操作"]') as HTMLButtonElement;
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    await click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(host.querySelector('[role="menuitem"]'));
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(host.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);

    await click(trigger);
    await act(async () => document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
    expect(host.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    await unmount(root);
  });

  it("更多菜单可改名或打开 goals 页，空标题不提交且失焦恢复原名", async () => {
    const onRenameGoal = vi.fn(async () => undefined);
    const onOpenGoal = vi.fn();
    const { host, root } = await renderSection({
      onRenameGoal,
      onOpenGoal,
      groups: [group({ goalId: "g1", goalTitle: "装修", tasks: [task({ id: "t1" })] })],
    });
    const trigger = host.querySelector('button[aria-label="项目 装修 更多操作"]') as HTMLButtonElement;
    await click(trigger);
    await click(host.querySelector('[role="menuitem"]'));
    const renameInput = host.querySelector('input[aria-label="重命名项目 装修"]') as HTMLInputElement;
    expect(renameInput).not.toBeNull();
    await act(async () => {
      setInputValue(renameInput, "  ");
      renameInput.blur();
    });
    expect(onRenameGoal).not.toHaveBeenCalled();
    expect(host.textContent).toContain("装修");

    await click(trigger);
    await click(host.querySelector('[role="menuitem"]'));
    const secondInput = host.querySelector('input[aria-label="重命名项目 装修"]') as HTMLInputElement;
    await act(async () => {
      setInputValue(secondInput, "新项目名");
      secondInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, isComposing: true }));
    });
    expect(onRenameGoal).not.toHaveBeenCalled();
    await act(async () => {
      secondInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    expect(onRenameGoal).toHaveBeenCalledWith("g1", "新项目名");

    await click(trigger);
    await click(host.querySelectorAll('[role="menuitem"]')[1]);
    expect(onOpenGoal).toHaveBeenCalledWith("g1");
    await unmount(root);
  });

  it("成员数达到由上限推导的 90% 时预警，低于阈值或全完成不预警", async () => {
    const threshold = Math.ceil(GOAL_MEMBERS_MAX * 0.9);
    const low = await renderSection({ groups: [group({ goalId: "g1", memberCount: threshold - 1, tasks: [task({ id: "t1" })] })] });
    expect(low.host.textContent).not.toContain("接近上限");
    await unmount(low.root);

    const near = await renderSection({ groups: [group({ goalId: "g1", memberCount: threshold, tasks: [task({ id: "t1" })] })] });
    expect(near.host.textContent).toContain("接近上限");
    await unmount(near.root);

    const done = await renderSection({ groups: [group({ goalId: "g1", memberCount: GOAL_MEMBERS_MAX, doneCount: 1 })] });
    expect(done.host.textContent).not.toContain("接近上限");
    await unmount(done.root);
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
    await click(host.querySelector('[data-testid="project-group-toggle"]'));
    const chips = host.querySelectorAll('[data-testid="project-member-state"]');
    expect(chips).toHaveLength(1);
    expect(chips[0]?.textContent).toBe("今天");
    await unmount(root);
  });

  // 探针模式同 TaskRow.test.tsx 的 metaChip 探针——只验透传与出现，不重测 chip 内部行为。
  it("trackChipFor 提供时，成员行 meta 带渲染其返回节点", async () => {
    const { host, root } = await renderSection({
      groups: [group({ goalId: "g1", tasks: [task({ id: "t1", title: "刷墙" })] })],
      trackChipFor: () => <span data-testid="probe-track-chip">#agent在做</span>,
    });
    // 必须先展开：默认全折叠时组内行不渲染。
    await click(host.querySelector('[data-testid="project-group-toggle"]'));
    expect(host.querySelector('[data-testid="probe-track-chip"]')).not.toBeNull();
    await unmount(root);
  });

  it("状态点：在手头优先于时间轴", async () => {
    const { host, root } = await renderSection({
      handSessionId: "s1",
      groups: [
        group({ goalId: "g1", tasks: [task({ id: "t1", sessionId: "s1", scheduledAt: "2026-07-25T00:00:00.000Z" })] }),
      ],
    });
    await click(host.querySelector('[data-testid="project-group-toggle"]'));
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
    await click(host.querySelector('[data-testid="project-group-toggle"]'));
    await click(host.querySelector('button[aria-label="退出项目 刷墙"]'));
    expect(onExitProject).toHaveBeenCalledTimes(1);
    expect(onExitProject).toHaveBeenCalledWith("g1", member);
    await unmount(root);
  });

  it("已完成成员在组内零渲染出口（连折叠子区都不留）", async () => {
    const { host, root } = await renderSection({
      groups: [
        group({
          goalId: "g1",
          tasks: [task({ id: "t1", title: "刷墙" })],
          doneCount: 3,
          recentDoneCount: 1,
        }),
      ],
    });
    // 先展开：折叠态下组内一个节点都没有，`details` 查询恒为 null，这条会变成永远绿的空用例。
    await click(host.querySelector('[data-testid="project-group-toggle"]'));
    expect(host.querySelector("details")).toBeNull();
    expect(host.textContent).toContain("刷墙");
    expect(host.textContent).not.toContain("已完成");
    await unmount(root);
  });

  it("展开态内容区限高自滚，组撑不爆页面（结构闸）", async () => {
    const { host, root } = await renderSection({
      groups: [group({ goalId: "g1", tasks: [task({ id: "t1", title: "刷墙" })] })],
    });
    await click(host.querySelector('[data-testid="project-group-toggle"]'));
    const card = host.querySelector('[data-testid="project-group"]') as HTMLElement;
    const body = card.querySelector(".overflow-y-auto") as HTMLElement | null;
    expect(body).not.toBeNull();
    expect(body?.className).toContain("todo-project-group-body");
    expect(body?.textContent).toContain("刷墙");
    expect(card.className).not.toContain("max-h-");
    await unmount(root);
  });

  it("revealGoals 展开指定组并回报消费（jsdom 无 scrollIntoView 也不抛）", async () => {
    const groups = [group({ goalId: "g1", tasks: [task({ id: "t1", title: "刷墙" })] })];
    const { host, root } = await renderSection({ groups });
    expect(textWithoutNextBadge(host)).not.toContain("刷墙");

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

  function blurInput(input: HTMLInputElement): Promise<void> {
    return act(async () => {
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
  }

  async function openCreateInput(host: HTMLElement): Promise<HTMLInputElement> {
    await click(host.querySelector('button[aria-label="在项目 目标 g1中创建任务"]'));
    const input = host.querySelector<HTMLInputElement>('input[aria-label="在项目 目标 g1中新建任务"]');
    expect(input).not.toBeNull();
    return input as HTMLInputElement;
  }

  it("新建输入框失焦：草稿非空 → 提交创建并收起", async () => {
    const onCreateTask = vi.fn(async () => task({ id: "t-new" }));
    const { host, root } = await renderSection({ groups: [group({ goalId: "g1", tasks: [task({ id: "t1" })] })], onCreateTask });
    const input = await openCreateInput(host);
    await act(async () => setInputValue(input, "  写文案  "));
    await blurInput(input);
    expect(onCreateTask).toHaveBeenCalledWith("g1", "写文案");
    expect(host.querySelector('input[aria-label="在项目 目标 g1中新建任务"]')).toBeNull();
    await unmount(root);
  });

  it("新建输入框失焦：草稿为空 → 收起且不落库", async () => {
    const onCreateTask = vi.fn(async () => task({ id: "t-new" }));
    const { host, root } = await renderSection({ groups: [group({ goalId: "g1", tasks: [task({ id: "t1" })] })], onCreateTask });
    const input = await openCreateInput(host);
    await blurInput(input);
    expect(onCreateTask).not.toHaveBeenCalled();
    expect(host.querySelector('input[aria-label="在项目 目标 g1中新建任务"]')).toBeNull();
    await unmount(root);
  });

  it("新建输入框失焦：提交被拒 → 保留草稿并显示错误", async () => {
    const onCreateTask = vi.fn(async () => {
      throw new Error("项目成员已达上限");
    });
    const { host, root } = await renderSection({ groups: [group({ goalId: "g1", tasks: [task({ id: "t1" })] })], onCreateTask });
    const input = await openCreateInput(host);
    await act(async () => setInputValue(input, "超员任务"));
    await blurInput(input);
    const kept = host.querySelector<HTMLInputElement>('input[aria-label="在项目 目标 g1中新建任务"]');
    expect(kept?.value).toBe("超员任务");
    expect(host.textContent).toContain("项目成员已达上限");
    await unmount(root);
  });

  it("点 ↵ 按钮：提交且草稿行保持（连续录入），不重复提交", async () => {
    const onCreateTask = vi.fn(async () => task({ id: "t-new" }));
    const { host, root } = await renderSection({ groups: [group({ goalId: "g1", tasks: [task({ id: "t1" })] })], onCreateTask });
    const input = await openCreateInput(host);
    await act(async () => setInputValue(input, "第一条"));
    await click(host.querySelector('button[aria-label="提交新任务"]'));
    expect(onCreateTask).toHaveBeenCalledTimes(1);
    expect(onCreateTask).toHaveBeenCalledWith("g1", "第一条");
    const kept = host.querySelector<HTMLInputElement>('input[aria-label="在项目 目标 g1中新建任务"]');
    expect(kept).not.toBeNull();
    expect(kept?.value).toBe("");
    await unmount(root);
  });

  it("草稿行带复选框占位与 accent 描边（幽灵任务行形态）", async () => {
    const { host, root } = await renderSection({ groups: [group({ goalId: "g1", tasks: [task({ id: "t1" })] })] });
    await openCreateInput(host);
    const row = host.querySelector('[data-testid="project-create-draft-row"]');
    expect(row).not.toBeNull();
    expect(row?.className).toContain("ring-accent");
    expect(row?.querySelector('[data-slot="checkbox-placeholder"]')).not.toBeNull();
    await unmount(root);
  });

  it("组标题不再显示「下一步」徽章（已退役）", async () => {
    const { host, root } = await renderDom(
      sectionElement({
        groups: [
          group({
            goalId: "g1",
            tasks: [task({ id: "t1", title: "接线在等区" }), task({ id: "t2", title: "写收尾" })],
          }),
        ],
      }),
    );
    expect(host.querySelector('[data-testid="project-next-badge"]')).toBeNull();
    expect(host.textContent).not.toContain("下一步");
    await unmount(root);
  });

  it("筛选激活时不显示「下一步」徽章（退役守卫）", async () => {
    const { host, root } = await renderDom(
      sectionElement({
        groups: [group({ goalId: "g1", tasks: [task({ id: "t1", title: "接线在等区" })] })],
        filterActive: true,
      }),
    );
    expect(host.querySelector('[data-testid="project-next-badge"]')).toBeNull();
    expect(host.textContent).not.toContain("下一步");
    await unmount(root);
  });

  it("组内没有未完成成员时不显示「下一步」徽章（退役守卫）", async () => {
    const { host, root } = await renderDom(
      sectionElement({
        groups: [group({ goalId: "g1", tasks: [], doneCount: 3 })],
      }),
    );
    expect(host.querySelector('[data-testid="project-next-badge"]')).toBeNull();
    expect(host.textContent).not.toContain("下一步");
    await unmount(root);
  });
});

  describe("filterActive 属性支持", () => {
    it("筛选时强制展开匹配组，清除筛选后恢复原折叠状态", async () => {
      const g1 = group({ goalId: "g1", tasks: [task({ id: "t1", title: "设计方案" })] });
      const { host, root } = await renderDom(sectionElement({ groups: [g1] }));

      await click(host.querySelector('[data-testid="project-group-toggle"]'));
      await click(host.querySelector('[data-testid="project-group-toggle"]'));
      expect(host.querySelector('[data-testid="project-group-toggle"]')?.getAttribute("aria-expanded")).toBe("false");

      await act(async () => root.render(sectionElement({ groups: [g1], filterActive: true })));
      expect(host.querySelector('[data-testid="project-group-toggle"]')?.getAttribute("aria-expanded")).toBe("true");
      expect(host.textContent).toContain("设计方案");

      await click(host.querySelector('[data-testid="project-group-toggle"]'));
      await act(async () => root.render(sectionElement({ groups: [g1] })));
      expect(host.querySelector('[data-testid="project-group-toggle"]')?.getAttribute("aria-expanded")).toBe("false");
      expect(textWithoutNextBadge(host)).not.toContain("设计方案");
      await unmount(root);
    });

    it("筛选中消费 reveal 后，清除筛选仍恢复原折叠状态", async () => {
      const g1 = group({ goalId: "g1", tasks: [task({ id: "t1", title: "设计方案" })] });
      const onRevealConsumed = vi.fn();
      const { host, root } = await renderDom(
        sectionElement({
          groups: [g1],
          filterActive: true,
          revealGoals: ["g1"],
          onRevealConsumed,
        }),
      );

      expect(onRevealConsumed).toHaveBeenCalledWith(["g1"]);
      expect(host.querySelector('[data-testid="project-group-toggle"]')?.getAttribute("aria-expanded")).toBe("true");

      await act(async () => root.render(sectionElement({ groups: [g1] })));
      expect(host.querySelector('[data-testid="project-group-toggle"]')?.getAttribute("aria-expanded")).toBe("false");
      expect(textWithoutNextBadge(host)).not.toContain("设计方案");
      await unmount(root);
    });

    it("filterActive=true 时，匹配组自动展开且 Header 显示匹配项数量", async () => {
      const g1 = group({ goalId: "g1", goalTitle: "项目一", tasks: [task({ id: "t1", title: "设计方案" })] });
      const { host, root } = await renderDom(
        sectionElement({
          groups: [g1],
          filterActive: true,
        }),
      );
      expect(host.textContent).toContain("1 项匹配");
      expect(host.textContent).toContain("设计方案");
      await unmount(root);
    });

    it("filterActive=true 且 groups 为空数组时展示无匹配任务空态提示", async () => {
      const { host, root } = await renderDom(
        sectionElement({
          groups: [],
          filterActive: true,
          hasActiveProjects: true,
        }),
      );
      expect(host.querySelector('[data-testid="todo-projects-empty"]')).not.toBeNull();
      expect(host.textContent).toContain("项目区无匹配任务");
      await unmount(root);
    });
  });

describe("TodoProjectSection 落点", () => {
  function renderWithDnd(props: Partial<Parameters<typeof TodoProjectSection>[0]> = {}) {
    // 生产里本组件挂在 TodoPage 顶层 DndContext 之下，落点要真的注册进去才算数。
    return renderDom(<DndContext>{sectionElement(props)}</DndContext>);
  }

  it("每组渲染一个 project:<goalId> 落点，且落点包住展开态的内容区", async () => {
    const { host, root } = await renderWithDnd({
      groups: [group({ goalId: "g1", tasks: [task({ id: "t1" })] })],
    });
    // 必须显式展开：默认全折叠时内容区不渲染，下面「行在落点内部」的断言会恒真。
    await click(host.querySelector('[data-testid="project-group-toggle"]'));
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

  // 组内逐行可拖是本批开的产品行为（收纳/升根的前提），旧版「组内不渲染拖柄」的断言被规格取代。
  it("组内的行渲染拖柄：拖柄所在行带组前缀的 dnd 身份，避免与手头/今天区的同屏副本撞 id", async () => {
    const { host, root } = await renderWithDnd({
      groups: [group({ goalId: "g1", tasks: [task({ id: "t1" })] })],
    });
    // 必须显式展开：折叠态下压根没有行，`toBeNull()` 会恒真——这条守的是「展开后真的能拖」。
    await click(host.querySelector('[data-testid="project-group-toggle"]'));
    const grab = host.querySelector('[data-goal-id="g1"] [data-testid="task-row-grab-area"]');
    expect(grab).not.toBeNull();
    expect(grab?.closest("[data-dnd-id]")?.getAttribute("data-dnd-id")).toBe("project-row:g1:t1");
    await unmount(root);
  });

  it("展开的组内每行都注册拖拽身份，且带组前缀", async () => {
    const { host, root } = await renderWithDnd({
      groups: [group({ goalId: "g1", tasks: [task({ id: "t1" }), task({ id: "t2" })] })],
    });
    await click(host.querySelector('[data-testid="project-group-toggle"]'));
    const ids = [...host.querySelectorAll("[data-dnd-id]")].map((el) => el.getAttribute("data-dnd-id"));
    expect(ids).toEqual(["project-row:g1:t1", "project-row:g1:t2"]);
    await unmount(root);
  });

  it("折叠的组内不渲染任何行落点", async () => {
    // 这条不只是行为断言，也是「既有拖拽用例不受影响」的结构前提：
    // 组默认折叠 ⇒ 展开前零新增 droppable ⇒ dnd-kit 的挂载顺序不变。
    const { host, root } = await renderWithDnd({
      groups: [group({ goalId: "g1", tasks: [task({ id: "t1" })] })],
    });
    expect(host.querySelectorAll("[data-dnd-id]")).toHaveLength(0);
    await unmount(root);
  });

  it("indentTargetId 命中的成员行画高亮环", async () => {
    const { host, root } = await renderWithDnd({
      groups: [group({ goalId: "g1", tasks: [task({ id: "t1" }), task({ id: "t2" })] })],
      indentTargetId: "t2",
    });
    await click(host.querySelector('[data-testid="project-group-toggle"]'));
    // 见证是 TaskRow 上的 data-indent-target；断 className 串在本项目属无效测试。
    // 这条守的是「TodoProjectSection 忘了把 indentTargetId 透传下去」——漏接的话高亮永远不亮，
    // 而收纳仍会落库，用户得到的是一次没有任何预告的结构变更。
    expect(host.querySelectorAll('[data-indent-target="true"]')).toHaveLength(1);
    await unmount(root);
  });

  it("组标题圆点用传入的项目色，与同项目的 chip 构成「点↔点」同色", async () => {
    const tint = "var(--color-tint-4)";
    const { host: sectionHost, root: sectionRoot } = await renderSection({
      groups: [group({ goalId: "g1", goalTitle: "重构同步层" })],
      projectTints: new Map([["g1", tint]]),
    });
    const groupDot = sectionHost.querySelector(
      '[data-testid="project-group"] [data-project-dot]',
    ) as HTMLElement;
    expect(groupDot).not.toBeNull();
    // 值断言而非只比「两处相等」：只比相等时，两处一起改错取色来源也会全绿。
    expect(groupDot.style.backgroundColor).toBe(tint);

    const { host: chipHost, root: chipRoot } = await renderDom(
      <ProjectNameChip chip={{ goalId: "g1", goalTitle: "重构同步层", tint }} onOpen={vi.fn()} />,
    );
    const chipDot = chipHost.querySelector("[data-project-dot]") as HTMLElement;
    expect(chipDot.style.backgroundColor).toBe(groupDot.style.backgroundColor);

    await unmount(sectionRoot);
    await unmount(chipRoot);
  });

  it("不同项目各用自己的色（不再全场同一个绿）", async () => {
    const { host, root } = await renderSection({
      groups: [group({ goalId: "g1", goalTitle: "同名项目" }), group({ goalId: "g2", goalTitle: "同名项目" })],
      projectTints: new Map([
        ["g1", "var(--color-tint-1)"],
        ["g2", "var(--color-tint-7)"],
      ]),
    });
    const dots = [...host.querySelectorAll('[data-testid="project-group"] [data-project-dot]')] as HTMLElement[];
    expect(dots).toHaveLength(2);
    // 按 goalId 取色。若改成按 goalTitle 取，两个「同名项目」会拿同一个值，这行红。
    expect(dots[0]?.style.backgroundColor).toBe("var(--color-tint-1)");
    expect(dots[1]?.style.backgroundColor).toBe("var(--color-tint-7)");
    await unmount(root);
  });

  it("查不到项目色时不画圆点（不留一个继承色的隐形点）", async () => {
    const { host, root } = await renderSection({
      groups: [group({ goalId: "g1", goalTitle: "无色项目" })],
      projectTints: new Map(),
    });
    expect(host.querySelector('[data-testid="project-group"] [data-project-dot]')).toBeNull();
    // 组本身照常渲染，只是没有圆点
    expect(host.textContent).toContain("无色项目");
    await unmount(root);
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
        metaChip={<ProjectNameChip chip={{ goalId: "g1", goalTitle: "装修", tint: "var(--color-tint-2)" }} onOpen={onOpen} />}
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

  it("圆点用 chip.tint，不自己按 goalId 取色", async () => {
    const { host, root } = await renderDom(
      <ProjectNameChip chip={{ goalId: "g1", goalTitle: "装修", tint: "var(--color-tint-6)" }} onOpen={vi.fn()} />,
    );
    const dot = host.querySelector("[data-project-dot]") as HTMLElement;
    expect(dot.style.backgroundColor).toBe("var(--color-tint-6)");
    await unmount(root);
  });

  it("tint 为空串时不画圆点，组名照常显示", async () => {
    const { host, root } = await renderDom(
      <ProjectNameChip chip={{ goalId: "g1", goalTitle: "装修", tint: "" }} onOpen={vi.fn()} />,
    );
    expect(host.querySelector("[data-project-dot]")).toBeNull();
    expect(host.textContent).toContain("装修");
    await unmount(root);
  });
});

describe("被挡徽章", () => {
  it("有被挡成员时标题行显示「N 条被挡」", async () => {
    const { host, root } = await renderDom(
      sectionElement({
        groups: [
          group({
            goalId: "g1",
            goalTitle: "装修",
            tasks: [task({ id: "t1" }), task({ id: "t2" }), task({ id: "t3" })],
            blockedByMember: new Map([["t1", ["挡路的"]], ["t2", ["挡路的"]]]),
          }),
        ],
      }),
    );
    const badge = host.querySelector('[data-testid="project-blocked-badge"]');
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toContain("2 条被挡");
    await unmount(root);
  });

  it("零被挡时不显示被挡徽章", async () => {
    const { host, root } = await renderDom(
      sectionElement({
        groups: [group({ goalId: "g1", tasks: [task({ id: "t1" })] })],
      }),
    );
    expect(host.querySelector('[data-testid="project-blocked-badge"]')).toBeNull();
    expect(host.textContent).not.toContain("被挡");
    await unmount(root);
  });

  it("被挡徽章独立显示（下一步徽章已退役）", async () => {
    const { host, root } = await renderDom(
      sectionElement({
        groups: [
          group({
            goalId: "g1",
            goalTitle: "装修",
            tasks: [task({ id: "t1", title: "刷墙" }), task({ id: "t2", title: "接线" })],
            blockedByMember: new Map([["t2", ["挡路的"]]]),
          }),
        ],
      }),
    );
    expect(host.querySelector('[data-testid="project-next-badge"]')).toBeNull();
    expect(host.querySelector('[data-testid="project-blocked-badge"]')?.textContent).toContain("1 条被挡");
    await unmount(root);
  });
});

describe("展开态：能动的 / 被挡着的", () => {
  // 组内顺序的真相在 sortProjectMembers，所以这里**必须真的调它**排一遍再传进组件——
  // 夹具里手工把被挡的写在后面的话，把沉底删掉这条用例也不会红，就是个假闸。
  function sortedGroup(tasks: Task[], blockedByMember: ReadonlyMap<string, string[]>) {
    return group({
      goalId: "g1",
      goalTitle: "装修",
      tasks: sortProjectMembers(tasks, { handSessionId: null, now: NOW, blockedIds: new Set(blockedByMember.keys()) }),
      blockedByMember,
    });
  }

  it("下一步徽章已退役——沉底后也不再推荐（退役守卫）", async () => {
    const { host, root } = await renderDom(
      sectionElement({
        groups: [
          sortedGroup(
            [task({ id: "blocked", title: "刷墙" }), task({ id: "free", title: "买漆" })],
            new Map([["blocked", ["等水电"]]]),
          ),
        ],
      }),
    );
    expect(host.querySelector('[data-testid="project-next-badge"]')).toBeNull();
    expect(host.textContent).not.toContain("下一步");
    await unmount(root);
  });

  // 退役守卫：整组全被挡时下一步徽章恒不存在
  it("整组全被挡时下一步徽章依然不存在（退役守卫）", async () => {
    const { host, root } = await renderDom(
      sectionElement({
        groups: [
          sortedGroup(
            [task({ id: "b1", title: "刷墙" }), task({ id: "b2", title: "贴砖" })],
            new Map([
              ["b1", ["等水电"]],
              ["b2", ["等水电"]],
            ]),
          ),
        ],
      }),
    );
    expect(host.querySelector('[data-testid="project-next-badge"]')).toBeNull();
    await unmount(root);
  });

  it("被挡成员带「等 XX」胶囊，能动的成员不带", async () => {
    const { host, root } = await renderDom(
      sectionElement({
        groups: [
          sortedGroup(
            [task({ id: "free", title: "买漆" }), task({ id: "blocked", title: "刷墙" })],
            new Map([["blocked", ["等水电"]]]),
          ),
        ],
      }),
    );
    await click(host.querySelector('[data-testid="project-group-toggle"]'));
    const chips = [...host.querySelectorAll('[data-testid="project-blocker-chip"]')];
    expect(chips).toHaveLength(1);
    expect(chips[0]?.textContent).toContain("等水电");
    await unmount(root);
  });

  it("首个被挡成员画分界线；一条都没被挡时整组不画线", async () => {
    const withBlocked = await renderDom(
      sectionElement({
        groups: [
          sortedGroup(
            [task({ id: "free", title: "买漆" }), task({ id: "blocked", title: "刷墙" })],
            new Map([["blocked", ["等水电"]]]),
          ),
        ],
      }),
    );
    await click(withBlocked.host.querySelector('[data-testid="project-group-toggle"]'));
    expect(withBlocked.host.querySelectorAll('[data-blocked-boundary="true"]')).toHaveLength(1);
    await unmount(withBlocked.root);

    const clean = await renderDom(
      sectionElement({ groups: [sortedGroup([task({ id: "free", title: "买漆" })], new Map())] }),
    );
    await click(clean.host.querySelector('[data-testid="project-group-toggle"]'));
    expect(clean.host.querySelector("[data-blocked-boundary]")).toBeNull();
    await unmount(clean.root);
  });

  // 组内 `+` 新建一次后 recentTaskIds 常驻非空，此后每次渲染都走 displayProjectTasks 的**重排**路径。
  // 那条路径必须把 blockedIds 一起传下去，否则这次排序会把 listTasks 已经做好的沉底洗掉。
  // 终审 L2 变异证实：拿掉那个参数，TodoProjectSection + TodoPage 共 233 条用例全绿——本条就是那道闸。
  it("组内新建之后重排仍守沉底：被挡且在手头的成员不会被洗回线以上", async () => {
    const HAND = "sess-1";
    const blockedAtHand = task({ id: "blocked", title: "刷墙", sessionId: HAND });
    const free = task({ id: "free", title: "买漆" });
    const blockedByMember = new Map([["blocked", ["等水电"]]]);
    const { host, root } = await renderSection({
      handSessionId: HAND,
      onCreateTask: vi.fn(async () => task({ id: "created", title: "新建的" })),
      groups: [
        group({
          goalId: "g1",
          goalTitle: "装修",
          // 传进来的就是 listTasks 排好的序：能动的在前、被挡的沉底（哪怕它在手头）。
          tasks: sortProjectMembers([blockedAtHand, free], {
            handSessionId: HAND,
            now: NOW,
            blockedIds: new Set(blockedByMember.keys()),
          }),
          blockedByMember,
        }),
      ],
    });
    await click(host.querySelector('[data-testid="project-group-toggle"]'));
    const rowTitles = () =>
      [...host.querySelectorAll('[data-goal-id="g1"] [aria-label^="打开 "]')].map((el) => el.getAttribute("aria-label") ?? "");
    const titlesBefore = rowTitles();
    expect(titlesBefore[0]).toContain("买漆");

    // 走一次真实的 `+` 新建，把 recentTaskIds 灌成非空。
    await click(host.querySelector('button[aria-label="在项目 装修中创建任务"]'));
    const input = host.querySelector('input[aria-label="在项目 装修中新建任务"]') as HTMLInputElement;
    await act(async () => {
      setInputValue(input, "新建的");
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });

    const titlesAfter = rowTitles();
    // 洗掉沉底的话，在手头的「刷墙」会跳到第一位（MEMBER_SORT_RANK 里 at-hand 最靠前）。
    expect(titlesAfter[0]).toContain("买漆");
    expect(titlesAfter[titlesAfter.length - 1]).toContain("刷墙");
    await unmount(root);
  });

  it("全部成员都被挡时不画线——没有「线以上」可分", async () => {
    const { host, root } = await renderDom(
      sectionElement({
        groups: [
          sortedGroup(
            [task({ id: "b1", title: "刷墙" }), task({ id: "b2", title: "贴砖" })],
            new Map([
              ["b1", ["等水电"]],
              ["b2", ["等水电"]],
            ]),
          ),
        ],
      }),
    );
    await click(host.querySelector('[data-testid="project-group-toggle"]'));
    expect(host.querySelector("[data-blocked-boundary]")).toBeNull();
    await unmount(root);
  });
});

describe("TodoProjectSection 切片新增", () => {
  const gravityEnabled = {
    enabled: true,
    waterlineDays: 14,
    weightStepDays: 7,
    graceDays: 7,
    drawM: 5,
    pickN: 1,
  };
  function oldTask(id: string, title: string, overrides: Partial<Task> = {}): Task {
    return task({
      id,
      title,
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
      ...overrides,
    } as Partial<Task> & Pick<Task, "id">);
  }
  function freshTask(id: string, title: string, overrides: Partial<Task> = {}): Task {
    return task({
      id,
      title,
      createdAt: "2026-07-24T00:00:00.000Z",
      updatedAt: "2026-07-24T10:00:00.000Z",
      ...overrides,
    } as Partial<Task> & Pick<Task, "id">);
  }

  it("在飞插槽：projectTrackRows 返回 null 时不渲染标题", async () => {
    const { host, root } = await renderDom(
      sectionElement({
        groups: [group({ goalId: "g1", tasks: [task({ id: "t1", title: "刷墙" })] })],
        projectTrackRows: () => null,
        gravitySettings: gravityEnabled,
      }),
    );
    await click(host.querySelector('[data-testid="project-group-toggle"]'));
    expect(host.textContent).not.toContain("在飞的线");
    await unmount(root);
  });

  it("在飞插槽：返回节点时渲染内容（标题由 ProjectTrackRows 负责）", async () => {
    const { host, root } = await renderDom(
      sectionElement({
        groups: [group({ goalId: "g1", tasks: [task({ id: "t1", title: "刷墙" })] })],
        projectTrackRows: (goalId: string) => (goalId === "g1" ? (<span data-testid="probe-track">轨道行</span>) : null),
        gravitySettings: gravityEnabled,
      }),
    );
    await click(host.querySelector('[data-testid="project-group-toggle"]'));
    // 标题已内移到 ProjectTrackRows，此处仅验证透传节点渲染，不再由 TodoProjectSection 渲染标题
    expect(host.querySelector('[data-testid="probe-track"]')).not.toBeNull();
    expect(host.textContent).not.toContain("在飞的线");
    await unmount(root);
  });

  it("水下切分：沉任务进尾，主列表不直接出现", async () => {
    const fresh = freshTask("fresh", "新鲜");
    const sunken = oldTask("sunken", "陈年");
    const { host, root } = await renderDom(
      sectionElement({
        groups: [group({ goalId: "g1", tasks: [fresh, sunken] })],
        gravitySettings: gravityEnabled,
      }),
    );
    await click(host.querySelector('[data-testid="project-group-toggle"]'));
    const visibleLabels = [...host.querySelectorAll('[aria-label^="打开 "]')].map((el) => el.getAttribute("aria-label"));
    expect(visibleLabels.some((l) => l?.includes("新鲜"))).toBe(true);
    expect(visibleLabels.some((l) => l?.includes("陈年"))).toBe(false);
    expect(host.textContent).toContain("水下 · 1");
    await unmount(root);
  });

  it("水下切分：被挡且老的成员豁免沉降", async () => {
    const fresh = freshTask("fresh", "新鲜");
    const blockedOld = oldTask("blocked", "被挡老活");
    const { host, root } = await renderDom(
      sectionElement({
        groups: [
          group({
            goalId: "g1",
            tasks: [fresh, blockedOld],
            blockedByMember: new Map([["blocked", ["等水电"]]]),
          }),
        ],
        gravitySettings: gravityEnabled,
      }),
    );
    await click(host.querySelector('[data-testid="project-group-toggle"]'));
    const visibleLabels = [...host.querySelectorAll('[aria-label^="打开 "]')].map((el) => el.getAttribute("aria-label"));
    expect(visibleLabels.some((l) => l?.includes("被挡老活"))).toBe(true);
    // 被挡老活豁免，不应计入水下
    expect(host.textContent).not.toContain("水下");
    await unmount(root);
  });

  it("水下尾默认收起，点开后渲染沉任务", async () => {
    const fresh = freshTask("fresh", "新鲜");
    const sunken = oldTask("sunken", "陈年2");
    const { host, root } = await renderDom(
      sectionElement({
        groups: [group({ goalId: "g1", tasks: [fresh, sunken] })],
        gravitySettings: gravityEnabled,
      }),
    );
    await click(host.querySelector('[data-testid="project-group-toggle"]'));
    expect(host.textContent).not.toContain("陈年2");
    const toggle = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("水下 ·"));
    expect(toggle).not.toBeUndefined();
    await click(toggle!);
    expect(host.textContent).toContain("陈年2");
    const expandedBtn = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("收起水下"));
    expect(expandedBtn).not.toBeUndefined();
    await unmount(root);
  });

  it("水下尾顶一下回调", async () => {
    const fresh = freshTask("fresh", "新鲜");
    const sunken = oldTask("sunken", "陈年顶");
    const onBumpTask = vi.fn();
    const { host, root } = await renderDom(
      sectionElement({
        groups: [group({ goalId: "g1", tasks: [fresh, sunken] })],
        gravitySettings: gravityEnabled,
        onBumpTask,
      }),
    );
    await click(host.querySelector('[data-testid="project-group-toggle"]'));
    const toggle = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("水下"));
    await click(toggle!);
    const bump = host.querySelector('[aria-label="顶一下 陈年顶"]') as HTMLElement | null;
    expect(bump).not.toBeNull();
    await click(bump!);
    expect(onBumpTask).toHaveBeenCalledTimes(1);
    expect(onBumpTask).toHaveBeenCalledWith(expect.objectContaining({ id: "sunken" }));
    await unmount(root);
  });

  it("徽章消失：不再渲染 project-next-badge", async () => {
    const { host, root } = await renderDom(
      sectionElement({
        groups: [group({ goalId: "g1", tasks: [task({ id: "t1", title: "任务A" })] })],
        gravitySettings: gravityEnabled,
      }),
    );
    expect(host.querySelector('[data-testid="project-next-badge"]')).toBeNull();
    await click(host.querySelector('[data-testid="project-group-toggle"]'));
    expect(host.querySelector('[data-testid="project-next-badge"]')).toBeNull();
    await unmount(root);
  });

  it("升格按钮渲染与回调", async () => {
    const onPromoteToTrack = vi.fn();
    const member = freshTask("t1", "要升格");
    const { host, root } = await renderDom(
      sectionElement({
        groups: [group({ goalId: "g1", tasks: [member] })],
        gravitySettings: gravityEnabled,
        onPromoteToTrack,
      }),
    );
    await click(host.querySelector('[data-testid="project-group-toggle"]'));
    const btn = host.querySelector('[aria-label="升格为轨道 要升格"]') as HTMLElement | null;
    expect(btn).not.toBeNull();
    await click(btn!);
    expect(onPromoteToTrack).toHaveBeenCalledTimes(1);
    expect(onPromoteToTrack).toHaveBeenCalledWith(expect.objectContaining({ id: "t1" }));
    await unmount(root);
  });

  it("未传 onPromoteToTrack 时不渲染升格按钮", async () => {
    const member = freshTask("t1", "要升格");
    const { host, root } = await renderDom(
      sectionElement({
        groups: [group({ goalId: "g1", tasks: [member] })],
        gravitySettings: gravityEnabled,
      }),
    );
    await click(host.querySelector('[data-testid="project-group-toggle"]'));
    expect(host.querySelector('[aria-label^="升格为轨道"]')).toBeNull();
    // 退出按钮仍在
    expect(host.querySelector('[aria-label="退出项目 要升格"]')).not.toBeNull();
    await unmount(root);
  });

  it("aboveWater 的被挡分界仍在（水下不影响）", async () => {
    const freshFree = freshTask("free", "自由");
    const blocked = freshTask("blocked", "被挡");
    const sunken = oldTask("sunken", "陈年不影响");
    const blockedByMember = new Map([["blocked", ["等水电"]]]);
    const sortedTasks = sortProjectMembers([freshFree, blocked, sunken], {
      handSessionId: null,
      now: new Date("2026-07-25T10:00:00.000Z"),
      blockedIds: new Set(["blocked"]),
    });
    const sorted = group({
      goalId: "g1",
      goalTitle: "装修",
      tasks: sortedTasks,
      blockedByMember,
    });
    const { host, root } = await renderDom(
      sectionElement({
        groups: [sorted],
        gravitySettings: gravityEnabled,
        now: new Date("2026-07-25T10:00:00.000Z"),
      }),
    );
    await click(host.querySelector('[data-testid="project-group-toggle"]'));
    // aboveWater 中 blocked 仍在，分界线应存在
    expect(host.querySelectorAll('[data-blocked-boundary="true"]')).toHaveLength(1);
    await unmount(root);
  });

  it("升格与退出按钮并存且顺序正确（升格在前）", async () => {
    const onPromoteToTrack = vi.fn();
    const member = freshTask("t1", "并存");
    const { host, root } = await renderDom(
      sectionElement({
        groups: [group({ goalId: "g1", tasks: [member] })],
        gravitySettings: gravityEnabled,
        onPromoteToTrack,
      }),
    );
    await click(host.querySelector('[data-testid="project-group-toggle"]'));
    const row = host.querySelector('[data-goal-id="g1"]');
    const promoteIndex = [...(row?.querySelectorAll("button") ?? [])].findIndex((b) => b.getAttribute("aria-label")?.startsWith("升格为轨道"));
    const exitIndex = [...(row?.querySelectorAll("button") ?? [])].findIndex((b) => b.getAttribute("aria-label")?.startsWith("退出项目"));
    expect(promoteIndex).toBeGreaterThan(-1);
    expect(exitIndex).toBeGreaterThan(-1);
    expect(promoteIndex).toBeLessThan(exitIndex);
    await unmount(root);
  });

  it("filterActive 时跳过沉降：沉员全部进主列表、标题 1 项匹配、无水下尾", async () => {
    const sunken = oldTask("sunken1", "陈年沉员");
    const { host, root } = await renderDom(
      sectionElement({
        groups: [group({ goalId: "g1", goalTitle: "装修", tasks: [sunken] })],
        filterActive: true,
        gravitySettings: gravityEnabled,
      }),
    );
    // filterActive 强制展开，无需点击
    expect(host.textContent).toContain("1 项匹配");
    expect(host.textContent).toContain("陈年沉员");
    expect(host.textContent).not.toContain("水下");
    const visibleLabels = [...host.querySelectorAll('[aria-label^="打开 "]')].map((el) => el.getAttribute("aria-label"));
    expect(visibleLabels.some((l) => l?.includes("陈年沉员"))).toBe(true);
    await unmount(root);
  });

  it("水下展开后清空再新增沉员应回到收起", async () => {
    const fresh = freshTask("fresh", "新鲜");
    const sunken = oldTask("sunken", "陈年");
    const sunken2 = oldTask("sunken2", "陈年2");
    const g = group({ goalId: "g1", tasks: [fresh, sunken] });
    const element = (groups: TodoProjectGroup[]) =>
      sectionElement({
        groups,
        gravitySettings: gravityEnabled,
      });
    const { host, root } = await renderDom(element([g]));
    await click(host.querySelector('[data-testid="project-group-toggle"]'));
    const toggle = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("水下 ·"));
    expect(toggle).not.toBeUndefined();
    await click(toggle!);
    expect(host.textContent).toContain("陈年");
    // 清空 sunken
    await act(async () => root.render(element([group({ goalId: "g1", tasks: [fresh] })])));
    expect(host.textContent).not.toContain("水下");
    // 再传新沉员
    await act(async () => root.render(element([group({ goalId: "g1", tasks: [fresh, sunken2] })])));
    const newToggle = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("水下"));
    expect(newToggle?.textContent).toContain("水下 · 1");
    expect(newToggle?.textContent).not.toContain("收起水下");
    expect(host.textContent).not.toContain("陈年2");
    await unmount(root);
  });
});

describe("沉睡项目段", () => {
  it("全部组沉睡时主列表 header 计数为 0 且组都在沉睡折叠段内", async () => {
    const g1 = group({ goalId: "g1", goalTitle: "项目一", tasks: [task({ id: "t1", title: "任务一" })] });
    const g2 = group({ goalId: "g2", goalTitle: "项目二", tasks: [task({ id: "t2", title: "任务二" })] });
    const dormantGoalIds = new Set<string>(["g1", "g2"]);
    const { host, root } = await renderDom(
      sectionElement({
        groups: [g1, g2],
        hasActiveProjects: true,
        gravitySettings: { ...DEFAULT_TODO_GRAVITY_SETTINGS, enabled: false },
        dormantGoalIds,
      }),
    );
    // 主列表 header 计数为 0（全部在沉睡段）
    const headerCount = host.querySelector('[data-section="todo-projects"] > div > span')?.textContent ?? "";
    expect(headerCount).toBe("0");
    // 折叠段存在但默认收起，组不在主列表直接可见
    const dormantSection = host.querySelector('[data-testid="dormant-projects-section"]');
    expect(dormantSection).not.toBeNull();
    expect(dormantSection?.textContent).toContain("沉睡项目 · 2");
    // 主列表的项目组在未展开沉睡段时不应直接可见（仍折叠）
    expect(host.querySelectorAll('[data-testid="project-group"]')).toHaveLength(0);
    // 展开沉睡段后两组出现
    const toggle = host.querySelector('[data-testid="dormant-projects-toggle"]') as HTMLElement;
    await click(toggle);
    const groups = host.querySelectorAll('[data-testid="project-group"]');
    expect(groups).toHaveLength(2);
    expect(host.textContent).toContain("项目一");
    expect(host.textContent).toContain("项目二");
    await unmount(root);
  });

  it("dormantGoalIds 空时不渲染折叠段", async () => {
    const g1 = group({ goalId: "g1", goalTitle: "项目一", tasks: [task({ id: "t1" })] });
    const { host, root } = await renderDom(
      sectionElement({
        groups: [g1],
        gravitySettings: { ...DEFAULT_TODO_GRAVITY_SETTINGS, enabled: false },
        dormantGoalIds: new Set<string>(),
      }),
    );
    expect(host.querySelector('[data-testid="dormant-projects-section"]')).toBeNull();
    // 主列表仍显示该组 header 计数 1
    const headerCount = host.querySelector('[data-section="todo-projects"] > div > span')?.textContent ?? "";
    expect(headerCount).toBe("1");
    await unmount(root);
  });
});

describe("边界用例包", () => {
  it("全被挡组不画分界线（无 divider）", async () => {
    const t1 = task({ id: "b1", title: "被挡1" });
    const t2 = task({ id: "b2", title: "被挡2" });
    const blockedByMember = new Map<string, string[]>([
      ["b1", ["等水电"]],
      ["b2", ["等水电"]],
    ]);
    const sorted = sortProjectMembers([t1, t2], { handSessionId: null, now: NOW, blockedIds: new Set(blockedByMember.keys()) });
    const g = group({ goalId: "g1", goalTitle: "全被挡组", tasks: sorted, blockedByMember });
    const { host, root } = await renderDom(
      sectionElement({
        groups: [g],
        gravitySettings: { ...DEFAULT_TODO_GRAVITY_SETTINGS, enabled: false },
      }),
    );
    await click(host.querySelector('[data-testid="project-group-toggle"]'));
    expect(host.querySelector("[data-blocked-boundary]")).toBeNull();
    expect(host.querySelectorAll('[data-testid="project-blocker-chip"]')).toHaveLength(2);
    await unmount(root);
  });

  it("水下 0 条不渲染尾按钮", async () => {
    const fresh = task({
      id: "fresh",
      title: "新鲜活",
      createdAt: "2026-07-24T00:00:00.000Z",
      updatedAt: "2026-07-24T10:00:00.000Z",
    });
    const g = group({ goalId: "g1", tasks: [fresh] });
    const { host, root } = await renderDom(
      sectionElement({
        groups: [g],
        gravitySettings: { ...DEFAULT_TODO_GRAVITY_SETTINGS, enabled: true, waterlineDays: 14, weightStepDays: 7, graceDays: 7, drawM: 5, pickN: 1 },
      }),
    );
    await click(host.querySelector('[data-testid="project-group-toggle"]'));
    // 无沉任务时不应渲染水下尾按钮
    expect(host.textContent).not.toContain("水下");
    expect([...host.querySelectorAll("button")].some((b) => b.textContent?.includes("水下"))).toBe(false);
    await unmount(root);
  });
});
