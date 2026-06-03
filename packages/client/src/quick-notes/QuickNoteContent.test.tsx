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

  it("adds safe target and rel attributes to links", () => {
    const html = render("见 [文档](https://example.com)");

    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer"');
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
