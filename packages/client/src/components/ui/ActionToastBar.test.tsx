import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ActionToastBar } from "./ActionToastBar.js";

describe("ActionToastBar", () => {
  it("toast 为 null 时不渲染", () => {
    const html = renderToStaticMarkup(
      createElement(ActionToastBar, { toast: null, onDismiss: () => {}, ariaLabel: "反馈" }),
    );
    expect(html).toBe("");
  });

  it("渲染 role=status、消息与动作按钮", () => {
    const html = renderToStaticMarkup(
      createElement(ActionToastBar, {
        toast: { message: "已打点 08:00–09:00", actions: [{ label: "撤销", onClick: () => {} }] },
        onDismiss: () => {},
        ariaLabel: "打点反馈",
      }),
    );
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="打点反馈"');
    expect(html).toContain("已打点 08:00–09:00");
    expect(html).toContain("撤销");
  });
});
