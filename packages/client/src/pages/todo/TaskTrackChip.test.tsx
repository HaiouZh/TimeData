// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { MemoryRouter } from "react-router";
import type { Track } from "@timedata/shared";
import type { TaskTrackInfo } from "../../lib/taskTrackIndex.js";
import { BADGE_TONE_CLASSES } from "../../lib/trackBadgeTone.js";
import { renderDom, unmount, click } from "../../test/domHarness.js";
import { TaskTrackChip } from "./TaskTrackChip.js";

afterEach(() => {
  document.body.innerHTML = "";
});

function makeTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: "trk-1",
    title: "轨道一",
    status: "active",
    refs: [{ kind: "task", id: "task-1" }],
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function renderChip(info: TaskTrackInfo, onRowClick = vi.fn()) {
  return renderDom(
    createElement(
      MemoryRouter,
      null,
      createElement("div", { onClick: onRowClick }, createElement(TaskTrackChip, { info })),
    ),
  );
}

describe("TaskTrackChip", () => {
  it("有信号：显示 #信号文字、data-tone=tone、链接指向轨道详情", async () => {
    const info: TaskTrackInfo = {
      track: makeTrack(),
      signal: { tag: "agent在做", stepId: "s1" },
      tone: "agent",
    };
    const { host, root } = await renderChip(info);
    const chip = host.querySelector('[data-testid="task-track-chip"]') as HTMLAnchorElement;
    expect(chip.textContent).toBe("#agent在做");
    expect(chip.dataset.tone).toBe("agent");
    expect(chip.getAttribute("href")).toBe("/tracks/trk-1");
    // 颜色是 tone 上提的**目的**，而 data-tone 只是测试属性——不钉真实类名的话，
    // 把 warn/agent 两行的类名串写反、或误用 .default，data-tone 依旧正确、照样全绿。
    for (const cls of BADGE_TONE_CLASSES.agent.split(" ")) {
      expect(chip.className).toContain(cls);
    }
    await unmount(root);
  });

  // 只钉 agent 一档的话，把 warn 与 default 两行的类名串互换不会被抓到——三档要各钉各的。
  it.each([
    ["warn", "待我处理"],
    ["default", "卡住"],
  ] as const)("有信号 tone=%s：落对应真实类名", async (tone, tag) => {
    const info: TaskTrackInfo = { track: makeTrack(), signal: { tag, stepId: "s1" }, tone };
    const { host, root } = await renderChip(info);
    const chip = host.querySelector('[data-testid="task-track-chip"]') as HTMLAnchorElement;
    expect(chip.dataset.tone).toBe(tone);
    for (const cls of BADGE_TONE_CLASSES[tone].split(" ")) {
      expect(chip.className).toContain(cls);
    }
    await unmount(root);
  });

  it("无信号：显示「轨道」、data-tone=none", async () => {
    const info: TaskTrackInfo = { track: makeTrack(), signal: null, tone: "default" };
    const { host, root } = await renderChip(info);
    const chip = host.querySelector('[data-testid="task-track-chip"]') as HTMLAnchorElement;
    expect(chip.textContent).toBe("轨道");
    expect(chip.dataset.tone).toBe("none");
    await unmount(root);
  });

  it("点击不冒泡到行（stopPropagation）", async () => {
    const onRowClick = vi.fn();
    const info: TaskTrackInfo = { track: makeTrack(), signal: null, tone: "default" };
    const { host, root } = await renderChip(info, onRowClick);
    await click(host.querySelector('[data-testid="task-track-chip"]'));
    expect(onRowClick).not.toHaveBeenCalled();
    await unmount(root);
  });
});
