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
    expect(css).toContain("--color-backdrop: #000000;");
    expect(css).toContain("--color-accent-contrast: #ffffff;");
    expect(css).toContain("--radius-ctl: 8px;");
    expect(css).toContain("--radius-row: 12px;");
    expect(css).toContain("--radius-card: 16px;");
    expect(css).toContain("--radius-pill: 999px;");
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

  it("keeps motion values local after retiring global motion tokens", () => {
    expect(css).not.toMatch(/--duration-(?:fast|base|slow):/);
    expect(css).not.toMatch(/--ease-(?:standard|emphasized):/);
    expect(css).toContain("animation: overlay-fade 150ms ease-out;");
    expect(css).toContain("animation: sheet-rise 200ms ease-out;");
    expect(css).toContain("300ms cubic-bezier(0.2, 0, 0, 1)");
  });

  it("keyboard-scroll-pad 给文档流表单制造键盘滚动空间（键盘高 + 按钮预留的 padding）", () => {
    // 短表单整页放得下时滚动容器无溢出，显式差值滚动的 scrollTop 会被 clamp 在 0（备注框仍被键盘
    // 盖住）--EntryForm 根容器挂本类，键盘弹起时 padding-bottom = 遮挡量 + 96px 造出可滚的量。
    // 变量由 KeyboardAvoidanceBridge 写入（键盘收起 / 安卓壳已让位时不落地，默认 0px 恒无副作用）。
    expect(css).toMatch(/\.keyboard-scroll-pad\s*\{[^}]*padding-bottom:\s*var\(--keyboard-scroll-padding,\s*0px\)/);
  });

  it("全仓不再有 scroll-padding 消费（引擎聚焦滚动不再吃到过期键盘量）", () => {
    // 安卓壳让位与插件事件有竞态：变量未清的窗口期里 Blink 原生聚焦滚动会把过期的 K+96 当目标，
    // 在已缩矮的视口上再让一次 = 双倍避让（真机「滑太高」）。落点计算已全部收进 JS 显式差值。
    expect(css).not.toMatch(/scroll-padding-bottom/);
  });

  it("keyboard-inset-pad 让固定填高容器给键盘让出底部（日记编辑器一类）", () => {
    // 固定高、内部滚动的编辑器（日记 textarea flex-1）不走滚动落点那套：键盘盖住容器下半截时
    // 光标行照样看不见。容器 padding-bottom 让高后 textarea 变矮，浏览器原生保证光标在其内滚窗可见。
    expect(css).toMatch(/\.keyboard-inset-pad\s*\{[^}]*padding-bottom:\s*var\(--keyboard-inset,\s*0px\)/);
  });

  it("底部弹层族给键盘让位：overlay 抬底 + 面板高度扣掉遮挡量", () => {
    // Sheet 从屏幕底升起（items-end），键盘弹起（iOS resize:none 悬浮）时面板下半截连同里面的
    // 输入框（任务详情的标题/备注、多选的项目名）一起被盖。overlay 的 padding-bottom 把面板整体
    // 抬到键盘上方；面板限高同步扣掉遮挡量，否则抬高后顶边冲出屏幕顶被截。
    expect(css).toMatch(/\.sheet-overlay\s*\{[^}]*padding-bottom:\s*var\(--keyboard-inset,\s*0px\)/);
    expect(css).toMatch(/\.sheet-panel\s*\{[^}]*max-height:\s*calc\(88vh - var\(--keyboard-inset,\s*0px\)\)/);
    expect(css).toMatch(/\.task-detail-sheet\s*\{\s*max-height:\s*calc\(90vh - var\(--keyboard-inset,\s*0px\)\)/);
    expect(css).toMatch(/\.task-detail-sheet-expanded\s*\{\s*height:\s*calc\(90vh - var\(--keyboard-inset,\s*0px\)\)/);
  });

  it("disables the looping sync animations when reduced motion is requested", () => {
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.animate-sync-pulse,\s*\.animate-sync-blink\s*\{\s*animation: none;\s*\}\s*\}/,
    );
  });

  it("derives soft status surfaces from the main status colors", () => {
    expect(css).not.toContain("--color-warn-soft");
    expect(css).not.toContain("--color-danger-soft");
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
    expect(css).not.toContain(".td-stat");
    expect(css).not.toContain(".td-metric");
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

// 这一组只能断言 CSS 文本，不能断言 getComputedStyle：页面级 jsdom 用例根本没加载 index.css
// （vitest 不注入样式表），computed visibility 恒为默认值，写出来是永绿的假闸。文本闸弱在
// 「不证明浏览器里真生效」，但它咬得住这三条会静默回潮的写法。
describe("速记日期条隐身态（.quick-note-date-divider.stuck）", () => {
  const block = css.slice(
    css.indexOf(".quick-note-date-divider {"),
    css.indexOf(".quick-note-time-spacer"),
  );

  it("用 visibility 隐身而不是 pointer-events：opacity:0 的元素仍可 Tab 聚焦、仍在无障碍树里", () => {
    expect(block).toMatch(/\.quick-note-date-divider\.stuck\s*\{[^}]*visibility:\s*hidden;/s);
    // pointer-events 立即生效而 opacity 走 300ms：淡出途中元素还清晰可见却点不到，点击穿透到气泡。
    // 先剥注释——上面这条解释里就写着这个词，不剥的话闸恒红。
    expect(block.replace(/\/\*[\s\S]*?\*\//g, "")).not.toContain("pointer-events");
  });

  it("visibility 延迟 300ms 才隐身、摘类时无延迟立刻回来", () => {
    expect(block).toMatch(/\.quick-note-date-divider\.stuck\s*\{[^}]*visibility 0s linear 300ms/s);
    expect(block).toMatch(/\.quick-note-date-divider\s*\{[^}]*visibility 0s linear 0s/s);
  });

  it("键盘焦点落在里面时不隐身（逃生阀）", () => {
    expect(block).toMatch(
      /\.quick-note-date-divider\.stuck:focus-within\s*\{[^}]*opacity:\s*1;[^}]*visibility:\s*inherit;/s,
    );
  });

  it("减弱动效时过渡时长与延迟一并归零", () => {
    expect(block).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{[^@]*\.quick-note-date-divider[^@]*transition-duration:\s*0s;[^@]*transition-delay:\s*0s;/s,
    );
  });
});

// iOS 的 KeptRouteStack 把整个保留层用 visibility:hidden 藏起来（不能用 display:none——无 layout box
// 会清掉滚动容器的 scrollTop，见 KeptRouteStack.tsx 纪律 2），且两层恒 absolute inset-0 相互重叠。
// visibility 是可继承属性：后代写死 `visibility: visible` 就把祖先的 hidden 反向击穿，该元素连同自己的
// z-index 一起浮到当前页之上。速记页日期条正是这样残留在时间轴页上（切页后胶囊还挂着）。
// 想让某个元素"默认可见、可被 .stuck 之类的类隐身"，写 `visibility: inherit` 而不是 visible：
// 常规页面下父级本就是 visible，行为一字不差；进了保留层则跟着一起藏。
describe("visibility 隐身层不得被后代击穿（iOS 保留层的地基）", () => {
  it("index.css 里没有任何写死的 visibility: visible", () => {
    // 先剥注释——上面这段解释里就写着这个词，不剥的话闸恒红。
    const cssWithoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(cssWithoutComments).not.toMatch(/visibility:\s*visible/);
  });
});
