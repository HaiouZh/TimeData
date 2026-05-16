import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import SettingsAdminInsightsPage from "./SettingsAdminInsightsPage.js";

const fetchAdminSummary = vi.hoisted(() => vi.fn());
const fetchAdminEntries = vi.hoisted(() => vi.fn());
const fetchAdminCategories = vi.hoisted(() => vi.fn());
const fetchAdminSync = vi.hoisted(() => vi.fn());
const fetchAdminBackups = vi.hoisted(() => vi.fn());
const fetchAdminHealthChecks = vi.hoisted(() => vi.fn());
const fetchAdminAnalytics = vi.hoisted(() => vi.fn());

vi.mock("../../lib/adminApi.ts", () => ({
  fetchAdminSummary,
  fetchAdminEntries,
  fetchAdminCategories,
  fetchAdminSync,
  fetchAdminBackups,
  fetchAdminHealthChecks,
  fetchAdminAnalytics,
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("SettingsAdminInsightsPage", () => {
  it("renders the read-only admin insight shell", () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(SettingsAdminInsightsPage)));

    expect(html).toContain("服务端数据洞察");
    expect(html).toContain("只读查看服务器 SQLite 数据");
    expect(html).toContain("这里不会修改服务器数据");
    expect(html).toContain("正在加载服务端数据");
  });
});
