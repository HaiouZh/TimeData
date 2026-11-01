// @vitest-environment jsdom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, resetDb } from "../../test/dbReset.js";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import { OverviewEntryBox } from "./OverviewEntryBox.js";

async function flush(): Promise<void> {
  await act(async () => {
    for (let index = 0; index < 10; index++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
}

function textarea(host: HTMLElement): HTMLTextAreaElement {
  const element = host.querySelector('textarea[aria-label="丢进来"]');
  if (!(element instanceof HTMLTextAreaElement)) throw new Error("missing textarea");
  return element;
}

function submitButton(host: HTMLElement): HTMLButtonElement {
  const element = [...host.querySelectorAll("button")].find((button) => button.textContent === "丢进去");
  if (!(element instanceof HTMLButtonElement)) throw new Error("missing submit button");
  return element;
}

async function typeInto(element: HTMLTextAreaElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function keyDown(element: HTMLTextAreaElement, init: KeyboardEventInit): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
  });
}

beforeEach(resetDb);
afterEach(async () => {
  vi.restoreAllMocks();
  await resetDb();
});

describe("OverviewEntryBox", () => {
  it("宽屏回车提交：写进一条速记，清空输入，提示已收下", async () => {
    const { host, root } = await renderDom(<OverviewEntryBox wide />);
    await typeInto(textarea(host), "  看步频视频  ");
    await keyDown(textarea(host), { key: "Enter" });
    await flush();
    const notes = await db.quickNotes.toArray();
    expect(notes.length).toBe(1);
    expect(notes[0]?.text).toBe("看步频视频");
    expect(textarea(host).value).toBe("");
    expect(host.querySelector('[role="status"]')?.textContent).toBe("已收下，在「散着」里");
    await unmount(root);
  });

  it("输入法组字时回车不提交", async () => {
    const { host, root } = await renderDom(<OverviewEntryBox wide />);
    await typeInto(textarea(host), "组合中");
    await keyDown(textarea(host), { key: "Enter", isComposing: true });
    await flush();
    expect(await db.quickNotes.count()).toBe(0);
    expect(textarea(host).value).toBe("组合中");
    await unmount(root);
  });

  it("keyCode 229 的回车不提交", async () => {
    const { host, root } = await renderDom(<OverviewEntryBox wide />);
    await typeInto(textarea(host), "组合中");
    await keyDown(textarea(host), { key: "Enter", keyCode: 229 });
    await flush();
    expect(await db.quickNotes.count()).toBe(0);
    expect(textarea(host).value).toBe("组合中");
    await unmount(root);
  });

  it("宽屏 Shift+回车不提交", async () => {
    const { host, root } = await renderDom(<OverviewEntryBox wide />);
    await typeInto(textarea(host), "第一行");
    await keyDown(textarea(host), { key: "Enter", shiftKey: true });
    await flush();
    expect(await db.quickNotes.count()).toBe(0);
    expect(textarea(host).value).toBe("第一行");
    await unmount(root);
  });

  it("窄屏回车不提交，点「丢进去」才提交", async () => {
    const { host, root } = await renderDom(<OverviewEntryBox wide={false} />);
    await typeInto(textarea(host), "窄屏一条");
    await keyDown(textarea(host), { key: "Enter" });
    await flush();
    expect(await db.quickNotes.count()).toBe(0);
    await click(submitButton(host));
    await flush();
    const notes = await db.quickNotes.toArray();
    expect(notes.length).toBe(1);
    expect(notes[0]?.text).toBe("窄屏一条");
    await unmount(root);
  });

  it("全是空白时按钮禁用，回车也不写入", async () => {
    const { host, root } = await renderDom(<OverviewEntryBox wide />);
    await typeInto(textarea(host), "   ");
    expect(submitButton(host).disabled).toBe(true);
    await keyDown(textarea(host), { key: "Enter" });
    await flush();
    expect(await db.quickNotes.count()).toBe(0);
    await unmount(root);
  });

  it("连按两次回车只写一条", async () => {
    const { host, root } = await renderDom(<OverviewEntryBox wide />);
    await typeInto(textarea(host), "只记一次");
    await act(async () => {
      textarea(host).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      textarea(host).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    await flush();
    expect(await db.quickNotes.count()).toBe(1);
    await unmount(root);
  });

  it("写库失败：提示错误，输入原样保留", async () => {
    vi.spyOn(db.syncLog, "add").mockRejectedValueOnce(new Error("写库失败"));
    const { host, root } = await renderDom(<OverviewEntryBox wide />);
    await typeInto(textarea(host), "会失败的一条");
    await click(submitButton(host));
    await flush();
    expect(host.querySelector('[role="alert"]')?.textContent ?? "").toContain("写库失败");
    expect(textarea(host).value).toBe("会失败的一条");
    expect(host.querySelector('[role="status"]')).toBeNull();
    expect(await db.quickNotes.count()).toBe(0);
    await unmount(root);
  });

  it("收下后接着打字，「已收下」提示收起", async () => {
    const { host, root } = await renderDom(<OverviewEntryBox wide />);
    await typeInto(textarea(host), "第一条");
    await keyDown(textarea(host), { key: "Enter" });
    await flush();
    expect(host.querySelector('[role="status"]')?.textContent).toBe("已收下，在「散着」里");
    await typeInto(textarea(host), "第");
    expect(host.querySelector('[role="status"]')).toBeNull();
    await unmount(root);
  });

  it("写库失败后再点一次就能存上，错误提示随之消失", async () => {
    vi.spyOn(db.syncLog, "add").mockRejectedValueOnce(new Error("写库失败"));
    const { host, root } = await renderDom(<OverviewEntryBox wide />);
    await typeInto(textarea(host), "再试一次");
    await click(submitButton(host));
    await flush();
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    await click(submitButton(host));
    await flush();
    const notes = await db.quickNotes.toArray();
    expect(notes.map((n) => n.text)).toEqual(["再试一次"]);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector('[role="status"]')?.textContent).toBe("已收下，在「散着」里");
    await unmount(root);
  });
});
