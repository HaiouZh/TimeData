// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SettingsGarminPage, {
  type GarminFetchResult,
  type GarminStatusResponse,
  type GarminConfigResponse,
} from "./SettingsGarminPage.js";
import {
  buildGarminFetchBody,
  formatGarminError,
  formatGarminFetchMessage,
  garminStatusLabel,
  validateGarminFetchForm,
} from "./SettingsGarminPage.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const syncContextState = vi.hoisted(() => ({
  apiUrl: "https://timedata.example",
}));

vi.mock("../../contexts/SyncContext.tsx", () => ({
  useSyncContext: () => ({ apiUrl: syncContextState.apiUrl }),
}));

const configResponse: GarminConfigResponse = {
  email: "user@example.com",
  password: "********",
  isCn: true,
  schedule: "07:30",
  enabled: true,
  lastFetchDate: "2026-06-12",
  initialBackfillDays: 7,
};

const statusResponse: GarminStatusResponse = {
  enabled: true,
  lastFetch: null,
  nextScheduled: "07:30",
  running: false,
};

const successResult: GarminFetchResult = {
  success: true,
  status: "success",
  trigger: "manual",
  runId: "run-1",
  startDate: "2026-06-12",
  endDate: "2026-06-13",
  counts: { health_heart_rate: 2 },
  errors: [],
  duration: 1200,
};

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

async function renderGarminPage() {
  const host = document.createElement("div");
  const root = createRoot(host);

  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(SettingsGarminPage)));
  });
  await flushEffects();

  return { host, root };
}

beforeEach(() => {
  syncContextState.apiUrl = "https://timedata.example";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/admin/garmin/config") && init?.method === "PUT") {
        return jsonResponse({ ok: true });
      }
      if (url.endsWith("/api/admin/garmin/config")) return jsonResponse(configResponse);
      if (url.endsWith("/api/admin/garmin/status")) return jsonResponse(statusResponse);
      if (url.endsWith("/api/admin/garmin/fetch")) return jsonResponse(successResult);
      return jsonResponse({ error: "not_found" }, { status: 404 });
    }),
  );
});

describe("SettingsGarminPage helpers", () => {
  it("builds an empty body for smart catch-up fetch", () => {
    expect(buildGarminFetchBody({ startDate: "", endDate: "", days: "" })).toEqual({});
  });

  it("builds a days body for forced recent refetch", () => {
    expect(buildGarminFetchBody({ startDate: "", endDate: "", days: "14" })).toEqual({ days: 14 });
  });

  it("rejects incomplete explicit date range before sending a request", () => {
    expect(validateGarminFetchForm({ startDate: "2026-06-01", endDate: "", days: "" })).toBe(
      "开始日期和结束日期需要同时填写",
    );
  });

  it("rejects reversed explicit date range before sending a request", () => {
    expect(validateGarminFetchForm({ startDate: "2026-06-10", endDate: "2026-06-01", days: "" })).toBe(
      "结束日期不能早于开始日期",
    );
  });

  it("rejects explicit date ranges longer than 90 days before sending a request", () => {
    expect(validateGarminFetchForm({ startDate: "2026-01-01", endDate: "2026-04-02", days: "" })).toBe(
      "手动日期范围最多 90 天",
    );
  });

  it("maps server error codes to Chinese messages", () => {
    expect(formatGarminError({ code: "script_not_found", message: "missing" })).toBe(
      "服务器未找到 Garmin 抓取脚本，检查部署镜像或脚本路径",
    );
    expect(formatGarminError({ code: "credentials_missing", message: "missing" })).toBe(
      "请先保存 Garmin 邮箱和密码",
    );
  });

  it("formats no-op result as already synced to yesterday", () => {
    expect(
      formatGarminFetchMessage({
        success: true,
        status: "no_op",
        trigger: "manual",
        runId: "run-1",
        startDate: "2026-06-13",
        endDate: "2026-06-13",
        counts: {},
        errors: [],
        duration: 12,
      }),
    ).toBe("已同步到昨天，无需抓取");
  });

  it("formats partial success with range and error details", () => {
    expect(
      formatGarminFetchMessage({
        success: false,
        status: "partial_success",
        trigger: "manual",
        runId: "run-2",
        startDate: "2026-06-01",
        endDate: "2026-06-02",
        counts: { health_heart_rate: 2, health_hrv: 1 },
        errors: [{ code: "validation_failed", message: "bad row", domain: "health_hrv", date: "2026-06-02" }],
        duration: 2500,
      }),
    ).toContain("部分成功");
  });

  it("shows stable Chinese labels for structured statuses", () => {
    expect(garminStatusLabel("success")).toBe("成功");
    expect(garminStatusLabel("partial_success")).toBe("部分成功");
    expect(garminStatusLabel("failed")).toBe("失败");
    expect(garminStatusLabel("no_op")).toBe("无需抓取");
  });
});

describe("SettingsGarminPage", () => {
  it("renders and saves initialBackfillDays", async () => {
    const { host, root } = await renderGarminPage();

    expect(host.textContent).toContain("首次回填天数");
    const initialInput = host.querySelector('input[name="initialBackfillDays"]') as HTMLInputElement;
    expect(initialInput.value).toBe("7");

    const nativeValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      nativeValueSetter?.call(initialInput, "14");
      initialInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const form = host.querySelector("form");
    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flushEffects();

    const putCall = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
      ([url, init]) => String(url).endsWith("/api/admin/garmin/config") && init?.method === "PUT",
    );
    expect(JSON.parse(String(putCall?.[1]?.body))).toMatchObject({ initialBackfillDays: 14 });

    await act(async () => {
      root.unmount();
    });
  });

  it("sends an empty body for smart manual fetch", async () => {
    const { host, root } = await renderGarminPage();

    const fetchButton = [...host.querySelectorAll("button")].find((button) => button.textContent === "立即抓取");
    await act(async () => {
      fetchButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushEffects();

    const fetchCall = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
      ([url, init]) => String(url).endsWith("/api/admin/garmin/fetch") && init?.method === "POST",
    );
    expect(JSON.parse(String(fetchCall?.[1]?.body))).toEqual({});

    await act(async () => {
      root.unmount();
    });
  });

  it("sends days for forced recent refetch", async () => {
    const { host, root } = await renderGarminPage();
    const daysInput = host.querySelector('input[name="fetchDays"]') as HTMLInputElement;
    const nativeValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;

    await act(async () => {
      nativeValueSetter?.call(daysInput, "10");
      daysInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const fetchButton = [...host.querySelectorAll("button")].find((button) => button.textContent === "立即抓取");
    await act(async () => {
      fetchButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushEffects();

    const fetchCall = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
      ([url, init]) => String(url).endsWith("/api/admin/garmin/fetch") && init?.method === "POST",
    );
    expect(JSON.parse(String(fetchCall?.[1]?.body))).toEqual({ days: 10 });

    await act(async () => {
      root.unmount();
    });
  });
});
