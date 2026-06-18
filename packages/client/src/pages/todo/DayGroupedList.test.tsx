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
    expect(host.querySelector('[aria-label="显示更多"]')).toBeNull();
    await unmount(root);
  });

  it(">3 组默认显示前 3，按『显示更多』后全部显示", async () => {
    const segs = ["今天", "昨天", "6月10日", "6月9日", "6月8日"].map(seg);
    const { host, root } = await renderDom(<DayGroupedList segments={segs} renderTasks={renderTasks} />);
    expect(host.textContent).toContain("6月10日");
    expect(host.textContent).not.toContain("6月9日");
    const more = host.querySelector('[aria-label="显示更多"]') as HTMLButtonElement | null;
    expect(more?.textContent).toContain("2");
    await click(more);
    expect(host.textContent).toContain("6月9日");
    expect(host.textContent).toContain("6月8日");
    await unmount(root);
  });

  it("空段输入返回空容器，无错也无按钮", async () => {
    const { host, root } = await renderDom(<DayGroupedList segments={[]} renderTasks={renderTasks} />);
    expect(host.querySelector('[aria-label="显示更多"]')).toBeNull();
    await unmount(root);
  });
});