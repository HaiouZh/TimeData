// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderDom, unmount } from "../../test/domHarness.js";
import { NewTrackComposer } from "./NewTrackComposer.js";

let mounted: Awaited<ReturnType<typeof renderDom>> | null = null;
afterEach(async () => {
  if (mounted) await unmount(mounted.root);
  mounted = null;
});

async function typeInto(input: HTMLInputElement, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  await act(async () => {
    setValue?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submit(form: HTMLFormElement) {
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

describe("NewTrackComposer", () => {
  it("submits a trimmed title and clears the field", async () => {
    const onCreate = vi.fn();
    mounted = await renderDom(<NewTrackComposer onCreate={onCreate} />);
    const host = mounted.host;
    const input = host.querySelector("input") as HTMLInputElement;
    await typeInto(input, "  新轨道  ");
    await submit(host.querySelector("form") as HTMLFormElement);
    expect(onCreate).toHaveBeenCalledWith("新轨道");
    expect((host.querySelector("input") as HTMLInputElement).value).toBe("");
  });

  it("ignores blank submissions", async () => {
    const onCreate = vi.fn();
    mounted = await renderDom(<NewTrackComposer onCreate={onCreate} />);
    await submit(mounted.host.querySelector("form") as HTMLFormElement);
    expect(onCreate).not.toHaveBeenCalled();
  });
});
