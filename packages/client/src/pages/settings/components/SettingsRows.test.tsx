import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { SettingsRow, SettingsSection, SettingsToggleRow } from "./SettingsRows.js";

describe("SettingsRows", () => {
  it("renders link, action, and toggle rows with design tokens", () => {
    const onAction = vi.fn();
    const onToggle = vi.fn();

    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(
          SettingsSection,
          { title: "记录偏好", description: "记录相关设置" },
          createElement(SettingsRow, {
            to: "/settings/insights",
            accent: "settings",
            icon: createElement("span", null, "i"),
            title: "记录偏好",
            subtitle: "待办默认落点、打点分类、睡眠分类",
          }),
          createElement(SettingsRow, {
            accent: "time",
            icon: createElement("span", null, "a"),
            title: "立即同步",
            onClick: onAction,
          }),
          createElement(SettingsToggleRow, {
            title: "启用",
            checked: true,
            onChange: onToggle,
          }),
        ),
      ),
    );

    expect(html).toContain('href="/settings/insights"');
    expect(html).toContain("<button");
    expect(html).toContain('role="switch"');
    expect(html).not.toContain("slate-");
  });
});
