// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { contentTint } from "../../lib/contentTint.js";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import { TagFilterPanel } from "./TagFilterPanel.js";

const base = {
  includeTags: [] as string[],
  excludeTags: [] as string[],
  tagMode: "and" as const,
  notMode: false,
  onToggleTag: () => {},
  onToggleMode: () => {},
  onToggleNotMode: () => {},
  onClear: () => {},
};

const TAGS = [
  { tag: "bug", count: 2 },
  { tag: "api", count: 1 },
];

describe("TagFilterPanel", () => {
  it("无标签返回 null", async () => {
    const { host, root } = await renderDom(<TagFilterPanel {...base} tags={[]} />);
    expect(host.textContent).toBe("");
    await unmount(root);
  });

  it("chip 显示 #标签 + 计数", async () => {
    const { host, root } = await renderDom(<TagFilterPanel {...base} tags={TAGS} />);
    const bug = host.querySelector('[aria-label="筛选 bug"]') as HTMLElement;
    expect(bug.textContent).toContain("#bug");
    expect(bug.textContent).toContain("2");
    await unmount(root);
  });

  it("点 chip 调 onToggleTag（含 toggle 由父接管）", async () => {
    const onToggleTag = vi.fn();
    const { host, root } = await renderDom(<TagFilterPanel {...base} tags={TAGS} onToggleTag={onToggleTag} />);
    await click(host.querySelector('[aria-label="筛选 bug"]'));
    expect(onToggleTag).toHaveBeenCalledWith("bug");
    await unmount(root);
  });

  it("includeTags 命中 → data-state=include 且 aria-pressed", async () => {
    const { host, root } = await renderDom(<TagFilterPanel {...base} tags={TAGS} includeTags={["bug"]} />);
    const bug = host.querySelector('[aria-label="筛选 bug"]') as HTMLElement;
    expect(bug.getAttribute("data-state")).toBe("include");
    expect(bug.getAttribute("aria-pressed")).toBe("true");
    await unmount(root);
  });

  it("excludeTags 命中 → data-state=exclude", async () => {
    const { host, root } = await renderDom(<TagFilterPanel {...base} tags={TAGS} excludeTags={["bug"]} />);
    const bug = host.querySelector('[aria-label="筛选 bug"]') as HTMLElement;
    expect(bug.getAttribute("data-state")).toBe("exclude");
    await unmount(root);
  });

  it("OR 按钮反映 tagMode 并可切换", async () => {
    const onToggleMode = vi.fn();
    const { host, root } = await renderDom(
      <TagFilterPanel {...base} tags={TAGS} tagMode="or" onToggleMode={onToggleMode} />,
    );
    const or = host.querySelector('[data-testid="tag-mode-toggle"]') as HTMLElement;
    expect(or.getAttribute("aria-pressed")).toBe("true");
    await click(or);
    expect(onToggleMode).toHaveBeenCalled();
    await unmount(root);
  });

  it("NOT 按钮反映 notMode 并可切换", async () => {
    const onToggleNotMode = vi.fn();
    const { host, root } = await renderDom(
      <TagFilterPanel {...base} tags={TAGS} notMode onToggleNotMode={onToggleNotMode} />,
    );
    const not = host.querySelector('[data-testid="tag-not-toggle"]') as HTMLElement;
    expect(not.getAttribute("aria-pressed")).toBe("true");
    await click(not);
    expect(onToggleNotMode).toHaveBeenCalled();
    await unmount(root);
  });

  it("清除按钮调 onClear", async () => {
    const onClear = vi.fn();
    const { host, root } = await renderDom(
      <TagFilterPanel {...base} tags={TAGS} includeTags={["bug"]} onClear={onClear} />,
    );
    await click(host.querySelector('[aria-label="清除筛选"]'));
    expect(onClear).toHaveBeenCalled();
    await unmount(root);
  });

  /**
   * 三态取色此前零覆盖：把 `contentTint(tag)` 换成任意固定色（全部标签塌成同一个色，
   * ADR 0026 决策一「填充态对比度」那条修复被整体抹平）时，本文件其余用例全绿，
   * `check:design` 也过——`var()` 是合规写法。
   */
  it("三态颜色都取自 contentTint(标签名)，不同标签不同色", async () => {
    const { host, root } = await renderDom(
      <TagFilterPanel {...base} tags={TAGS} includeTags={["bug"]} excludeTags={["api"]} />,
    );
    const chips = [...host.querySelectorAll('[data-testid="tag-filter-chip"]')] as HTMLElement[];
    const byState = (state: string) => chips.find((c) => c.dataset.state === state);

    // include：填充底 + 描边都用标签色，文字压 page 深色（对比度靠色板明度撑）
    const include = byState("include");
    expect(include?.style.backgroundColor).toBe(contentTint("bug"));
    expect(include?.style.borderColor).toBe(contentTint("bug"));
    expect(include?.style.color).toBe("var(--color-page)");
    // exclude：走 danger 语义，不带标签色
    expect(byState("exclude")?.getAttribute("style")).toBeNull();

    const { host: h2, root: r2 } = await renderDom(<TagFilterPanel {...base} tags={TAGS} />);
    const unselected = [...h2.querySelectorAll('[data-testid="tag-filter-chip"]')] as HTMLElement[];
    // unselected：只描边
    expect(unselected[0]?.style.borderColor).toBe(contentTint("bug"));
    expect(unselected[1]?.style.borderColor).toBe(contentTint("api"));
    // 两个不同标签不能塌成同一个色
    expect(unselected[0]?.style.borderColor).not.toBe(unselected[1]?.style.borderColor);

    await unmount(root);
    await unmount(r2);
  });
});
