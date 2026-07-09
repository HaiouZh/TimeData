// @vitest-environment jsdom
import { act, createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderDom, unmount } from "../../test/domHarness.js";
import SettingsDiaryPage from "./SettingsDiaryPage.js";

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderPage() {
  const { host, root } = await renderDom(createElement(MemoryRouter, null, createElement(SettingsDiaryPage)));
  await flushEffects();
  return { host, root };
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/diary/config") && init?.method === "PUT") {
        const body = JSON.parse(String(init?.body)) as { template: string };
        if (body.template === "坏模板") {
          return jsonResponse({ error: "模板格式不合法" }, { status: 400 });
        }
        return jsonResponse({ ok: true });
      }
      if (url.endsWith("/api/diary/config")) {
        return jsonResponse({ enabled: true, template: "日记_{yyyy}/{yyyy}-{MM}-{dd}.md" });
      }
      return jsonResponse({ error: "not_found" }, { status: 404 });
    }),
  );
});

describe("SettingsDiaryPage", () => {
  it("载入后显示现有模板", async () => {
    const { host, root } = await renderPage();

    const input = host.querySelector('textarea[name="template"], input[name="template"]') as
      | HTMLTextAreaElement
      | HTMLInputElement;
    expect(input.value).toBe("日记_{yyyy}/{yyyy}-{MM}-{dd}.md");

    await unmount(root);
  });

  it("保存时调用 saveDiaryTemplate", async () => {
    const { host, root } = await renderPage();

    const input = host.querySelector('textarea[name="template"], input[name="template"]') as
      | HTMLTextAreaElement
      | HTMLInputElement;
    const nativeValueSetter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(input),
      "value",
    )?.set;

    await act(async () => {
      nativeValueSetter?.call(input, "日记_{yyyy}/新模板/{yyyy}-{MM}-{dd}.md");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const saveButton = [...host.querySelectorAll("button")].find((button) => button.textContent === "保存");
    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushEffects();

    const putCall = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
      ([url, opts]) => String(url).endsWith("/api/diary/config") && opts?.method === "PUT",
    );
    expect(JSON.parse(String(putCall?.[1]?.body))).toEqual({ template: "日记_{yyyy}/新模板/{yyyy}-{MM}-{dd}.md" });

    await unmount(root);
  });

  it("服务器 400 时在表单下显示错误文案", async () => {
    const { host, root } = await renderPage();

    const input = host.querySelector('textarea[name="template"], input[name="template"]') as
      | HTMLTextAreaElement
      | HTMLInputElement;
    const nativeValueSetter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(input),
      "value",
    )?.set;

    await act(async () => {
      nativeValueSetter?.call(input, "坏模板");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const saveButton = [...host.querySelectorAll("button")].find((button) => button.textContent === "保存");
    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushEffects();

    expect(host.textContent).toContain("模板格式不合法");

    await unmount(root);
  });
});
