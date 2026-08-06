import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyLine,
  collectViolations,
  isAllowed,
  loadAllowlist,
  setSemanticColorNamesForTests,
} from "./check-design-language.mjs";

function hasRule(violations, rule) {
  return violations.some((violation) => violation.rule === rule);
}

test("flags retired module colors", () => {
  assert.equal(
    classifyLine("x.tsx", 'className="text-mod-time"').some((violation) => violation.rule === "retired-module-colors"),
    true,
  );
});

test("flags retired data palette tokens and utilities", () => {
  assert.equal(
    classifyLine("packages/client/src/index.css", "  --color-data-blue: #4f9bf5;").some(
      (violation) => violation.rule === "retired-data-colors",
    ),
    true,
  );
  assert.equal(
    classifyLine("x.tsx", 'className="text-data-purple bg-data-blue/10"').some(
      (violation) => violation.rule === "retired-data-colors",
    ),
    true,
  );
});

test("allows the scoped Track agent signal token", () => {
  assert.equal(classifyLine("x.tsx", 'className="text-track-agent bg-track-agent/10"').length, 0);
});

test("flags retired motion tokens and utilities", () => {
  assert.equal(
    classifyLine("packages/client/src/index.css", "  --duration-fast: 150ms;").some(
      (violation) => violation.rule === "retired-motion-tokens",
    ),
    true,
  );
  assert.equal(
    classifyLine("x.tsx", 'className="duration-base ease-standard"').some(
      (violation) => violation.rule === "retired-motion-tokens",
    ),
    true,
  );
  assert.equal(
    classifyLine("x.tsx", 'style={{ transitionDuration: "var(--duration-base)" }}').some(
      (violation) => violation.rule === "retired-motion-tokens",
    ),
    true,
  );
});

test("flags retired soft status colors and allows alpha utilities", () => {
  assert.equal(
    classifyLine("packages/client/src/index.css", "  --color-ok-soft: #123456;").some(
      (violation) => violation.rule === "retired-soft-status-colors",
    ),
    true,
  );
  assert.equal(
    classifyLine("x.tsx", 'className="bg-ok-soft text-ok-soft"').some(
      (violation) => violation.rule === "retired-soft-status-colors",
    ),
    true,
  );
  assert.equal(
    classifyLine("x.tsx", 'className="bg-warn-soft hover:bg-danger-soft/80"').some(
      (violation) => violation.rule === "retired-soft-status-colors",
    ),
    true,
  );
  assert.equal(
    classifyLine("x.tsx", 'className="text-danger-soft border-warn-soft/50 ring-danger-soft"').some(
      (violation) => violation.rule === "retired-soft-status-colors",
    ),
    true,
  );
  assert.equal(classifyLine("x.tsx", 'className="bg-warn/10 hover:bg-danger/15"').length, 0);
});

test("flags bare blue action classes", () => {
  assert.equal(
    classifyLine("x.tsx", 'className="bg-blue-600"').some((violation) => violation.rule === "bare-action-blue"),
    true,
  );
  assert.equal(
    classifyLine("x.tsx", 'className="stroke-blue-500"').some((violation) => violation.rule === "bare-action-blue"),
    true,
  );
  assert.equal(
    classifyLine("x.tsx", 'className="shadow-blue-500/30 decoration-sky-400"').some(
      (violation) => violation.rule === "bare-action-blue",
    ),
    true,
  );
});

test("flags bare status classes", () => {
  assert.equal(
    classifyLine("x.tsx", 'className="text-emerald-400"').some((violation) => violation.rule === "bare-status-color"),
    true,
  );
  assert.equal(
    classifyLine("x.tsx", 'className="outline-red-500 caret-emerald-400"').some(
      (violation) => violation.rule === "bare-status-color",
    ),
    true,
  );
  assert.equal(
    classifyLine("x.tsx", 'className="bg-yellow-500 text-orange-300 accent-gray-400"').some(
      (violation) => violation.rule === "bare-status-color",
    ),
    true,
  );
});

test("flags bare slate classes beyond text and background", () => {
  assert.equal(
    classifyLine("x.tsx", 'className="fill-slate-100 stroke-slate-400"').some(
      (violation) => violation.rule === "bare-slate-chrome",
    ),
    true,
  );
  assert.equal(
    classifyLine("x.tsx", 'className="shadow-slate-950/40 decoration-slate-400"').some(
      (violation) => violation.rule === "bare-slate-chrome",
    ),
    true,
  );
});

test("flags bare black/white named colors and allows token substitutes", () => {
  assert.equal(
    classifyLine("x.tsx", 'className="bg-black/50"').some((violation) => violation.rule === "bare-black-white"),
    true,
  );
  assert.equal(
    classifyLine("x.tsx", 'className="bg-black/60 text-white border-white/90"').some(
      (violation) => violation.rule === "bare-black-white",
    ),
    true,
  );
  assert.equal(
    classifyLine("x.tsx", 'className="hover:bg-white ring-black/20"').some(
      (violation) => violation.rule === "bare-black-white",
    ),
    true,
  );
  assert.equal(
    classifyLine("x.tsx", 'className="bg-backdrop/50 text-accent-contrast border-accent-ink/90"').length,
    0,
  );
  assert.equal(classifyLine("x.tsx", 'className="text-black bg-white"').some((v) => v.rule === "bare-black-white"), true);
});

test("flags arbitrary named black/white and directional border variants", () => {
  assert.equal(
    classifyLine("x.tsx", 'className="bg-[white] text-[black]"').some((v) => v.rule === "bare-black-white"),
    true,
  );
  assert.equal(
    classifyLine("x.tsx", 'className="bg-[white/50]"').some((v) => v.rule === "bare-black-white"),
    true,
  );
  assert.equal(
    classifyLine("x.tsx", 'className="border-t-white border-x-black"').some((v) => v.rule === "bare-black-white"),
    true,
  );
  assert.equal(
    classifyLine("x.tsx", 'className="bg-[#ffffff]"').some((v) => v.rule === "bare-black-white"),
    false,
  );
});

test("flags bare raw colors outside token declarations", () => {
  assert.equal(
    classifyLine("x.tsx", 'style={{ color: "#60a5fa" }}').some((violation) => violation.rule === "bare-raw-color"),
    true,
  );
  assert.equal(
    classifyLine("x.tsx", 'style={{ color: "oklch(62% 0.2 250)" }}').some(
      (violation) => violation.rule === "bare-raw-color",
    ),
    true,
  );
});

test("flags business typography that directly uses font-mono", () => {
  const violation = classifyLine("x.tsx", '<time className="font-mono text-xs">12:00</time>').find(
    (item) => item.rule === "font-mono-business-number",
  );
  assert.ok(violation);
  assert.match(violation.message, /td-num\/td-time\/td-duration/);
  assert.doesNotMatch(violation.message, /td-stat|td-metric/);
  assert.equal(
    classifyLine("x.tsx", '<td className="px-2 font-mono">12:00</td>').some(
      (violation) => violation.rule === "font-mono-business-number",
    ),
    true,
  );
  assert.equal(
    classifyLine("x.tsx", '<span className={cn("font-mono", active && "text-ink")}>12:00</span>').some(
      (violation) => violation.rule === "font-mono-business-number",
    ),
    true,
  );
  // token 名 / var() 引用是技术标识，不算业务 font-mono
  assert.equal(classifyLine("x.tsx", '["--font-mono", "JetBrains Mono"]').length, 0);
  assert.equal(classifyLine("x.tsx", "font-family: var(--font-mono)").length, 0);
});

test("flags string and entity text icons in interactive content", () => {
  assert.equal(
    classifyLine("x.tsx", '<button>{"×"}</button>').some((violation) => violation.rule === "interactive-text-icon"),
    true,
  );
  assert.equal(
    classifyLine("x.tsx", "<button>&times;</button>").some((violation) => violation.rule === "interactive-text-icon"),
    true,
  );
  assert.equal(
    classifyLine("x.tsx", '<button>{"+"}</button>').some((violation) => violation.rule === "interactive-text-icon"),
    true,
  );
  assert.equal(
    classifyLine("x.tsx", '<button>{"..."}</button>').some((violation) => violation.rule === "interactive-text-icon"),
    true,
  );
  assert.equal(
    classifyLine("x.tsx", '<button>{"-"}</button>').some((violation) => violation.rule === "interactive-text-icon"),
    true,
  );
});

test("flags the icon characters that actually shipped as fake icons", () => {
  // 真闸验证：这些字符曾经在生产代码里当图标用而白名单认不出。注意 `−` 是 U+2212 减号、
  // 不是 ASCII `-`；`▢`/`⤢` 是 TaskDetailSheet 的放大还原钮。
  for (const glyph of ["▢", "⤢", "−", "⋮", "▾", "❯", "✖", "☰"]) {
    assert.equal(
      classifyLine("x.tsx", `<button type="button" onClick={onToggle}>${glyph}</button>`).some(
        (v) => v.rule === "interactive-text-icon",
      ),
      true,
      `should flag: ${glyph}`,
    );
  }
});

test("does not treat real text punctuation as a fake icon", () => {
  // 破折号 / en dash / 数学符号是正文内容，收进白名单会大面积误报
  for (const glyph of ["—", "–", "±", "÷", "≈", "•"]) {
    assert.equal(
      classifyLine("x.tsx", `<button type="button" onClick={onToggle}>${glyph}</button>`).some(
        (v) => v.rule === "interactive-text-icon",
      ),
      false,
      `should not flag: ${glyph}`,
    );
  }
});

test("flags a text icon that sits alone on its own line", () => {
  // 洞②：符号独占一行时 `>` 与 `<` 不在同一行，单行正则匹配不到。
  // 用的是 SettingsNumberRow 步进钮的原文形态（`−` = U+2212）。
  const result = collectViolations({
    files: [
      {
        file: "x.tsx",
        content: `        <button
          type="button"
          aria-label={\`减少 \${title}\`}
          onClick={() => onChange(clamp(value - step))}
          className="flex h-7 w-7 items-center justify-center rounded-ctl"
        >
          −
        </button>`,
      },
    ],
    allowlist: loadAllowlist({ entries: [] }),
  });

  const hits = result.violations.filter((violation) => violation.rule === "interactive-text-icon");
  assert.deepEqual(hits.map((hit) => hit.line), [7]);
});

test("flags a text icon inside a multi-line JSX literal expression", () => {
  // TaskDetailSheet 放大/还原钮的原文形态：`{expanded ? "▢" : "⤢"}` 独占一行
  const result = collectViolations({
    files: [
      {
        file: "x.tsx",
        content: `          <button
            type="button"
            aria-label={expanded ? "还原" : "放大"}
            onClick={() => setExpanded((value) => !value)}
            className="absolute right-3 rounded-ctl px-2 py-1"
          >
            {expanded ? "▢" : "⤢"}
          </button>`,
      },
    ],
    allowlist: loadAllowlist({ entries: [] }),
  });

  const hits = result.violations.filter((violation) => violation.rule === "interactive-text-icon");
  assert.deepEqual(hits.map((hit) => hit.line), [7]);
});

test("cross-line text icon scan does not swallow surrounding JSX", () => {
  // `[^<>]*` 把匹配锁在一对尖括号之间：属性里的箭头函数 `=>` 与它带的字符串字面量不算子节点，
  // 正常文案子节点也不该因为跨行扫描被吞进来。
  const result = collectViolations({
    files: [
      {
        file: "x.tsx",
        content: `        <button
          type="button"
          onClick={(event) => setSeparator("-")}
          title={t("x")}
        >
          删除
        </button>
        <p>
          这段是正文，里面有 — 破折号
        </p>`,
      },
      // 非交互上下文里的省略号是正常文案
      { file: "y.tsx", content: `<span>\n  …\n</span>` },
    ],
    allowlist: loadAllowlist({ entries: [] }),
  });

  assert.deepEqual(result.violations.filter((v) => v.rule === "interactive-text-icon"), []);
});

test("flags text icons in multiline interactive content", () => {
  const result = collectViolations({
    files: [
      {
        file: "x.tsx",
        content: `<button type="button">
  <span>Open</span>
  <span>›</span>
</button>`,
      },
    ],
    allowlist: loadAllowlist({ entries: [] }),
  });

  assert.equal(result.violations.some((violation) => violation.rule === "interactive-text-icon"), true);
});

test("flags td-text-* on input controls", () => {
  // index.css 把 input/textarea/select 兜底到 16px 消除 iOS 聚焦缩放，
  // 而 td-text-* 三档都小于 16px；类选择器优先级更高，加上去就把兜底顶掉了。
  const result = collectViolations({
    files: [
      {
        file: "x.tsx",
        content: `<input
  type="text"
  onChange={(e) => setValue(e.target.value)}
  className="rounded-ctl px-2 td-text-body text-ink"
/>`,
      },
      {
        file: "y.tsx",
        content: `<textarea className="min-h-16 td-text-caption text-ink" />`,
      },
    ],
    allowlist: loadAllowlist({ entries: [] }),
  });

  const hits = result.violations.filter((violation) => violation.rule === "input-font-size-override");
  assert.equal(hits.length, 2);
});

test("does not flag td-text-* outside input controls", () => {
  const result = collectViolations({
    files: [
      { file: "x.tsx", content: `<span className="td-text-body">正文</span>` },
      {
        file: "y.tsx",
        // 标签已闭合，后面这行的字号类不属于输入控件
        content: `<input type="text" className="px-2" />
<p className="td-text-caption">说明文字</p>`,
      },
    ],
    allowlist: loadAllowlist({ entries: [] }),
  });

  assert.equal(
    result.violations.some((violation) => violation.rule === "input-font-size-override"),
    false,
  );
});

test("does not flag token classes", () => {
  assert.equal(classifyLine("x.tsx", 'className="bg-accent text-ink border-border"').length, 0);
});

test("skips color fixture checks in test files", () => {
  assert.equal(classifyLine("x.test.tsx", 'expect(html).toContain("text-mod-time")').length, 0);
  assert.equal(classifyLine("x.test.tsx", 'const color = "#60a5fa";').length, 0);
  assert.equal(classifyLine("x.test.tsx", 'expect(css).toContain("font-family: var(--font-mono)")').length, 0);
  assert.equal(classifyLine("x.test.tsx", 'className="text-white bg-black/50"').length, 0);
});

test("keeps interactive icon checks active in test files", () => {
  assert.equal(
    classifyLine("x.test.tsx", "<button>×</button>").some((violation) => violation.rule === "interactive-text-icon"),
    true,
  );
});

test("does not flag non-interactive overflow text", () => {
  assert.equal(classifyLine("x.tsx", "<span>…</span>").length, 0);
});

test("does not flag theme token declarations as bare raw colors", () => {
  assert.equal(classifyLine("packages/client/src/index.css", "  --color-accent: #4f9bf5;").length, 0);
  assert.equal(
    classifyLine("packages/client/src/feature.css", "  --color-local-accent: #4f9bf5;").some(
      (violation) => violation.rule === "bare-raw-color",
    ),
    true,
  );
});

test("does not flag shadow token declarations in index.css", () => {
  assert.equal(
    classifyLine("packages/client/src/index.css", "  --shadow-elev2: 0 8px 30px rgba(0,0,0,.4);").length,
    0,
  );
  // 非 index.css 的 --shadow-* 仍按裸色处理
  assert.equal(
    classifyLine("packages/client/src/other.css", "  --shadow-elev2: 0 8px 30px rgba(0,0,0,.4);").some(
      (violation) => violation.rule === "bare-raw-color",
    ),
    true,
  );
});

test("does not flag hex inside the chart color mirror file", () => {
  assert.equal(
    classifyLine("packages/client/src/pages/stats/chartColors.ts", '  tooltipBg: "#1b2336",').length,
    0,
  );
  // 同样的镜像值出现在普通文件里仍是裸色违规
  assert.equal(
    classifyLine("packages/client/src/pages/stats/InsightCharts.tsx", '  background: "#1b2336",').some(
      (violation) => violation.rule === "bare-raw-color",
    ),
    true,
  );
});

test("does not flag hex inside the favicon token mirror file", () => {
  assert.equal(
    classifyLine("packages/client/src/lib/navigation/routeFavicon.ts", 'const TILE_COLOR = "#0e1320";').length,
    0,
  );
  // 同样的镜像值出现在普通文件里仍是裸色违规
  assert.equal(
    classifyLine("packages/client/src/pages/Other.tsx", 'const TILE_COLOR = "#0e1320";').some(
      (violation) => violation.rule === "bare-raw-color",
    ),
    true,
  );
});

test("flags font-mono inside multiline class arrays", () => {
  const result = collectViolations({
    files: [
      {
        file: "x.tsx",
        content: `<span
  className={[
    "inline-flex font-mono text-xs",
    className,
  ].join(" ")}
/>`,
      },
    ],
    allowlist: loadAllowlist({ entries: [] }),
  });

  assert.equal(result.violations.some((violation) => violation.rule === "font-mono-business-number"), true);
});

test("matches allowlist by normalized file, rule, and line text", () => {
  const allowlist = loadAllowlist({
    entries: [
      {
        file: "packages/client/src/pages/QuickNotesPage.tsx",
        rule: "bare-slate-chrome",
        lineText: '<div className="bg-slate-900" />',
        reason: "旧债",
        ownerBatch: "P1-main-pages",
        removeBy: "P1",
      },
    ],
  });
  assert.equal(
    isAllowed(
      "packages\\client\\src\\pages\\QuickNotesPage.tsx",
      "bare-slate-chrome",
      '<div className="bg-slate-900" />',
      allowlist,
    ),
    true,
  );
  assert.equal(
    isAllowed("packages/client/src/pages/QuickNotesPage.tsx", "bare-slate-chrome", 'className="bg-slate-800"', allowlist),
    false,
  );
  assert.equal(
    isAllowed("packages/client/src/pages/QuickNotesPage.tsx", "bare-action-blue", 'className="bg-slate-900"', allowlist),
    false,
  );
});

test("reports stale allowlist entries", () => {
  const allowlist = loadAllowlist({
    entries: [
      {
        file: "x.tsx",
        rule: "bare-slate-chrome",
        lineText: '<div className="bg-slate-900" />',
        reason: "旧债",
        ownerBatch: "P1-main-pages",
        removeBy: "P1",
      },
      {
        file: "x.tsx",
        rule: "bare-action-blue",
        lineText: 'className="bg-blue-600"',
        reason: "旧债",
        ownerBatch: "P1-main-pages",
        removeBy: "P1",
      },
    ],
  });
  const result = collectViolations({
    files: [{ file: "x.tsx", content: '<div className="bg-slate-900" />\n' }],
    allowlist,
  });

  assert.equal(result.violations.length, 0);
  assert.deepEqual(result.staleAllowlist.map((entry) => `${entry.rule}:${entry.file}`), ["bare-action-blue:x.tsx"]);
});

test("does not let one allowlist entry cover duplicated line text", () => {
  const allowlist = loadAllowlist({
    entries: [
      {
        file: "x.tsx",
        rule: "bare-slate-chrome",
        lineText: '<div className="bg-slate-900" />',
        reason: "旧债",
        ownerBatch: "P1-main-pages",
        removeBy: "P1",
      },
    ],
  });
  const result = collectViolations({
    files: [{ file: "x.tsx", content: '<div className="bg-slate-900" />\n<div className="bg-slate-900" />' }],
    allowlist,
  });

  assert.deepEqual(result.violations.map((violation) => violation.rule), ["bare-slate-chrome"]);
  assert.equal(result.staleAllowlist.length, 0);
});

test("flags every retired production radius vocabulary", () => {
  for (const token of ["rounded-md", "rounded-lg", "rounded-xl", "rounded-2xl", "rounded-3xl", "rounded-full"]) {
    assert.equal(
      classifyLine("x.tsx", `className="${token}"`).some((violation) => violation.rule === "bare-card-radius"),
      true,
    );
  }
  for (const token of [
    "hover:rounded-t-xl",
    "rounded-s-xl",
    "rounded-e-xl",
    "rounded-ss-xl",
    "rounded-se-xl",
    "rounded-ee-xl",
    "rounded-es-xl",
  ]) {
    assert.equal(
      classifyLine("x.tsx", `className="${token}"`).some(
        (violation) => violation.rule === "bare-card-radius",
      ),
      true,
    );
  }
  assert.equal(
    classifyLine("x.tsx", 'className="rounded-[20px] rounded-[4rem]"').some(
      (violation) => violation.rule === "bare-card-radius",
    ),
    true,
  );
  assert.equal(classifyLine("x.tsx", 'className="rounded-sm rounded"').length, 0);
});

test("flags any global z-index level outside 0/10/20", () => {
  for (const token of ["z-30", "z-40", "z-50", "z-60", "z-70", "z-25", "z-45", "z-100", "z-9", "z-[30]"]) {
    assert.equal(
      classifyLine("x.tsx", `className="${token}"`).some((violation) => violation.rule === "bare-zindex"),
      true,
    );
  }
  for (const token of ["z-0", "z-10", "z-20", "z-[var(--z-modal)]", "z-10 hover:z-20"]) {
    assert.equal(classifyLine("x.tsx", `className="${token}"`).length, 0);
  }
});

test("allows the semantic radius vocabulary and test fixtures", () => {
  assert.equal(
    classifyLine("x.tsx", 'className="rounded rounded-sm rounded-ctl rounded-row rounded-card rounded-pill"').length,
    0,
  );
  assert.equal(classifyLine("x.test.tsx", 'expect(html).toContain("rounded-xl")').length, 0);
});

test("flags bare high z-index on global overlays", () => {
  assert.equal(classifyLine("x.tsx", 'className="fixed inset-0 z-50"').some((v) => v.rule === "bare-zindex"), true);
  assert.equal(classifyLine("x.tsx", 'className="z-[70]"').some((v) => v.rule === "bare-zindex"), true);
});

test("does not flag local stacking z-10/z-20", () => {
  assert.equal(classifyLine("x.tsx", 'className="relative z-10"').some((v) => v.rule === "bare-zindex"), false);
  assert.equal(classifyLine("x.tsx", 'className="relative z-20"').some((v) => v.rule === "bare-zindex"), false);
});

test("flags bare tailwind text sizes in components", () => {
  assert.equal(
    classifyLine("x.tsx", 'className="text-sm text-ink"').some((v) => v.rule === "bare-text-size"),
    true,
  );
  assert.equal(classifyLine("x.tsx", 'className="text-[11px]"').some((v) => v.rule === "bare-text-size"), true);
  assert.equal(classifyLine("x.tsx", 'className="td-text-body"').some((v) => v.rule === "bare-text-size"), false);
});

test("skips text-size checks in css and test files", () => {
  assert.equal(
    classifyLine("packages/client/src/index.css", "  font-size: 0.75rem;").some((v) => v.rule === "bare-text-size"),
    false,
  );
  assert.equal(
    classifyLine("x.test.tsx", 'expect(c).toContain("text-sm")').some((v) => v.rule === "bare-text-size"),
    false,
  );
});

test("flags bare arbitrary spacing/size values", () => {
  assert.equal(
    classifyLine("x.tsx", 'className="top-[4.75rem]"').some((v) => v.rule === "bare-arbitrary-value"),
    true,
  );
  assert.equal(classifyLine("x.tsx", 'className="w-[34px]"').some((v) => v.rule === "bare-arbitrary-value"), true);
});

test("does not flag calc/var/content arbitrary values", () => {
  assert.equal(
    classifyLine("x.tsx", 'className="top-[calc(100%+0.5rem)]"').some((v) => v.rule === "bare-arbitrary-value"),
    false,
  );
  assert.equal(
    classifyLine("x.tsx", 'className="z-[var(--z-modal)]"').some((v) => v.rule === "bare-arbitrary-value"),
    false,
  );
});

test("does not double-flag text arbitrary values under bare-arbitrary-value", () => {
  // 字号任意值归 bare-text-size（C1），bare-arbitrary-value 只管间距/尺寸/定位
  assert.equal(
    classifyLine("x.tsx", 'className="text-[11px]"').some((v) => v.rule === "bare-arbitrary-value"),
    false,
  );
});

test("validates allowlist schema", () => {
  assert.throws(
    () =>
      loadAllowlist({
        entries: [
          {
            file: "x.tsx",
            rule: "bare-slate-chrome",
            lineText: '<div className="bg-slate-900" />',
            reason: "旧债",
            ownerBatch: "P1-main-pages",
          },
        ],
      }),
    /removeBy/,
  );
});

test("flags handwritten segmented controls and allows SegmentedControl/tablist", () => {
  assert.equal(
    classifyLine("x.tsx", '<button aria-pressed={active} className="rounded-pill px-3 py-1">日</button>').some(
      (v) => v.rule === "handwritten-segmented-control",
    ),
    true,
  );
  assert.equal(
    classifyLine("x.tsx", '<button className="min-h-11 rounded-ctl" aria-pressed={active}>周</button>').some(
      (v) => v.rule === "handwritten-segmented-control",
    ),
    false,
  );
  // SegmentedControl 自身与 tablist 语义页豁免
  assert.equal(
    classifyLine("x.tsx", '<SegmentedControl aria-pressed={active} className="rounded-pill" />').some(
      (v) => v.rule === "handwritten-segmented-control",
    ),
    false,
  );
  assert.equal(
    classifyLine("x.tsx", '<button role="tab" aria-pressed={active} className="rounded-pill">标签</button>').some(
      (v) => v.rule === "handwritten-segmented-control",
    ),
    false,
  );
});

test("flags bare text empty states and allows EmptyState", () => {
  assert.equal(
    classifyLine("x.tsx", '<div className="px-4 py-10 text-center td-text-body">还没有记录</div>').some(
      (v) => v.rule === "bare-text-empty-state",
    ),
    true,
  );
  assert.equal(
    classifyLine("x.tsx", '<EmptyState variant="card" title="还没有记录" />').some(
      (v) => v.rule === "bare-text-empty-state",
    ),
    false,
  );
});

test("flags leading-* sitting next to td-text-* (dead class)", () => {
  // 正向与反向：两个类在同一 className 串里即违规，谁在前都算
  assert.equal(
    classifyLine("x.tsx", 'className="td-text-caption leading-none"').some(
      (v) => v.rule === "dead-leading-on-td-text",
    ),
    true,
  );
  assert.equal(
    classifyLine("x.tsx", 'className="leading-relaxed td-text-body"').some((v) => v.rule === "dead-leading-on-td-text"),
    true,
  );
  // 断点变体与任意值同样是死类
  assert.equal(
    classifyLine("x.tsx", 'className="td-text-body sm:leading-6"').some((v) => v.rule === "dead-leading-on-td-text"),
    true,
  );
  assert.equal(
    classifyLine("x.tsx", 'className="td-text-caption leading-[1.2]"').some((v) => v.rule === "dead-leading-on-td-text"),
    true,
  );
});

test("dead-leading-on-td-text is a real gate on the lines that actually shipped", () => {
  // 真闸验证：直接用曾经在仓库里的原文行，确认规则抓得到真实点位而非只抓构造用例
  const shipped = [
    '      <span className="td-text-caption leading-none">{item.label}</span>',
    '        className="absolute -right-2 -top-1 inline-flex min-w-4 items-center justify-center rounded-pill bg-accent px-1 td-text-caption leading-none text-page"',
    '          className={collapsed ? "sr-only" : "td-text-label w-full truncate font-semibold leading-tight"}',
    '                className="min-h-9 rounded-pill border px-2.5 td-text-caption leading-9"',
  ];
  for (const line of shipped) {
    assert.equal(
      classifyLine("packages/client/src/x.tsx", line).some((v) => v.rule === "dead-leading-on-td-text"),
      true,
      `should flag: ${line.trim()}`,
    );
  }
});

test("dead-leading-on-td-text does not fire without both classes on one string", () => {
  // leading-* 单独用在非 td-text-* 元素上完全合法，不能误伤
  assert.equal(
    classifyLine("x.tsx", 'className="leading-none text-ink"').some((v) => v.rule === "dead-leading-on-td-text"),
    false,
  );
  assert.equal(
    classifyLine("x.tsx", 'className="td-text-caption text-ink-3"').some((v) => v.rule === "dead-leading-on-td-text"),
    false,
  );
  // 跨属性不算同一 className 串
  assert.equal(
    classifyLine("x.tsx", '<div className="td-text-body" data-kind="leading-edge">').some(
      (v) => v.rule === "dead-leading-on-td-text",
    ),
    false,
  );
  // important 会翻转层级优先级、真的压过顶层规则，那不是死类，不该按死类报
  assert.equal(
    classifyLine("x.tsx", 'className="td-text-caption leading-6!"').some((v) => v.rule === "dead-leading-on-td-text"),
    false,
  );
  assert.equal(
    classifyLine("x.tsx", 'className="td-text-caption !leading-6"').some((v) => v.rule === "dead-leading-on-td-text"),
    false,
  );
  // 测试文件里的断言字符串不算违规
  assert.equal(
    classifyLine("x.test.tsx", 'expect(c).toContain("td-text-caption leading-none")').some(
      (v) => v.rule === "dead-leading-on-td-text",
    ),
    false,
  );
});

test("flags h1 without title size and allows title/display sized h1", () => {
  assert.equal(
    classifyLine("x.tsx", '<h1 className="td-text-body font-medium text-ink">日记</h1>').some(
      (v) => v.rule === "h1-without-title-size",
    ),
    true,
  );
  assert.equal(
    classifyLine("x.tsx", '<h1 className="td-text-title text-ink">日记</h1>').some(
      (v) => v.rule === "h1-without-title-size",
    ),
    false,
  );
  assert.equal(
    classifyLine("x.tsx", '<h1 className="td-text-display text-ink">设计语言预览</h1>').some(
      (v) => v.rule === "h1-without-title-size",
    ),
    false,
  );
});

test("flags unknown semantic color utilities (typo tokens)", () => {
  // 拼错 / 不存在于 index.css @theme 的语义色类名会静默失效——这是本规则要抓的核心形态
  for (const line of [
    'className="text-nonexistenttoken"',
    'className="bg-non-token"',
    'className="hover:text-inkk"',
    'className="md:bg-sureface"',
    'className="border-typo"',
    'className="ring-accentt"',
    'className="fill-inkk"',
    'className="placeholder:caret-inkk"',
  ]) {
    const violation = classifyLine("x.tsx", line).find((v) => v.rule === "unknown-semantic-color");
    assert.ok(violation, `should flag: ${line}`);
    assert.match(violation.message, /index\.css/);
    assert.match(violation.message, /静默失效/);
  }
});

test("does not flag known tokens or Tailwind builtin non-color utilities", () => {
  for (const line of [
    // 项目内真实 token
    'className="text-ink bg-surface border-border"',
    'className="hover:bg-accent-soft dark:border-danger text-track-agent"',
    'className="bg-accent/40 text-ink-2 ring-accent/30"',
    // Tailwind 内置非颜色用法
    'className="text-center text-left text-right"',
    'className="border-2 border-t-2 border-x"',
    'className="bg-cover bg-none bg-fixed"',
    'className="bg-gradient-to-r from-surface to-transparent"',
    'className="ring-1 ring-inset ring-offset-2 ring-offset-page"',
    'className="divide-x-2 divide-y divide-border"',
    'className="focus:outline-none outline-dashed"',
    'className="text-transparent text-current placeholder:text-ink-3"',
    'className="stroke-dasharray fill-none stroke-accent"',
    'className="decoration-wavy caret-accent accent-auto"',
    'className="text-xs sm:text-base md:text-lg"',
    'className="bg-origin-border bg-clip-text bg-blend-multiply"',
    // td- 语义类不是颜色 utility
    'className="td-text-caption text-ink"',
    'className="td-text-title text-page"',
  ]) {
    assert.equal(hasRule(classifyLine("x.tsx", line), "unknown-semantic-color"), false, line);
  }
});

test("does not double-report bare Tailwind palette utilities", () => {
  // 内置调色板裸色（slate-400 / blue-600 等）已由 bare-status-color / bare-action-blue 等管辖
  for (const line of [
    'className="text-slate-400"',
    'className="bg-blue-600/10"',
    'className="border-red-500"',
    'className="fill-emerald-400 stroke-rose-500"',
    'className="text-white bg-black/50"',
  ]) {
    assert.equal(hasRule(classifyLine("x.tsx", line), "unknown-semantic-color"), false, line);
  }
});

test("skips unknown semantic color checks in test files and css", () => {
  assert.equal(
    hasRule(classifyLine("x.test.tsx", 'expect(html).not.toContain("text-nonexistenttoken")'), "unknown-semantic-color"),
    false,
  );
  // index.css 里的 text-transform / border-radius 是 CSS 属性名不是 class
  assert.equal(
    hasRule(classifyLine("packages/client/src/index.css", "  text-transform: uppercase;"), "unknown-semantic-color"),
    false,
  );
  assert.equal(
    hasRule(classifyLine("packages/client/src/index.css", "  border-radius: var(--radius-pill);"), "unknown-semantic-color"),
    false,
  );
});

test("unknown semantic color uses the runtime token set, not a hardcoded list", () => {
  // 注入空集合后连 text-ink 都算未知——证明合法集合来自 index.css @theme 的运行时读取
  setSemanticColorNamesForTests([]);
  try {
    assert.equal(hasRule(classifyLine("x.tsx", 'className="text-ink"'), "unknown-semantic-color"), true);
    // 内置非颜色用法不受 token 集合影响
    assert.equal(hasRule(classifyLine("x.tsx", 'className="text-center"'), "unknown-semantic-color"), false);
  } finally {
    setSemanticColorNamesForTests(null);
  }
  assert.equal(hasRule(classifyLine("x.tsx", 'className="text-ink"'), "unknown-semantic-color"), false);
});

test("collectViolations reports unknown semantic colors with file and line", () => {
  const result = collectViolations({
    files: [
      {
        file: "packages/client/src/pages/x.tsx",
        content: 'export function X() {\n  return <div className="text-nonexistenttoken" />;\n}\n',
      },
    ],
    allowlist: loadAllowlist({ entries: [] }),
  });
  const hits = result.violations.filter((violation) => violation.rule === "unknown-semantic-color");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].file, "packages/client/src/pages/x.tsx");
  assert.equal(hits[0].line, 2);
});
