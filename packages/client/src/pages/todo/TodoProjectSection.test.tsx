// @vitest-environment jsdom

import { DndContext } from "@dnd-kit/core";
import type { Task } from "@timedata/shared";
import { act } from "react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TodoProjectGroup } from "../../lib/tasks/goalMembership.js";
import { GOAL_MEMBERS_MAX } from "../../lib/tasks/goalMembership.js";
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
        {...handlers}
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
    expect(host.textContent).not.toContain("刷墙");

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
      expect(host.textContent).not.toContain("设计方案");
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
      expect(host.textContent).not.toContain("设计方案");
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

  it("组内的行不渲染拖柄：项目区不注册 draggable，同一 taskId 不会在页面里被登记两次", async () => {
    const { host, root } = await renderWithDnd({
      groups: [group({ goalId: "g1", tasks: [task({ id: "t1" })] })],
    });
    // 必须显式展开：折叠态下压根没有行，`toBeNull()` 会恒真——这条守的是「展开后也没有拖柄」。
    await click(host.querySelector('[data-testid="project-group-toggle"]'));
    expect(host.querySelector('[data-testid="task-row-grab-area"]')).toBeNull();
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
