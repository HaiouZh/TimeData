// @vitest-environment jsdom
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { normalizeScheduledDate } from "../../lib/tasks/placement.js";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import { RecurrencePresetSheet } from "./RecurrencePresetSheet.js";

function render(props: Parameters<typeof RecurrencePresetSheet>[0]) {
  return renderDom(createElement(RecurrencePresetSheet, props));
}

const base = {
  current: null,
  scheduledAt: null,
  anchor: "2026-06-16",
  onChoose: vi.fn(),
  onCustom: vi.fn(),
  onClose: vi.fn(),
};

describe("RecurrencePresetSheet", () => {
  it("渲染通用 Sheet 标题与关闭按钮", async () => {
    const onClose = vi.fn();
    const { host, root } = await render({ ...base, onClose });

    expect(host.querySelector('[role="dialog"]')?.getAttribute("aria-label")).toBe("重复与时间");
    await click(host.querySelector('button[aria-label="关闭"]'));
    expect(onClose).toHaveBeenCalled();
    await unmount(root);
  });

  it("点『每天』→ onChoose daily", async () => {
    const onChoose = vi.fn();
    const { host, root } = await render({ ...base, onChoose });

    await click(host.querySelector('button[aria-label="每天"]'));

    expect(onChoose).toHaveBeenCalledWith({
      kind: "recurrence",
      recurrence: { freq: "daily", interval: 1, basis: "due" },
      startAt: normalizeScheduledDate("2026-06-16"),
    });
    await unmount(root);
  });

  it("点『工作日』→ byWeekday [1..5]", async () => {
    const onChoose = vi.fn();
    const { host, root } = await render({ ...base, onChoose });

    await click(host.querySelector('button[aria-label="工作日"]'));

    expect(onChoose.mock.calls.at(-1)?.[0].recurrence).toMatchObject({ freq: "weekly", byWeekday: [1, 2, 3, 4, 5] });
    await unmount(root);
  });

  it("『每月最后一天』行常驻", async () => {
    const onChoose = vi.fn();
    const { host, root } = await render({ ...base, onChoose });

    const row = host.querySelector('button[aria-label="每月最后一天"]');
    expect(row).toBeTruthy();
    await click(row);

    expect(onChoose.mock.calls.at(-1)?.[0].recurrence).toMatchObject({ freq: "monthly", byMonthday: [-1] });
    await unmount(root);
  });

  it("点『不重复』→ onChoose none", async () => {
    const onChoose = vi.fn();
    const { host, root } = await render({ ...base, current: { freq: "daily", interval: 1, basis: "due" }, onChoose });

    await click(host.querySelector('button[aria-label="不重复"]'));

    expect(onChoose).toHaveBeenCalledWith({ kind: "none" });
    await unmount(root);
  });

  it("点『仅某天』展开月历，选日 → onChoose scheduled", async () => {
    const onChoose = vi.fn();
    const { host, root } = await render({ ...base, onChoose });

    await click(host.querySelector('button[aria-label="仅某天…"]'));
    await click(host.querySelector('button[aria-label="2026-06-20"]'));

    expect(onChoose).toHaveBeenCalledWith({ kind: "scheduled", date: "2026-06-20" });
    await unmount(root);
  });

  it("点『自定义…』→ onCustom，不调 onChoose", async () => {
    const onCustom = vi.fn();
    const onChoose = vi.fn();
    const { host, root } = await render({ ...base, onCustom, onChoose });

    await click(host.querySelector('button[aria-label="自定义…"]'));

    expect(onCustom).toHaveBeenCalled();
    expect(onChoose).not.toHaveBeenCalled();
    await unmount(root);
  });
});
