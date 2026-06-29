// @vitest-environment jsdom
import { act, useState } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { BOTTOM_NAV_HEIGHT_PX } from "../../contexts/BottomNavContext.js";
import { SyncProvider } from "../../contexts/SyncContext.tsx";
import { db, resetDb } from "../../test/dbReset.js";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import { TodoComposer } from "./TodoComposer.js";

beforeEach(async () => {
  localStorage.clear();
  await resetDb();
});

function setValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

type TagOption = { tag: string; count: number };

function Harness({ tags = [] as TagOption[], includeTags = [] as string[] }) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [hiddenByScroll, setHiddenByScroll] = useState(false);
  return (
    <div>
      <button type="button" data-testid="hide-nav" onClick={() => setHiddenByScroll(true)}>
        hide
      </button>
      <TodoComposer
        tags={tags}
        composerText={text}
        onComposerTextChange={setText}
        filterOpen={open}
        onToggleFilterOpen={() => setOpen((v) => !v)}
        includeTags={includeTags}
        excludeTags={[]}
        tagMode="and"
        notMode={false}
        onToggleTag={() => {}}
        onToggleMode={() => {}}
        onToggleNotMode={() => {}}
        onClear={() => {}}
        bottomOffsetPx={hiddenByScroll ? 0 : BOTTOM_NAV_HEIGHT_PX}
        hiddenByScroll={hiddenByScroll}
      />
    </div>
  );
}

async function render(props: { tags?: TagOption[]; includeTags?: string[] } = {}) {
  return renderDom(
    <SyncProvider>
      <Harness {...props} />
    </SyncProvider>,
  );
}

const flush = () => act(async () => new Promise((r) => setTimeout(r, 0)));
const clickAndFlush = async (el: Element | null) => {
  await click(el);
  await flush();
};
const input = (host: HTMLElement) => host.querySelector('input[placeholder="添加任务…"]') as HTMLInputElement | null;

// addTask 是异步（Dexie 写 + setText 回填），点提交到输入框清空之间隔着多个宏任务边界。
// 单次 flush 在重载下不够，沿用主仓既有的 setTimeout(0) 宏任务边界轮询直到清空。
async function waitForInputValue(host: HTMLElement, expected: string) {
  const started = Date.now();
  while (Date.now() - started < 1000) {
    if ((input(host)?.value ?? null) === expected) return;
    await flush();
  }
  throw new Error(`Timed out waiting for input value ${expected}`);
}

describe("TodoComposer 底部操作栏", () => {
  it("空输入点左键 → 展开标签面板、输入框收起", async () => {
    const { host, root } = await render({ tags: [{ tag: "工作", count: 1 }] });
    expect(input(host)).not.toBeNull();
    await clickAndFlush(host.querySelector('[aria-label="展开标签筛选"]'));
    expect(host.querySelector('[data-testid="tag-filter-panel"]')).not.toBeNull();
    expect(input(host)).toBeNull();
    await unmount(root);
  });

  it("有字时左键变搜索指示、文本留存、清空按钮停止搜索", async () => {
    const { host, root } = await render();
    await act(async () => setValue(input(host) as HTMLInputElement, "报告"));
    expect(host.querySelector('[aria-label="搜索中"]')).not.toBeNull();
    expect((input(host) as HTMLInputElement).value).toBe("报告");
    await clickAndFlush(host.querySelector('[aria-label="清空搜索"]'));
    expect((input(host) as HTMLInputElement).value).toBe("");
    expect(host.querySelector('[aria-label="展开标签筛选"]')).not.toBeNull();
    await unmount(root);
  });

  it("右键添加 → 建任务并清空，新任务带 includeTags", async () => {
    const { host, root } = await render({ includeTags: ["工作"] });
    await act(async () => setValue(input(host) as HTMLInputElement, "写周报"));
    await clickAndFlush(host.querySelector('button[type="submit"]'));
    const tasks = await db.tasks.toArray();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("写周报");
    expect(tasks[0].tags).toEqual(["工作"]);
    await waitForInputValue(host, "");
    await unmount(root);
  });

  it("无标签时展开键禁用", async () => {
    const { host, root } = await render({ tags: [] });
    expect((host.querySelector('[aria-label="展开标签筛选"]') as HTMLButtonElement).disabled).toBe(true);
    await unmount(root);
  });

  it("底栏 tab 收起时 composer 一起滑出屏幕（bottom=0 + translateY 100%）", async () => {
    const { host, root } = await render();
    const form = host.querySelector("form") as HTMLFormElement;
    expect(Number.parseInt(form.style.bottom, 10)).toBe(49);
    expect(form.style.transform).toBe("translateY(0)");
    expect(form.style.zIndex).toBe("40");
    await clickAndFlush(host.querySelector('[data-testid="hide-nav"]'));
    // 下滑收起底栏时，输入框落到贴底再整体下移自身高度 → 完全移出视口，让长列表阅读区最大化
    expect(Number.parseInt(form.style.bottom, 10)).toBe(0);
    expect(form.style.transform).toBe("translateY(100%)");
    expect(form.style.zIndex).toBe("40");
    await unmount(root);
  });
});
