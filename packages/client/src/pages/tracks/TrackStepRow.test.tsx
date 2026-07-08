// @vitest-environment jsdom
import type { TrackStep } from "@timedata/shared";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import { TrackStepRow } from "./TrackStepRow.js";

const T = "2026-06-21T00:00:00.000Z";
const NOW = new Date("2026-06-21T02:00:00.000Z");

let mounted: Awaited<ReturnType<typeof renderDom>> | null = null;
afterEach(async () => {
  if (mounted) await unmount(mounted.root);
  mounted = null;
});

function step(partial: Partial<TrackStep> & { id: string }): TrackStep {
  return {
    trackId: "t1",
    source: "agent",
    content: "推进了一步",
    startedAt: T,
    endedAt: T,
    refs: [],
    tags: [],
    seq: 0,
    createdAt: T,
    updatedAt: T,
    ...partial,
  };
}

async function mount(props: {
  step: TrackStep;
  isCurrent: boolean;
  now: Date;
  highlighted?: boolean;
  onEdit?: (id: string, content: string) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
}) {
  mounted = await renderDom(<TrackStepRow {...props} />);
  return mounted.host;
}

async function typeTextarea(host: HTMLElement, label: string, value: string): Promise<void> {
  await act(async () => {
    const textarea = host.querySelector(`textarea[aria-label="${label}"]`) as HTMLTextAreaElement;
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setValue?.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("TrackStepRow", () => {
  it("行带锚点 id，highlighted 时有高亮环", async () => {
    const host = await mount({ step: step({ id: "s-anchor" }), isCurrent: false, now: NOW, highlighted: true });
    const li = host.querySelector("#step-s-anchor");
    expect(li).not.toBeNull();
    expect(li?.className).toContain("ring-accent");
    if (mounted) await unmount(mounted.root);
    const plain = await mount({ step: step({ id: "s-plain" }), isCurrent: false, now: NOW });
    expect(plain.querySelector("#step-s-plain")).not.toBeNull();
    expect(plain.querySelector("#step-s-plain")?.className).not.toContain("ring-accent");
  });

  it("shows sourceLabel for agent steps and 我 for user steps", async () => {
    const a = await mount({ step: step({ id: "a", source: "agent", sourceLabel: "codex" }), isCurrent: false, now: NOW });
    expect(a.textContent).toContain("codex");
    expect(a.textContent).toContain("推进了一步");
    if (mounted) await unmount(mounted.root);
    const b = await mount({ step: step({ id: "b", source: "user", sourceLabel: undefined }), isCurrent: false, now: NOW });
    expect(b.querySelector('[data-source="user"]')?.textContent).toContain("我");
  });

  it("renders 决策 as an ordinary retrieval tag without a special badge", async () => {
    const decided = await mount({ step: step({ id: "d", source: "agent", tags: ["决策"] }), isCurrent: false, now: NOW });
    expect(decided.textContent).toContain("#决策");
    expect(decided.textContent).not.toContain("决策步");
    expect(decided.querySelector("[data-decision]")).toBeNull();
  });

  it("renders tags, refs and an in-progress duration for the current open step", async () => {
    const host = await mount({
      step: step({
        id: "c",
        endedAt: null,
        startedAt: T,
        tags: ["base期"],
        refs: [{ kind: "url", id: "https://x.test", label: "spec" }],
      }),
      isCurrent: true,
      now: NOW,
    });
    expect(host.textContent).toContain("#base期");
    expect(host.querySelector('[data-testid="ref-chip"]')).not.toBeNull();
    expect(host.textContent).toContain("进行中");
    expect(host.textContent).toContain("2小时");
    // 当前步高亮:accent token,不裸色
    expect(host.querySelector('[data-current="true"]')?.className).toContain("border-accent");
  });

  it("renders the duration label with a tabular number role", async () => {
    const host = await mount({ step: step({ id: "dur" }), isCurrent: false, now: NOW });
    const duration = host.querySelector(".td-duration");
    expect(duration).not.toBeNull();
    expect(duration?.textContent).toContain("历时");
  });

  it("shows a relative time stamp for the step's last activity", async () => {
    const host = await mount({ step: step({ id: "rel", endedAt: T }), isCurrent: false, now: NOW });
    const rel = host.querySelector('[data-testid="step-relative-time"]');
    expect(rel?.textContent).toContain("2小时前");
    expect(rel?.getAttribute("title")).toContain("UTC+8");
  });

  it("folds long non-current step content behind a 展开 toggle", async () => {
    const long = "步".repeat(300);
    const host = await mount({ step: step({ id: "long", endedAt: T, content: long }), isCurrent: false, now: NOW });
    expect(host.querySelector("p")?.className).toContain("line-clamp-6");
    const toggle = [...host.querySelectorAll("button")].find((b) => b.textContent === "展开");
    expect(toggle).not.toBeUndefined();
    await click(toggle ?? null);
    expect(host.querySelector("p")?.className).not.toContain("line-clamp-6");
    expect([...host.querySelectorAll("button")].some((b) => b.textContent === "收起")).toBe(true);
  });

  it("never folds the current step even if its content is long", async () => {
    const long = "步".repeat(300);
    const host = await mount({ step: step({ id: "cur", endedAt: null, content: long }), isCurrent: true, now: NOW });
    expect(host.querySelector("p")?.className).not.toContain("line-clamp-6");
    expect([...host.querySelectorAll("button")].some((b) => b.textContent === "展开")).toBe(false);
  });

  it("user 步渲染编辑/删除按钮，agent 步不渲染", async () => {
    const onEdit = vi.fn(async () => undefined);
    const onDelete = vi.fn(async () => undefined);
    const user = await mount({ step: step({ id: "u", source: "user" }), isCurrent: false, now: NOW, onEdit, onDelete });

    expect(user.querySelector('button[aria-label="编辑步骤"]')).not.toBeNull();
    expect(user.querySelector('button[aria-label="删除步骤"]')).not.toBeNull();

    if (mounted) await unmount(mounted.root);
    const agent = await mount({ step: step({ id: "a", source: "agent" }), isCurrent: false, now: NOW, onEdit, onDelete });
    expect(agent.querySelector('button[aria-label="编辑步骤"]')).toBeNull();
    expect(agent.querySelector('button[aria-label="删除步骤"]')).toBeNull();
  });

  it("编辑保存调 onEdit(id, 新内容)", async () => {
    const onEdit = vi.fn(async () => undefined);
    const host = await mount({ step: step({ id: "u", source: "user", content: "旧内容" }), isCurrent: false, now: NOW, onEdit });

    await click(host.querySelector('button[aria-label="编辑步骤"]'));
    await typeTextarea(host, "编辑步骤内容", "新内容");
    await click([...host.querySelectorAll("button")].find((button) => button.textContent === "保存"));

    expect(onEdit).toHaveBeenCalledWith("u", "新内容");
  });

  it("删除需确认后调 onDelete", async () => {
    const onDelete = vi.fn(async () => undefined);
    const host = await mount({ step: step({ id: "u", source: "user" }), isCurrent: false, now: NOW, onDelete });
    const deleteButton = host.querySelector('button[aria-label="删除步骤"]');

    await click(deleteButton);
    expect(onDelete).not.toHaveBeenCalled();
    await click(host.querySelector('button[aria-label="确认删除步骤"]'));

    expect(onDelete).toHaveBeenCalledWith("u");
  });

  it("editedAt 存在时显示已编辑", async () => {
    const host = await mount({
      step: step({ id: "edited", source: "user", editedAt: "2026-06-21T01:00:00.000Z" }),
      isCurrent: false,
      now: NOW,
    });

    expect(host.textContent).toContain("已编辑");
  });
});
