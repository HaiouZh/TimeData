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
    expect(css).toContain("--color-data-purple: #a78bfa;");
    expect(css).toContain(
      '--font-body: "Times New Roman", "Tinos", "LXGW WenKai Screen", "KaiTi", "STKaiti", serif;',
    );
  });

  it("defines motion duration and easing tokens", () => {
    expect(css).toContain("--duration-fast: 150ms;");
    expect(css).toContain("--duration-base: 200ms;");
    expect(css).toContain("--duration-slow: 300ms;");
    expect(css).toContain("--ease-standard:");
  });

  it("defines a z-index layer ladder", () => {
    expect(css).toContain("--z-sticky: 20;");
    expect(css).toContain("--z-dropdown: 30;");
    expect(css).toContain("--z-backdrop: 40;");
    expect(css).toContain("--z-modal: 50;");
    expect(css).toContain("--z-top: 70;");
  });

  it("does not expose retired module signature color tokens", () => {
    expect(css).not.toContain("--color-mod-note");
    expect(css).not.toContain("--color-mod-timeline");
    expect(css).not.toContain("--color-mod-todo");
    expect(css).not.toContain("--color-mod-health");
    expect(css).not.toContain("--color-mod-settings");
    expect(css).not.toContain("--color-mod-track");
    expect(css).not.toContain("--color-mod-goal");
    expect(css).not.toContain("--color-mod-time");
  });

  it("applies body and code font families from tokens", () => {
    expect(css).toMatch(/body\s*\{\s*font-family:\s*var\(--font-body\);\s*\}/);
    expect(css).toMatch(/code,\npre,\nkbd,\nsamp\s*\{\s*font-family:\s*var\(--font-mono\);\s*\}/);
  });

  it("defines TimeData typography roles on top of the body font", () => {
    expect(css).toContain(".td-text-caption");
    expect(css).toContain(".td-text-label");
    expect(css).toContain(".td-text-body");
    expect(css).toContain(".td-text-title");
    expect(css).toContain(".td-text-display");
    expect(css).toContain(".td-num");
    expect(css).toContain(".td-time");
    expect(css).toContain(".td-duration");
    expect(css).toContain(".td-stat");
    expect(css).toContain(".td-metric");
    expect(css).toContain("font-family: var(--font-body)");
    expect(css).toContain("font-variant-numeric: tabular-nums");
  });

  it("clips todo drag rows horizontally while allowing vertical dnd movement", () => {
    expect(css).toMatch(
      /\.todo-dnd-dragging \.swipeable-list-item\s*\{\s*overflow-x:\s*clip;\s*overflow-y:\s*visible;\s*\}/,
    );
  });

  it("keeps health range presets visible instead of hiding horizontal overflow", () => {
    expect(css).toMatch(/\.health-page-header \.health-range-selector\s*\{[^}]*flex-wrap:\s*wrap;/s);
    expect(css).not.toContain(".health-page-header .health-range-selector::-webkit-scrollbar");
    expect(css).not.toMatch(/\.health-page-header \.health-range-selector\s*\{[^}]*scrollbar-width:\s*none;/s);
    expect(css).not.toMatch(/\.health-page-header \.health-range-selector\s*\{[^}]*overflow-x:\s*auto;/s);
  });
});
