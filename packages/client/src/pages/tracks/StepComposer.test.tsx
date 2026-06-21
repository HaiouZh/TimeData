// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import { StepComposer } from "./StepComposer.js";

let mounted: Awaited<ReturnType<typeof renderDom>> | null = null;
afterEach(async () => {
  if (mounted) await unmount(mounted.root);
  mounted = null;
});

function buttonByText(host: HTMLElement, text: string): HTMLButtonElement | null {
  return [...host.querySelectorAll("button")].find((b) => b.textContent === text) ?? null;
}

async function type(host: HTMLElement, value: string): Promise<void> {
  await act(async () => {
    const textarea = host.querySelector("textarea") as HTMLTextAreaElement;
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setValue?.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submit(host: HTMLElement): Promise<void> {
  await act(async () => {
    (host.querySelector("form") as HTMLFormElement).dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
}

describe("StepComposer", () => {
  it("默认开口执行模式提交并清空内容", async () => {
    const onSubmit = vi.fn();
    mounted = await renderDom(<StepComposer onSubmit={onSubmit} />);
    const host = mounted.host;
    await type(host, "  下场推进一段  ");
    await submit(host);
    expect(onSubmit).toHaveBeenCalledWith({ content: "下场推进一段", mode: "open", tags: [] });
    expect((host.querySelector("textarea") as HTMLTextAreaElement).value).toBe("");
  });

  it("切到即时点并选预设 tag 后提交", async () => {
    const onSubmit = vi.fn();
    mounted = await renderDom(<StepComposer onSubmit={onSubmit} />);
    const host = mounted.host;
    await click(buttonByText(host, "记一个点"));
    await click(buttonByText(host, "#批注"));
    await type(host, "这里要回看证据");
    await submit(host);
    expect(onSubmit).toHaveBeenCalledWith({ content: "这里要回看证据", mode: "instant", tags: ["批注"] });
  });

  it("空内容不提交", async () => {
    const onSubmit = vi.fn();
    mounted = await renderDom(<StepComposer onSubmit={onSubmit} />);
    const host = mounted.host;
    await type(host, "   ");
    await submit(host);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
