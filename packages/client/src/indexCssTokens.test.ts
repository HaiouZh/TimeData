import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./index.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");

/** 用户内容身份色，顺序即 `--color-tint-1..9`（见 ADR 0026）。 */
const TINT_HEXES = [
  "#fb923c",
  "#a3e635",
  "#4ade80",
  "#2dd4bf",
  "#38bdf8",
  "#818cf8",
  "#e879f9",
  "#f472b6",
  "#fda4af",
];

describe("index.css design tokens", () => {
  it("defines the visual foundation after the Tailwind import", () => {
    const tailwindImport = css.indexOf('@import "tailwindcss";');
    const themeBlock = css.indexOf("@theme static");

    expect(tailwindImport).toBeGreaterThanOrEqual(0);
    expect(themeBlock).toBeGreaterThan(tailwindImport);
    expect(css).toContain("--color-page: #0e1320;");
    expect(css).toContain("--color-surface: #161d30;");
    expect(css).not.toContain("--color-data-");
    expect(css).toContain("--color-track-agent: #a78bfa;");
    // 全 9 支逐支断言 + 计数：只钉首尾两支时，删掉中间任意几支照样全绿，
    // 而 contentTint 仍会把 `var(--color-tint-5)` 之类发给真实种子——那些圆点/`#`
    // 在真机上继承成透明，且 check:design 只拦裸色、不校验 var() 引用的 token 是否存在。
    expect(css.match(/--color-tint-\d+:/g)).toHaveLength(TINT_HEXES.length);
    TINT_HEXES.forEach((hex, i) => {
      expect(css).toContain(`--color-tint-${i + 1}: ${hex};`);
    });
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
    expect(css).not.toContain("--z-sticky:");
    expect(css).toContain("--z-dropdown: 30;");
    expect(css).toContain("--z-backdrop: 40;");
    expect(css).toContain("--z-modal: 50;");
    expect(css).toContain("--z-top: 70;");
  });

  it("layers a top hairline highlight into the dark elevation shadows", () => {
    expect(css).toMatch(/--shadow-elev1:[^;]*inset 0 1px 0/);
    expect(css).toMatch(/--shadow-elev2:[^;]*inset 0 1px 0/);
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

  it("disables scroll anchoring in the project group body so grab-to-hand does not yank scroll to top", () => {
    // 组内按状态排序：抓到手头的行瞬移到组内第一位，浏览器滚动锚定会跟着它把 scrollTop 拽到顶部。
    expect(css).toMatch(/\.todo-project-group-body\s*\{[^}]*overflow-anchor:\s*none;/s);
  });

  it("themes scrollbars via tokens with a transparent track and hover brighten", () => {
    // 滚动条纳入设计语言（spec: 2026-07-27-scrollbar-design-language）。
    // 用标准属性而非 ::-webkit-scrollbar：伪元素会让 Chrome/Edge 退化成常驻占位条。
    expect(css).toContain("--color-scrollbar-thumb: #3a4668;");
    expect(css).toContain("--color-scrollbar-thumb-hover: #4d5a80;");
    expect(css).toMatch(
      /html\s*\{[^}]*scrollbar-width:\s*thin;[^}]*scrollbar-color:\s*var\(--color-scrollbar-thumb\)\s+transparent;/s,
    );
    expect(css).toMatch(
      /:where\(:hover\)\s*\{\s*scrollbar-color:\s*var\(--color-scrollbar-thumb-hover\)\s+transparent;\s*\}/,
    );
    // 防回潮：全站不得引入 webkit 滚动条伪元素定制（转盘的 display:none 隐藏除外，它不改外观只隐藏）。
    // 只数选择器使用，先剥注释——CSS 注释里提到这个词不算数。
    const cssWithoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const webkitUses = cssWithoutComments.match(/::-webkit-scrollbar\b/g) ?? [];
    expect(webkitUses.length).toBe(1); // 仅 .wheel-scroll::-webkit-scrollbar 那一处
  });
});
