import assert from "node:assert/strict";
import test from "node:test";
import { classifyLine, collectViolations, isAllowed, loadAllowlist } from "./check-design-language.mjs";

test("flags retired module colors", () => {
  assert.equal(
    classifyLine("x.tsx", 'className="text-mod-time"').some((violation) => violation.rule === "retired-module-colors"),
    true,
  );
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
  assert.equal(
    classifyLine("x.tsx", '<time className="font-mono text-xs">12:00</time>').some(
      (violation) => violation.rule === "font-mono-business-number",
    ),
    true,
  );
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

test("does not flag token classes", () => {
  assert.equal(classifyLine("x.tsx", 'className="bg-accent text-ink border-border"').length, 0);
});

test("skips color fixture checks in test files", () => {
  assert.equal(classifyLine("x.test.tsx", 'expect(html).toContain("text-mod-time")').length, 0);
  assert.equal(classifyLine("x.test.tsx", 'const color = "#60a5fa";').length, 0);
  assert.equal(classifyLine("x.test.tsx", 'expect(css).toContain("font-family: var(--font-mono)")').length, 0);
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
    classifyLine("packages/client/src/pages/stats/health/chartColors.ts", '  tooltipBg: "#1b2336",').length,
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
