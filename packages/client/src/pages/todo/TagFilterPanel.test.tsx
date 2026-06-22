// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
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
});
