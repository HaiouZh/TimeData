// @vitest-environment jsdom
import { act, createElement } from "react";
import { beforeEach, describe, expect, it } from "vitest";
// dbReset 必须排在一切会拉 db/index.js 的 import 之前（unit 桶不预装 fake-indexeddb，
// Dexie 在构造时即捕获 globalThis.indexedDB，顺序错了会 MissingAPIError）。
import { db, resetDb } from "../../test/dbReset.js";
import { addTask, toggleTaskDone } from "../../lib/tasks.js";
import type { Goal } from "@timedata/shared";
import { addTaskRelation } from "../../lib/taskRelations.js";
import { occurrenceChildId } from "../../lib/tasks/occurrenceChildId.js";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import { TaskWaitingRow } from "./TaskWaitingRow.js";

beforeEach(async () => {
  await resetDb();
});

async function renderRow(taskId: string) {
  const { host, root } = await renderDom(createElement(TaskWaitingRow, { taskId }));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return { host, root };
}

describe("TaskWaitingRow", () => {
  it("没有前置时显示空态与添加入口", async () => {
    const t = await addTask({ title: "贴砖" });
    const { host, root } = await renderRow(t.id);
    const row = host.querySelector('[data-testid="task-waiting-row"]');
    expect(row?.textContent).toContain("在等");
    expect(host.querySelector('button[aria-label="添加前置"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="task-waiting-blocker"]')).toBeNull();
    await unmount(root);
  });

  it("有前置时列出每个 blocker 的标题", async () => {
    const a = await addTask({ title: "批腻子" });
    const b = await addTask({ title: "贴砖" });
    await addTaskRelation({ blocker: { kind: "task", id: a.id }, blocked: { kind: "task", id: b.id } });
    const { host, root } = await renderRow(b.id);
    const blockers = host.querySelectorAll('[data-testid="task-waiting-blocker"]');
    expect(blockers).toHaveLength(1);
    expect(blockers[0]?.textContent).toContain("批腻子");
    await unmount(root);
  });

  it("点添加后可选任务并写入关系", async () => {
    const a = await addTask({ title: "批腻子" });
    const b = await addTask({ title: "贴砖" });
    const { host, root } = await renderRow(b.id);
    await click(host.querySelector('button[aria-label="添加前置"]'));
    const candidate = host.querySelector('button[aria-label="添加前置 批腻子"]');
    expect(candidate).not.toBeNull();
    await click(candidate);
    const rows = await db.taskRelations.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ blockerKind: "task", blockerId: a.id, blockedKind: "task", blockedId: b.id });
    await unmount(root);
  });

  it("选择器不列出已经是前置的任务", async () => {
    const existing = await addTask({ title: "批腻子" });
    const blocked = await addTask({ title: "贴砖" });
    await addTask({ title: "装踢脚线" });
    await addTaskRelation({ blocker: { kind: "task", id: existing.id }, blocked: { kind: "task", id: blocked.id } });
    const { host, root } = await renderRow(blocked.id);

    await click(host.querySelector('button[aria-label="添加前置"]'));

    expect(host.querySelector('button[aria-label="添加前置 装踢脚线"]')).not.toBeNull();
    expect(host.querySelector('button[aria-label="添加前置 批腻子"]')).toBeNull();
    await unmount(root);
  });

  it("点移除后关系被删除", async () => {
    const a = await addTask({ title: "批腻子" });
    const b = await addTask({ title: "贴砖" });
    await addTaskRelation({ blocker: { kind: "task", id: a.id }, blocked: { kind: "task", id: b.id } });
    const { host, root } = await renderRow(b.id);
    await click(host.querySelector('button[aria-label="移除前置 批腻子"]'));
    expect(await db.taskRelations.count()).toBe(0);
    await unmount(root);
  });

  it("选中会成环的目标时给出提示且不写入", async () => {
    const a = await addTask({ title: "批腻子" });
    const b = await addTask({ title: "贴砖" });
    await addTaskRelation({ blocker: { kind: "task", id: a.id }, blocked: { kind: "task", id: b.id } });
    const { host, root } = await renderRow(a.id);
    await click(host.querySelector('button[aria-label="添加前置"]'));
    const candidate = host.querySelector('button[aria-label="添加前置 贴砖"]');
    expect(candidate).not.toBeNull();
    await click(candidate);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(host.textContent).toContain("绕成圈");
    expect(host.textContent).toContain("贴砖");
    expect(await db.taskRelations.count()).toBe(1);
    await unmount(root);
  });

  // 上一条用例的两个 toContain 都读 host.textContent，而添加失败时候选列表**仍开着**——
  // 「贴砖」是被那个候选按钮满足的，错误文案本身从没被断言过。终审三条镜头独立抓到：
  // cycleBlameTitle 当时被喂了入边（listRelationsBlocking），BFS 一步走不出去、恒返回「（已删除）」，
  // 而用例照样绿。下面两条改读 task-waiting-error 那个节点，把点名钉死。
  it("成环提示点名造成环的那一条（直接互挡）", async () => {
    const a = await addTask({ title: "批腻子" });
    const b = await addTask({ title: "贴砖" });
    await addTaskRelation({ blocker: { kind: "task", id: a.id }, blocked: { kind: "task", id: b.id } });
    const { host, root } = await renderRow(a.id);
    await click(host.querySelector('button[aria-label="添加前置"]'));
    await click(host.querySelector('button[aria-label="添加前置 贴砖"]'));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const message = host.querySelector('[data-testid="task-waiting-error"]')?.textContent ?? "";
    expect(message).toContain("绕成圈");
    expect(message).toContain("贴砖"); // a 挡着贴砖，所以贴砖正是「已经在等这条」的那一方
    expect(message).not.toContain("已删除");
    await unmount(root);
  });

  it("成环提示点名的是路径首跳，不是候选本身", async () => {
    // a 挡 b、b 挡 c。在 a 的详情里把 c 加成 a 的前置 → a 等 c、c 等 b、b 等 a，成环。
    // 直接等着 a 的是 b（首跳），不是候选 c——写候选就会说假话。
    const a = await addTask({ title: "批腻子" });
    const b = await addTask({ title: "贴砖" });
    const c = await addTask({ title: "装踢脚线" });
    await addTaskRelation({ blocker: { kind: "task", id: a.id }, blocked: { kind: "task", id: b.id } });
    await addTaskRelation({ blocker: { kind: "task", id: b.id }, blocked: { kind: "task", id: c.id } });
    const { host, root } = await renderRow(a.id);
    await click(host.querySelector('button[aria-label="添加前置"]'));
    await click(host.querySelector('button[aria-label="添加前置 装踢脚线"]'));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const message = host.querySelector('[data-testid="task-waiting-error"]')?.textContent ?? "";
    expect(message).toContain("贴砖");
    expect(message).not.toContain("装踢脚线");
    expect(await db.taskRelations.count()).toBe(2);
    await unmount(root);
  });

  it("已完成的前置标出「已完成」，不再读作还在挡着", async () => {
    const a = await addTask({ title: "批腻子" });
    const b = await addTask({ title: "贴砖" });
    await addTaskRelation({ blocker: { kind: "task", id: a.id }, blocked: { kind: "task", id: b.id } });
    await toggleTaskDone(a.id);
    const { host, root } = await renderRow(b.id);
    const blocker = host.querySelector('[data-testid="task-waiting-blocker"]');
    expect(blocker?.textContent).toContain("批腻子");
    expect(blocker?.textContent).toContain("已完成");
    await unmount(root);
  });

  it("选择器不列出已完成的任务", async () => {
    const done = await addTask({ title: "已完成的前置" });
    await toggleTaskDone(done.id);
    const b = await addTask({ title: "贴砖" });
    const { host, root } = await renderRow(b.id);
    await click(host.querySelector('button[aria-label="添加前置"]'));
    expect(host.querySelector('button[aria-label="添加前置 已完成的前置"]')).toBeNull();
    await unmount(root);
  });

  it("选择器不列出自己", async () => {
    const t = await addTask({ title: "我自己" });
    const { host, root } = await renderRow(t.id);
    await click(host.querySelector('button[aria-label="添加前置"]'));
    expect(host.querySelector('button[aria-label="添加前置 我自己"]')).toBeNull();
    await unmount(root);
  });
});

describe("TaskWaitingRow picker 修复（过滤/搜索/上下文）", () => {
  const now = "2026-07-01T00:00:00.000Z";

  function setInputValue(input: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  it("occurrence 候选（ruleId 非空的同名发）不出现在候选列表", async () => {
    const self = await addTask({ title: "自己" });
    const normal = await addTask({ title: "同名任务" });
    // occurrence：同名但带 ruleId，应被滤掉
    await db.tasks.add({
      id: "occ-1",
      parentId: null,
      title: "同名任务",
      done: false,
      recurrence: null,
      lastDoneAt: null,
      startAt: null,
      scheduledAt: null,
      completedCount: 0,
      weight: 0,
      completedAt: null,
      tags: [],
      ruleId: "rule-1",
      sessionId: null,
      skipped: false,
      sortOrder: 99,
      createdAt: now,
      updatedAt: now,
    });
    const { host, root } = await renderRow(self.id);
    await click(host.querySelector('button[aria-label="添加前置"]'));
    // 只有一个“同名任务”候选（normal），occurrence 被滤掉，按钮只出现一次
    const buttons = host.querySelectorAll('button[aria-label="添加前置 同名任务"]');
    expect(buttons.length).toBe(1);
    // 再确认 occurrence 单独时不出现：清空后只剩 occurrence 标题的测试
    await unmount(root);
    await resetDb();
    const self2 = await addTask({ title: "自己2" });
    await db.tasks.add({
      id: "occ-only",
      parentId: null,
      title: "发次独有标题",
      done: false,
      recurrence: null,
      lastDoneAt: null,
      startAt: null,
      scheduledAt: null,
      completedCount: 0,
      weight: 0,
      completedAt: null,
      tags: [],
      ruleId: "rule-1",
      sessionId: null,
      skipped: false,
      sortOrder: 0,
      createdAt: now,
      updatedAt: now,
    });
    const rendered2 = await renderRow(self2.id);
    await click(rendered2.host.querySelector('button[aria-label="添加前置"]'));
    expect(rendered2.host.querySelector('button[aria-label="添加前置 发次独有标题"]')).toBeNull();
    expect(normal.title).toBe("同名任务");
    await unmount(rendered2.root);
  });

  it("重复模板（recurrence 非空）不出现在候选列表", async () => {
    const self = await addTask({ title: "自己" });
    await addTask({ title: "普通候选" });
    await db.tasks.add({
      id: "tmpl-1",
      parentId: null,
      title: "模板任务",
      done: false,
      recurrence: { freq: "daily", interval: 1, basis: "due" } as never,
      lastDoneAt: null,
      startAt: now,
      scheduledAt: null,
      completedCount: 0,
      weight: 0,
      completedAt: null,
      tags: [],
      ruleId: null,
      sessionId: null,
      skipped: false,
      sortOrder: 10,
      createdAt: now,
      updatedAt: now,
    });
    const { host, root } = await renderRow(self.id);
    await click(host.querySelector('button[aria-label="添加前置"]'));
    expect(host.querySelector('button[aria-label="添加前置 模板任务"]')).toBeNull();
    expect(host.querySelector('button[aria-label="添加前置 普通候选"]')).not.toBeNull();
    await unmount(root);
  });

  it("搜索框按标题过滤候选（大小写不敏感）", async () => {
    const self = await addTask({ title: "自己" });
    await addTask({ title: "Alpha Task" });
    await addTask({ title: "beta task" });
    const { host, root } = await renderRow(self.id);
    await click(host.querySelector('button[aria-label="添加前置"]'));
    const input = host.querySelector('input[aria-label="搜索前置候选"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.placeholder).toBe("搜索…");
    await act(async () => {
      setInputValue(input, "ALPHA");
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(host.querySelector('button[aria-label="添加前置 Alpha Task"]')).not.toBeNull();
    expect(host.querySelector('button[aria-label="添加前置 beta task"]')).toBeNull();
    await unmount(root);
  });

  it("清空搜索恢复全量候选", async () => {
    const self = await addTask({ title: "自己" });
    await addTask({ title: "Alpha Task" });
    await addTask({ title: "beta task" });
    const { host, root } = await renderRow(self.id);
    await click(host.querySelector('button[aria-label="添加前置"]'));
    const input = host.querySelector('input[aria-label="搜索前置候选"]') as HTMLInputElement;
    await act(async () => {
      setInputValue(input, "Alpha");
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(host.querySelector('button[aria-label="添加前置 beta task"]')).toBeNull();
    await act(async () => {
      setInputValue(input, "");
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(host.querySelector('button[aria-label="添加前置 Alpha Task"]')).not.toBeNull();
    expect(host.querySelector('button[aria-label="添加前置 beta task"]')).not.toBeNull();
    await unmount(root);
  });

  it("关闭重开 picker 时清空搜索框", async () => {
    const self = await addTask({ title: "自己" });
    await addTask({ title: "Alpha Task" });
    await addTask({ title: "beta task" });
    const { host, root } = await renderRow(self.id);
    await click(host.querySelector('button[aria-label="添加前置"]'));
    const input = host.querySelector('input[aria-label="搜索前置候选"]') as HTMLInputElement;
    await act(async () => {
      setInputValue(input, "Alpha");
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(host.querySelector('button[aria-label="添加前置 beta task"]')).toBeNull();
    // 关闭
    await click(host.querySelector('button[aria-label="添加前置"]'));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(host.querySelector('input[aria-label="搜索前置候选"]')).toBeNull();
    // 重开
    await click(host.querySelector('button[aria-label="添加前置"]'));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const input2 = host.querySelector('input[aria-label="搜索前置候选"]') as HTMLInputElement;
    expect(input2).not.toBeNull();
    expect(input2.value).toBe("");
    // 全量恢复
    expect(host.querySelector('button[aria-label="添加前置 Alpha Task"]')).not.toBeNull();
    expect(host.querySelector('button[aria-label="添加前置 beta task"]')).not.toBeNull();
    await unmount(root);
  });

  it("任务候选上下文：项目名优先于父标题与排期", async () => {
    const self = await addTask({ title: "自己" });
    const parent = await addTask({ title: "父标题A" });
    const candidate = await addTask({ title: "候选项目优" });
    await db.tasks.update(candidate.id, { parentId: parent.id, scheduledAt: "2026-07-20T12:00:00.000Z" });
    await db.goals.add({
      id: "g-proj",
      title: "项目A",
      kind: "project",
      status: "active",
      members: [{ kind: "task", id: candidate.id }],
      prerequisites: [],
      createdAt: now,
      updatedAt: now,
    } as never);
    const { host, root } = await renderRow(self.id);
    await click(host.querySelector('button[aria-label="添加前置"]'));
    const btn = host.querySelector(`button[aria-label="添加前置 ${candidate.title}"]`) as HTMLElement;
    expect(btn).not.toBeNull();
    expect(btn.textContent).toContain("项目A");
    // 父标题与日期不应出现，项目名已覆盖
    expect(btn.textContent).not.toContain("父标题A");
    await unmount(root);
  });

  it("任务候选上下文：无项目时显示父标题", async () => {
    const self = await addTask({ title: "自己" });
    const parent = await addTask({ title: "父标题B" });
    const candidate = await addTask({ title: "候选父优" });
    await db.tasks.update(candidate.id, { parentId: parent.id, scheduledAt: "2026-07-21T12:00:00.000Z" });
    const { host, root } = await renderRow(self.id);
    await click(host.querySelector('button[aria-label="添加前置"]'));
    const btn = host.querySelector(`button[aria-label="添加前置 ${candidate.title}"]`) as HTMLElement;
    expect(btn).not.toBeNull();
    expect(btn.textContent).toContain("父标题B");
    await unmount(root);
  });

  it("任务候选上下文：无项目无父时显示排期日期", async () => {
    const self = await addTask({ title: "自己" });
    const candidate = await addTask({ title: "候选排期" });
    const scheduledAt = "2026-07-22T12:00:00.000Z";
    await db.tasks.update(candidate.id, { scheduledAt });
    const d = new Date(scheduledAt);
    const expected = `${d.getMonth() + 1}月${d.getDate()}日`;
    const { host, root } = await renderRow(self.id);
    await click(host.querySelector('button[aria-label="添加前置"]'));
    const btn = host.querySelector(`button[aria-label="添加前置 ${candidate.title}"]`) as HTMLElement;
    expect(btn).not.toBeNull();
    expect(btn.textContent).toContain(expected);
    await unmount(root);
  });

  it("任务候选上下文为 null 时不渲染右列", async () => {
    const self = await addTask({ title: "自己", toInbox: true });
    const candidate = await addTask({ title: "候选无上下文", toInbox: true });
    const { host, root } = await renderRow(self.id);
    await click(host.querySelector('button[aria-label="添加前置"]'));
    const btn = host.querySelector(`button[aria-label="添加前置 ${candidate.title}"]`) as HTMLElement;
    expect(btn).not.toBeNull();
    // 右列是 shrink-0 td-text-caption，null 时不应存在
    expect(btn.querySelector("span.shrink-0")).toBeNull();
    expect(btn.textContent).toBe(candidate.title);
    await unmount(root);
  });

  it("轨道候选行不显示上下文列", async () => {
    const self = await addTask({ title: "自己" });
    await db.tracks.add({
      id: "track-ctx",
      title: "轨道候选",
      status: "active",
      refs: [],
      createdAt: now,
      updatedAt: now,
    } as never);
    const { host, root } = await renderRow(self.id);
    await click(host.querySelector('button[aria-label="添加前置"]'));
    const btn = host.querySelector('button[aria-label="添加前置 轨道候选"]') as HTMLElement;
    expect(btn).not.toBeNull();
    expect(btn.querySelector("span.shrink-0")).toBeNull();
    await unmount(root);
  });

  it("搜索框受控且占位文本正确，过滤对轨道同样生效", async () => {
    const self = await addTask({ title: "自己" });
    await db.tracks.add({
      id: "trA",
      title: "Zoom Sprint",
      status: "active",
      refs: [],
      createdAt: now,
      updatedAt: now,
    } as never);
    await db.tracks.add({
      id: "trB",
      title: "Alpha",
      status: "active",
      refs: [],
      createdAt: now,
      updatedAt: now,
    } as never);
    const { host, root } = await renderRow(self.id);
    await click(host.querySelector('button[aria-label="添加前置"]'));
    const input = host.querySelector('input[aria-label="搜索前置候选"]') as HTMLInputElement;
    await act(async () => {
      setInputValue(input, "alpha");
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(host.querySelector('button[aria-label="添加前置 Alpha"]')).not.toBeNull();
    expect(host.querySelector('button[aria-label="添加前置 Zoom Sprint"]')).toBeNull();
    await unmount(root);
  });

  it("同任务挂两组 → 上下文取先者（first-wins）", async () => {
    const self = await addTask({ title: "自己" });
    const parent = await addTask({ title: "父标题" });
    const candidate = await addTask({ title: "候选多组" });
    await db.goals.add({
      id: "g1",
      title: "项目A",
      kind: "project",
      status: "active",
      members: [{ kind: "task", id: candidate.id }],
      prerequisites: [],
      createdAt: now,
      updatedAt: now,
    } as never);
    await db.goals.add({
      id: "g2",
      title: "项目B",
      kind: "project",
      status: "active",
      members: [{ kind: "task", id: candidate.id }],
      prerequisites: [],
      createdAt: now,
      updatedAt: now,
    } as never);
    await db.tasks.update(candidate.id, { parentId: parent.id });
    const { host, root } = await renderRow(self.id);
    await click(host.querySelector('button[aria-label="添加前置"]'));
    const btn = host.querySelector(`button[aria-label="添加前置 ${candidate.title}"]`) as HTMLElement;
    expect(btn).not.toBeNull();
    expect(btn.textContent).toContain("项目A");
    expect(btn.textContent).not.toContain("项目B");
    await unmount(root);
  });

  it("空白标题组 → 回落父标题（跳过空白）", async () => {
    const self = await addTask({ title: "自己2" });
    const parent = await addTask({ title: "父标题B" });
    const candidate = await addTask({ title: "候选空白" });
    await db.goals.add({
      id: "g-blank",
      title: "   ",
      kind: "project",
      status: "active",
      members: [{ kind: "task", id: candidate.id }],
      prerequisites: [],
      createdAt: now,
      updatedAt: now,
    } as never);
    await db.tasks.update(candidate.id, { parentId: parent.id });
    const { host, root } = await renderRow(self.id);
    await click(host.querySelector('button[aria-label="添加前置"]'));
    const btn = host.querySelector(`button[aria-label="添加前置 ${candidate.title}"]`) as HTMLElement;
    expect(btn).not.toBeNull();
    expect(btn.textContent).toContain("父标题B");
    await unmount(root);
  });

  it("goal.members 为 null 时不崩且候选仍展示", async () => {
    const self = await addTask({ title: "自己" });
    const candidate = await addTask({ title: "候选正常", toInbox: true });
    await db.goals.add({
      id: "g-null",
      title: "异常项目",
      kind: "project",
      status: "active",
      members: null as unknown as Goal["members"],
      prerequisites: [],
      createdAt: now,
      updatedAt: now,
    } as unknown as Goal);
    const { host, root } = await renderRow(self.id);
    await click(host.querySelector('button[aria-label="添加前置"]'));
    // 脏数据不崩，候选正常展示且无项目上下文
    const btn = host.querySelector(`button[aria-label="添加前置 ${candidate.title}"]`) as HTMLElement;
    expect(btn).not.toBeNull();
    expect(btn.textContent).toBe(candidate.title);
    await unmount(root);
  });

  it("member 缺 kind 时不崩且不产生项目上下文", async () => {
    const self = await addTask({ title: "自己" });
    const candidate = await addTask({ title: "候选缺kind", toInbox: true });
    await db.goals.add({
      id: "g-bad",
      title: "异常项目2",
      kind: "project",
      status: "active",
      members: [{ id: candidate.id } as unknown as Goal["members"][number], { kind: "task", id: candidate.id }],
      prerequisites: [],
      createdAt: now,
      updatedAt: now,
    } as unknown as Goal);
    const { host, root } = await renderRow(self.id);
    await click(host.querySelector('button[aria-label="添加前置"]'));
    const btn = host.querySelector(`button[aria-label="添加前置 ${candidate.title}"]`) as HTMLElement;
    expect(btn).not.toBeNull();
    // 缺 kind 的成员应被跳过，但后一条合法成员仍产生上下文
    expect(btn.textContent).toContain("异常项目2");
    await unmount(root);
    // 完全脏 member（无 kind）单独时不崩
    await resetDb();
    const self2 = await addTask({ title: "自己3" });
    const cand2 = await addTask({ title: "候选2", toInbox: true });
    await db.goals.add({
      id: "g-bad2",
      title: "项目",
      kind: "project",
      status: "active",
      members: [{ id: cand2.id } as unknown as Goal["members"][number]],
      prerequisites: [],
      createdAt: now,
      updatedAt: now,
    } as unknown as Goal);
    const r2 = await renderRow(self2.id);
    await click(r2.host.querySelector('button[aria-label="添加前置"]'));
    const btn2 = r2.host.querySelector(`button[aria-label="添加前置 ${cand2.title}"]`) as HTMLElement;
    expect(btn2).not.toBeNull();
    expect(btn2.querySelector("span.shrink-0")).toBeNull();
    await unmount(r2.root);
  });

  it("轨道分组排在任务分组前面", async () => {
    const self = await addTask({ title: "自己" });
    await addTask({ title: "普通任务" });
    await db.tracks.add({
      id: "tr-order",
      title: "轨道甲",
      status: "active",
      refs: [],
      createdAt: now,
      updatedAt: now,
    } as never);
    const { host, root } = await renderRow(self.id);
    await click(host.querySelector('button[aria-label="添加前置"]'));
    const groupLabels = [...host.querySelectorAll("p")]
      .map((p) => p.textContent?.trim())
      .filter((text) => text === "任务" || text === "轨道");
    expect(groupLabels).toEqual(["轨道", "任务"]);
    await unmount(root);
  });

  it("自己没排期的子任务候选带上父的日期", async () => {
    const self = await addTask({ title: "自己" });
    const parent = await addTask({ title: "装修主线" });
    const scheduledAt = "2026-08-20T00:00:00.000Z";
    await db.tasks.update(parent.id, { scheduledAt });
    const child = await addTask({ title: "买瓷砖" });
    await db.tasks.update(child.id, { parentId: parent.id, scheduledAt: null });
    const d = new Date(scheduledAt);
    const { host, root } = await renderRow(self.id);
    await click(host.querySelector('button[aria-label="添加前置"]'));
    const btn = host.querySelector('button[aria-label="添加前置 买瓷砖"]') as HTMLElement;
    expect(btn).not.toBeNull();
    expect(btn.textContent).toContain(`装修主线 · ${d.getMonth() + 1}月${d.getDate()}日`);
    await unmount(root);
  });

  it("重复发次的镜像子步骤不进候选，同名手建子任务照进", async () => {
    const self = await addTask({ title: "自己" });
    const occurrence = await addTask({ title: "每日习惯【必做】" });
    await db.tasks.update(occurrence.id, { scheduledAt: "2026-08-20T00:00:00.000Z" });
    // 真实形态：id 由 occurrenceChildId 生成、parentId 指向那一发、自己无排期
    const seed = await addTask({ title: "RQ签到" });
    const row = await db.tasks.get(seed.id);
    await db.tasks.delete(seed.id);
    await db.tasks.add({
      ...(row as NonNullable<typeof row>),
      id: occurrenceChildId(occurrence.id, "tmpl-rq"),
      parentId: occurrence.id,
      scheduledAt: null,
    });
    // 对照：同名但用户手建的子任务不受影响，避免过滤写成「按 parentId 排除」
    const handMade = await addTask({ title: "RQ签到（手建）" });
    await db.tasks.update(handMade.id, { parentId: occurrence.id });

    const { host, root } = await renderRow(self.id);
    await click(host.querySelector('button[aria-label="添加前置"]'));
    expect(host.querySelector('button[aria-label="添加前置 RQ签到"]')).toBeNull();
    expect(host.querySelector('button[aria-label="添加前置 RQ签到（手建）"]')).not.toBeNull();
    await unmount(root);
  });

  it("带日期的候选排在无日期的候选后面", async () => {
    const self = await addTask({ title: "自己", toInbox: true });
    const dated = await addTask({ title: "带日期的活", toInbox: true });
    await db.tasks.update(dated.id, { scheduledAt: "2026-08-20T00:00:00.000Z" });
    // 后建的无日期任务 updatedAt 更新，旧口径下它会排在前面——这里要的是「与谁更新无关」
    await addTask({ title: "没日期的活", toInbox: true });
    const { host, root } = await renderRow(self.id);
    await click(host.querySelector('button[aria-label="添加前置"]'));
    const titles = [...host.querySelectorAll("button[aria-label^='添加前置 ']")].map((b) =>
      b.getAttribute("aria-label"),
    );
    expect(titles).toEqual(["添加前置 没日期的活", "添加前置 带日期的活"]);
    await unmount(root);
  });
});
