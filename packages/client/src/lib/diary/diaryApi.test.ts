import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api.js";
import {
  DiaryConflictError,
  fetchDiary,
  fetchDiaryConfig,
  saveDiary,
  saveDiaryTemplate,
} from "./diaryApi.js";

function mockFetch(status: number, body: unknown) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
  );
}

describe("diaryApi", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    localStorage.setItem("timedata_api_url", "https://example.com");
  });

  it("fetchDiaryConfig 返回配置", async () => {
    mockFetch(200, { enabled: true, template: "模板" });
    await expect(fetchDiaryConfig()).resolves.toEqual({ enabled: true, template: "模板" });
  });

  it("saveDiaryTemplate 发起 PUT 请求", async () => {
    const fetchSpy = mockFetch(200, {});
    await saveDiaryTemplate("新模板");
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain("/api/diary/config");
    expect(init?.method).toBe("PUT");
    expect(init?.body).toBe(JSON.stringify({ template: "新模板" }));
  });

  it("fetchDiary 返回内容", async () => {
    mockFetch(200, { content: "hi", mtime: 123 });
    await expect(fetchDiary("2026-07-09")).resolves.toEqual({ content: "hi", mtime: 123 });
  });

  it("saveDiary 成功时返回服务器 mtime", async () => {
    mockFetch(200, { mtime: 789 });
    await expect(saveDiary("2026-07-09", { content: "x", baseMtime: 1 })).resolves.toEqual({ mtime: 789 });
  });

  it("saveDiary 遇 409 抛 DiaryConflictError 带服务器 mtime", async () => {
    mockFetch(409, { error: "diary-conflict", mtime: 456 });
    await expect(saveDiary("2026-07-09", { content: "x", baseMtime: 1 })).rejects.toSatisfy(
      (e: unknown) => e instanceof DiaryConflictError && e.mtime === 456,
    );
  });

  it("saveDiary 遇非 409 错误照常抛出原始错误", async () => {
    mockFetch(500, { error: "server-error" });
    await expect(saveDiary("2026-07-09", { content: "x", baseMtime: 1 })).rejects.not.toBeInstanceOf(
      DiaryConflictError,
    );
  });

  it("saveDiary 遇 409 diary-no-template 原样上抛 ApiError，不误判为冲突", async () => {
    mockFetch(409, { error: "diary-no-template" });
    await expect(saveDiary("2026-07-09", { content: "x", baseMtime: 1 })).rejects.toSatisfy(
      (e: unknown) => e instanceof ApiError && !(e instanceof DiaryConflictError),
    );
  });

  it("saveDiary 遇 vault 权限错误时抛出中文运维提示", async () => {
    mockFetch(503, {
      error: "diary-vault-not-writable",
      message: "服务器日记 vault 无写权限，请检查挂载目录所有权",
    });
    await expect(saveDiary("2026-07-09", { content: "x", baseMtime: 1 })).rejects.toThrow(
      "服务器日记 vault 无写权限，请检查 DIARY_VAULT_HOST_DIR 挂载目录的所有权",
    );
  });
});
