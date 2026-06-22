// @vitest-environment jsdom
import type { Task } from "@timedata/shared";
import { describe, expect, it } from "vitest";
import type { InboxDaySegment } from "../../lib/tasks/inboxGrouping.js";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import { DayGroupedList } from "./DayGroupedList.js";

function seg(label: string): InboxDaySegment {
  return { key: label, label, tasks: [{ id: label, title: label } as unknown as Task] };
}

const renderTasks = (tasks: Task[]) => (
  <ul>
    {tasks.map((t) => (
      <li key={t.id}>{t.title}</li>
    ))}
  </ul>
);

describe("DayGroupedList", () => {
  it("≤3 组全显，无『显示更多』按钮", async () => {
    const { host, root } = await renderDom(
      <DayGroupedList segments={[seg("今天"), seg("昨天")]} renderTasks={renderTasks} />,
    );
    expect(host.textContent).toContain("今天");
    expect(host.textContent).toContain("昨天");
    expect(host.querySelector('[aria-label^="显示更多"]')).toBeNull();
    await unmount(root);
  });

  it(">3 组默认显示前 3，按『显示更多』后全部显示", async () => {
    const segs = ["今天", "昨天", "6月10日", "6月9日", "6月8日"].map(seg);
    const { host, root } = await renderDom(<DayGroupedList segments={segs} renderTasks={renderTasks} />);
    expect(host.textContent).toContain("6月10日");
    expect(host.textContent).not.toContain("6月9日");
    const more = host.querySelector('[aria-label^="显示更多"]') as HTMLButtonElement | null;
    // aria-label 自带数量，方便屏幕阅读器单点听到「还剩几组」
    expect(more?.getAttribute("aria-label")).toBe("显示更多（2）");
    expect(more?.textContent).toContain("2");
    await click(more);
    expect(host.textContent).toContain("6月9日");
    expect(host.textContent).toContain("6月8日");
    await unmount(root);
  });

  it("展开后出现『收起』，点击收起回到前 3 组", async () => {
    const segs = ["今天", "昨天", "6月10日", "6月9日", "6月8日"].map(seg);
    const { host, root } = await renderDom(<DayGroupedList segments={segs} renderTasks={renderTasks} />);
    await click(host.querySelector('[aria-label^="显示更多"]') as HTMLButtonElement);
    expect(host.textContent).toContain("6月9日");

    const collapse = host.querySelector('[aria-label="收起"]') as HTMLButtonElement | null;
    expect(collapse).not.toBeNull();
    await click(collapse);

    expect(host.textContent).not.toContain("6月9日");
    expect(host.textContent).not.toContain("6月8日");
    // 收起后『显示更多』重新出现
    expect(host.querySelector('[aria-label^="显示更多"]')).not.toBeNull();
    await unmount(root);
  });

  it("展开后的『收起』按钮可按底部输入框高度上移避让", async () => {
    const segs = ["今天", "昨天", "6月10日", "6月9日", "6月8日"].map(seg);
    const { host, root } = await renderDom(
      <DayGroupedList segments={segs} renderTasks={renderTasks} stickyBottomOffsetPx={120} />,
    );
    await click(host.querySelector('[aria-label^="显示更多"]') as HTMLButtonElement);

    const collapse = host.querySelector('[aria-label="收起"]') as HTMLButtonElement;
    expect(collapse.style.bottom).toBe("124px");

    await unmount(root);
  });

  it("空段输入：不渲染卡片也不渲染按钮", async () => {
    const { host, root } = await renderDom(<DayGroupedList segments={[]} renderTasks={renderTasks} />);
    expect(host.querySelector('[aria-label^="显示更多"]')).toBeNull();
    // 组件应返回 null（空状态留给上层文案），host 内不应有任何子元素
    expect(host.children.length).toBe(0);
    await unmount(root);
  });
});
