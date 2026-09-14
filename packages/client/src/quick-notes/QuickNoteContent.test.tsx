import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import QuickNoteContent from "./QuickNoteContent.js";

function render(text: string): string {
  return renderToStaticMarkup(createElement(QuickNoteContent, { text }));
}

describe("QuickNoteContent", () => {
  it("renders structural Markdown with compact bubble styles", () => {
    const html = render("**重点**\n\n- A\n- B");

    expect(html).toContain("<strong>重点</strong>");
    expect(html).toContain("<ul");
    expect(html).toContain("list-disc");
  });

  // 气泡正文外层有 overflow-hidden（折叠用），外侧序号只能落在 ol 自己的左缩进里；
  // 缩进不够宽，「10.」的首位就被裁成「0.」。
  it("sizes ordered-list indent to the widest marker so it is not clipped", () => {
    const tenItems = Array.from({ length: 10 }, (_, i) => `${i + 1}. 项`).join("\n");

    expect(render("1. 甲\n2. 乙")).toContain('style="margin-inline-start:2.5ch"');
    expect(render(tenItems)).toContain('style="margin-inline-start:3.5ch"');
    expect(render("98. 甲\n99. 乙\n100. 丙")).toContain('style="margin-inline-start:4.5ch"');
  });

  it("adds safe target and rel attributes to links", () => {
    const html = render("见 [文档](https://example.com)");

    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer"');
    expect(html).toContain("text-accent");
    expect(html).not.toContain("text-emerald");
  });

  it("uses token chrome for Markdown blocks and tables", () => {
    const html = render("> 引用\n\n`code`\n\n| A |\n| - |\n| B |");

    expect(html).toContain("border-border");
    expect(html).toContain("bg-surface-elevated");
    expect(html).not.toContain(["slate", ""].join("-"));
  });

  it("escapes raw HTML instead of rendering it", () => {
    const html = render("<img src=x onerror=alert(1)>");

    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img");
  });

  it("does not keep javascript links clickable", () => {
    const html = render("[x](javascript:alert(1))");

    expect(html).not.toContain("javascript:");
  });

  it("keeps non-markdown text in the plain text renderer", () => {
    const html = render("看 https://example.com/path_with_under_score 这个链接");

    expect(html).toContain('class="whitespace-pre-wrap break-words"');
    expect(html).not.toContain("<a ");
  });
});
