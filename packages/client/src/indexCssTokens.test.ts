import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./index.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");

describe("index.css design tokens", () => {
  it("defines the visual foundation after the Tailwind import", () => {
    const tailwindImport = css.indexOf('@import "tailwindcss";');
    const themeBlock = css.indexOf("@theme static");

    expect(tailwindImport).toBeGreaterThanOrEqual(0);
    expect(themeBlock).toBeGreaterThan(tailwindImport);
    expect(css).toContain("--color-page: #0e1320;");
    expect(css).toContain("--color-surface: #161d30;");
    expect(css).toContain("--color-mod-note: #2dd4bf;");
    expect(css).toContain("--color-data-purple: #a78bfa;");
    expect(css).toContain(
      '--font-body: "Times New Roman", "Tinos", "LXGW WenKai Screen", "KaiTi", "STKaiti", serif;',
    );
  });

  it("applies body and code font families from tokens", () => {
    expect(css).toMatch(/body\s*\{\s*font-family:\s*var\(--font-body\);\s*\}/);
    expect(css).toMatch(/code,\npre,\nkbd,\nsamp\s*\{\s*font-family:\s*var\(--font-mono\);\s*\}/);
  });
});
