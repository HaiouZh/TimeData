// @vitest-environment jsdom
import type { Track, TrackStep } from "@timedata/shared";
import { act } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TodoTrackRow } from "../../lib/tasks/todoTrackRows.js";
import { renderDom, unmount } from "../../test/domHarness.js";
import { appendUserStep } from "../../lib/tracks.js";
import { TrackRow } from "./TrackRow.js";

vi.mock("../../lib/tracks.js", () => ({ appendUserStep: vi.fn(async () => ({ closed: [], created: null })) }));

const NOW = new Date("2026-08-18T12:00:00.000Z");

const track: Track = {
  id: "tr1",
  title: "推进轴投影层",
  status: "active",
  refs: [],
  createdAt: "2026-08-11T12:00:00.000Z",
  updatedAt: "2026-08-13T12:00:00.000Z",
};

function step(patch: Partial<TrackStep> & Pick<TrackStep, "id" | "seq">): TrackStep {
  return {
    trackId: "tr1",
    source: "user",
    content: `步骤 ${patch.id}`,
    startedAt: "2026-08-18T10:00:00.000Z",
    endedAt: "2026-08-18T10:05:00.000Z",
    refs: [],
    tags: [],
    createdAt: "2026-08-18T10:00:00.000Z",
    updatedAt: "2026-08-18T10:05:00.000Z",
    ...patch,
  } as TrackStep;
}

const row: TodoTrackRow = { track, steps: [], zone: "today", stepCount: 12, hasOpenStep: true };

function renderRow(overrides: Partial<Parameters<typeof TrackRow>[0]> = {}) {
  return renderDom(
    <MemoryRouter initialEntries={["/todo"]}>
      <Routes>
        <Route
          path="/todo"
          element={<TrackRow row={row} expanded={false} onToggleExpand={() => {}} now={NOW} {...overrides} />}
        />
        <Route path="/tracks/:id" element={<div data-testid="track-detail-page" />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** jsdom 里所有元素的 getBoundingClientRect 恒为 0 宽，分区算不出来——给它一个真宽度。 */
function widen(el: HTMLElement): void {
  el.getBoundingClientRect = () =>
    ({ width: 200, height: 40, top: 0, left: 0, right: 200, bottom: 40, x: 0, y: 0, toJSON: () => "" }) as DOMRect;
}

beforeEach(() => {
  vi.mocked(appendUserStep).mockClear();
});

describe("TrackRow", () => {
  it("渲染标题与步数", async () => {
    const { host, root } = await renderRow();
    expect(host.textContent).toContain("推进轴投影层");
    expect(host.textContent).toContain("12 步");
    await unmount(root);
  });

  it("没有开口步时不显示「进行中」，且永远不渲染复选框——轨道没有 done", async () => {
    const { host, root } = await renderRow({ row: { ...row, hasOpenStep: false } });
    expect(host.textContent).not.toContain("进行中");
    expect(host.querySelector('input[type="checkbox"]')).toBeNull();
    await unmount(root);
  });

  // 原来断言「整行是 href=/tracks/tr1 的链接」，分区行之后改写成「点右 3/5 真的跳过去」。
  it("点行右 3/5 跳轨道详情页", async () => {
    const { host, root } = await renderRow();
    const el = host.querySelector('[data-testid="todo-track-row"]') as HTMLElement;
    widen(el);
    await act(async () => el.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 160 })));
    expect(host.querySelector('[data-testid="track-detail-page"]')).not.toBeNull();
    await unmount(root);
  });

  it("点行左 2/5 切换展开，不跳页", async () => {
    const onToggleExpand = vi.fn();
    const { host, root } = await renderRow({ onToggleExpand });
    const el = host.querySelector('[data-testid="todo-track-row"]') as HTMLElement;
    widen(el);
    await act(async () => el.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 5 })));
    expect(onToggleExpand).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[data-testid="track-detail-page"]')).toBeNull();
    await unmount(root);
  });

  it("展开后按 seq 倒序显示最近 3 步，并给出「共 N 步」出口", async () => {
    const steps = [1, 2, 3, 4, 5].map((n) => step({ id: `s${n}`, seq: n, content: `第 ${n} 步` }));
    const { host, root } = await renderRow({
      row: { ...row, steps, stepCount: 5 },
      expanded: true,
    });
    const texts = [...host.querySelectorAll('[data-testid="todo-track-step"]')].map((el) => el.textContent ?? "");
    expect(texts).toHaveLength(3);
    expect(texts[0]).toContain("第 5 步");
    expect(texts[2]).toContain("第 3 步");
    expect(host.textContent).toContain("共 5 步");
    await unmount(root);
  });

  it("开口步标「进行中」", async () => {
    const steps = [step({ id: "s1", seq: 1, content: "在做的这步", endedAt: null })];
    const { host, root } = await renderRow({ row: { ...row, steps, stepCount: 1 }, expanded: true });
    const stepEl = host.querySelector('[data-testid="todo-track-step"]');
    expect(stepEl?.textContent).toContain("进行中");
    await unmount(root);
  });

  it("未展开时不渲染步骤流", async () => {
    const steps = [step({ id: "s1", seq: 1 })];
    const { host, root } = await renderRow({ row: { ...row, steps, stepCount: 1 }, expanded: false });
    expect(host.querySelector('[data-testid="todo-track-step"]')).toBeNull();
    await unmount(root);
  });

  it("一步都没有时展开不显示「共 0 步」的空出口", async () => {
    const { host, root } = await renderRow({ row: { ...row, steps: [], stepCount: 0 }, expanded: true });
    expect(host.textContent).not.toContain("共 0 步");
    await unmount(root);
  });

  it("行换宿主重挂后仍保持展开——展开态在页面手里，不随组件卸载丢失", async () => {
    const expandedIds = new Set(["tr1"]);
    const rowWithStep = { ...row, steps: [step({ id: "s1", seq: 1 })], stepCount: 1 };
    const first = await renderRow({ expanded: expandedIds.has("tr1"), row: rowWithStep });
    expect(first.host.querySelector('[data-testid="todo-track-step"]')).not.toBeNull();
    await unmount(first.root);

    // 跨区 = 换父容器 = 组件重挂。页面持有的集合没变，重挂后仍应展开。
    const second = await renderRow({ expanded: expandedIds.has("tr1"), row: { ...rowWithStep, zone: "today" } });
    expect(second.host.querySelector('[data-testid="todo-track-step"]')).not.toBeNull();
    await unmount(second.root);
  });
});

describe("TrackRow 记一步", () => {
  it("展开后有「记一步」入口，点开变成聚焦输入行", async () => {
    const { host, root } = await renderRow({ expanded: true });
    const open = host.querySelector('[aria-label="记一步"]') as HTMLElement;
    expect(open).not.toBeNull();
    await act(async () => open.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(host.querySelector('[data-testid="track-step-draft-row"]')).not.toBeNull();
    await unmount(root);
  });

  it("回车提交非空内容 → 调 appendUserStep 记即时步，且草稿行保持打开可连续录入", async () => {
    const { host, root } = await renderRow({ expanded: true });
    const open = host.querySelector('[aria-label="记一步"]') as HTMLElement;
    await act(async () => open.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const input = host.querySelector('textarea[aria-label="新步骤内容"]') as HTMLTextAreaElement;
    await act(async () => {
      input.value = "把闸补齐了";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(appendUserStep).toHaveBeenCalledWith({
      trackId: "tr1",
      content: "把闸补齐了",
      mode: "instant",
      tags: [],
    });
    expect(host.querySelector('[data-testid="track-step-draft-row"]')).not.toBeNull();
    await unmount(root);
  });

  it("空内容回车不落库，且收起草稿行", async () => {
    const { host, root } = await renderRow({ expanded: true });
    const open = host.querySelector('[aria-label="记一步"]') as HTMLElement;
    await act(async () => open.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const input = host.querySelector('textarea[aria-label="新步骤内容"]') as HTMLTextAreaElement;
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(appendUserStep).not.toHaveBeenCalled();
    expect(host.querySelector('[data-testid="track-step-draft-row"]')).toBeNull();
    await unmount(root);
  });

  // 与轨道页 StepComposer 的 TK-01 契约同款：写失败不许把用户刚打的字吃掉。
  it("写入失败时保留原文并 inline 报错，草稿行不收起", async () => {
    vi.mocked(appendUserStep).mockRejectedValueOnce(new Error("轨道不存在"));
    const { host, root } = await renderRow({ expanded: true });
    const open = host.querySelector('[aria-label="记一步"]') as HTMLElement;
    await act(async () => open.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const input = host.querySelector('textarea[aria-label="新步骤内容"]') as HTMLTextAreaElement;
    await act(async () => {
      input.value = "写不进去的一步";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(host.querySelector('[data-testid="track-step-draft-error"]')?.textContent).toContain("轨道不存在");
    expect((host.querySelector('textarea[aria-label="新步骤内容"]') as HTMLTextAreaElement).value).toBe("写不进去的一步");
    expect(host.querySelector('[data-testid="track-step-draft-row"]')).not.toBeNull();
    await unmount(root);
  });

  // 以前靠「先同步清空 value」顺带挡住重复提交；改成写成功才清空之后，这道闸必须显式存在。
  it("在途窗口内连打两次回车只落库一次", async () => {
    let release: (() => void) | null = null;
    vi.mocked(appendUserStep).mockImplementationOnce(
      () => new Promise((resolve) => (release = () => resolve({ closed: [], created: null } as never))),
    );
    const { host, root } = await renderRow({ expanded: true });
    const open = host.querySelector('[aria-label="记一步"]') as HTMLElement;
    await act(async () => open.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const input = host.querySelector('textarea[aria-label="新步骤内容"]') as HTMLTextAreaElement;
    await act(async () => {
      input.value = "连打两次";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(appendUserStep).toHaveBeenCalledTimes(1);
    await act(async () => {
      release?.();
    });
    await unmount(root);
  });

  // 输入法组词途中按回车不许提交半截拼音（isComposing 在部分 Android 输入法上不置位，故另认 keyCode 229）。
  it("IME 组词中的回车不提交", async () => {
    const { host, root } = await renderRow({ expanded: true });
    const open = host.querySelector('[aria-label="记一步"]') as HTMLElement;
    await act(async () => open.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const input = host.querySelector('textarea[aria-label="新步骤内容"]') as HTMLTextAreaElement;
    await act(async () => {
      input.value = "pinyin";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 229, bubbles: true }));
    });
    expect(appendUserStep).not.toHaveBeenCalled();
    await unmount(root);
  });

  // 从 <a href> 改成 role="link" 的 div 之后浏览器不再给默认焦点样式，index.css 也无兜底。
  it("行带 focus-visible 焦点环——键盘用户看得见自己停在哪一行", async () => {
    const { host, root } = await renderRow();
    const el = host.querySelector('[data-testid="todo-track-row"]') as HTMLElement;
    expect(el.className).toContain("focus-visible:ring-");
    await unmount(root);
  });

  it("未展开时没有记一步入口", async () => {
    const { host, root } = await renderRow({ expanded: false });
    expect(host.querySelector('[aria-label="记一步"]')).toBeNull();
    await unmount(root);
  });

  it("行内只记即时步，不给开口步的模式切换", async () => {
    const { host, root } = await renderRow({ expanded: true });
    const open = host.querySelector('[aria-label="记一步"]') as HTMLElement;
    await act(async () => open.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(host.textContent).not.toContain("开口");
    expect(host.querySelector('[aria-label="切换步骤模式"]')).toBeNull();
    await unmount(root);
  });
});
