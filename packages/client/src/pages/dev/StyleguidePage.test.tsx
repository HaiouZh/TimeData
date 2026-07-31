import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import StyleguidePage from "./StyleguidePage.js";

describe("StyleguidePage", () => {
  it("renders token and typography sections", () => {
    const html = renderToStaticMarkup(<StyleguidePage />);
    expect(html).toContain("设计语言预览");
    expect(html).toContain("--color-accent");
    expect(html).toContain("--color-track-agent");
    expect(html).not.toContain("--color-data-");
    expect(html).not.toContain("--z-sticky");
    expect(html).not.toContain("--color-warn-soft");
    expect(html).not.toContain("--color-danger-soft");
    expect(html).not.toContain("--duration-");
    expect(html).not.toContain("--ease-");
    // 带右括号避开子串假绿（"--color-tint-1" 是 "--color-tint-10" 的前缀，
    // 支数缩到 1 支时那条断言照样绿）。
    for (let i = 1; i <= 9; i++) expect(html).toContain(`--color-tint-${i})`);
    // 验收台是这些色值定稿的唯一依据（ADR 0026 决策一）：
    // 只断言 token 名时，把整个验收台 Section 删掉也不红——色块预览里还留着 token 名。
    expect(html).toContain("身份色的真实形态");
  });

  it("lists the typography and number role classes", () => {
    const html = renderToStaticMarkup(<StyleguidePage />);
    expect(html).toContain("td-text-display");
    expect(html).toContain("td-num");
    expect(html).toContain("td-time");
    expect(html).toContain("td-duration");
  });
});
