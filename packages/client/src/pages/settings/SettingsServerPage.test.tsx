// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SettingsServerPage from "./SettingsServerPage.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const updateApiUrlMock = vi.hoisted(() => vi.fn());
const isNativePlatformMock = vi.hoisted(() => vi.fn(() => false));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => isNativePlatformMock() },
}));

vi.mock("../../contexts/SyncContext.tsx", () => ({
  useSyncContext: () => ({
    apiUrl: localStorage.getItem("timedata_api_url") || "",
    updateApiUrl: updateApiUrlMock,
  }),
}));

const localStorageMock = (() => {
  let store = new Map<string, string>();

  return {
    clear: () => {
      store = new Map<string, string>();
    },
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };
})();

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  configurable: true,
});

describe("SettingsServerPage", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("timedata_api_url", "https://example.com");
    localStorage.setItem("timedata_api_token", "secret-token");
    updateApiUrlMock.mockClear();
    isNativePlatformMock.mockReturnValue(false);
  });

  it("renders server configuration controls with saved values", () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(SettingsServerPage)));

    expect(html).toContain("服务器配置");
    expect(html).toContain("API 地址");
    expect(html).toContain("Token");
    expect(html).toContain("https://example.com");
    expect(html).toContain("secret-token");
    expect(html).toContain("保存配置");
  });

  it("shows a warning that the API token is stored locally", () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(SettingsServerPage)));

    expect(html).toContain("Token 会保存在本机浏览器存储中");
  });

  it("strips Bearer prefix before saving api token", async () => {
    localStorage.setItem("timedata_api_token", "Bearer abc123");
    const host = document.createElement("div");
    const root = createRoot(host);

    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(SettingsServerPage)));
    });

    const saveButton = [...host.querySelectorAll("button")].find((item) => item.textContent === "保存配置");
    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(localStorage.getItem("timedata_api_token")).toBe("abc123");

    await act(async () => {
      root.unmount();
    });
  });

  it("saves api url through sync context", async () => {
    const host = document.createElement("div");
    const root = createRoot(host);

    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(SettingsServerPage)));
    });

    const apiInput = host.querySelector('input[type="url"]') as HTMLInputElement;
    apiInput.value = " https://new.example ";
    await act(async () => {
      apiInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const saveButton = [...host.querySelectorAll("button")].find((item) => item.textContent === "保存配置");
    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(updateApiUrlMock).toHaveBeenCalledWith("https://new.example");

    await act(async () => {
      root.unmount();
    });
  });

  it("rejects HTTP API URLs on native Android because cleartext is disabled", async () => {
    isNativePlatformMock.mockReturnValue(true);
    localStorage.setItem("timedata_api_url", "http://192.168.1.10:3000");
    const host = document.createElement("div");
    const root = createRoot(host);

    await act(async () => {
      root.render(createElement(MemoryRouter, null, createElement(SettingsServerPage)));
    });

    const saveButton = [...host.querySelectorAll("button")].find((item) => item.textContent === "保存配置");
    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(updateApiUrlMock).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Android App 不支持 HTTP 明文地址");
    expect(host.textContent).toContain("HTTPS 反向代理地址");

    await act(async () => {
      root.unmount();
    });
  });
});
