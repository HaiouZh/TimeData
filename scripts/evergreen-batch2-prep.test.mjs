import { test } from "node:test";
import assert from "node:assert/strict";
import * as prep from "./evergreen-batch2-prep.mjs";

test("buildHeadingIndex maps section numbers to headings", () => {
  const content = [
    "# 标题",
    "",
    "## 0. 账本模型",
    "",
    "正文",
    "",
    "### 2.1 客户端做了什么",
    "",
    "## 3.5 全量同步兜底",
  ].join("\n");

  const idx = prep.buildHeadingIndex(content);

  assert.equal(idx.get("0").title, "账本模型");
  assert.equal(idx.get("0").line, 3);
  assert.equal(idx.get("2.1").title, "客户端做了什么");
  assert.equal(idx.get("3.5").title, "全量同步兜底");
  assert.equal(idx.get("9"), undefined);
});

test("buildAnchorNeeds splits resolved / broken / ambiguous", () => {
  const docs = [
    {
      filePath: "docs/evergreen/a.md",
      content: [
        "见 [b](b.md) §1 的说明。",
        "还有 [b](b.md) §9 那节。",
        "以及 [b](b.md) §1 / §2 两处。",
      ].join("\n"),
    },
    {
      filePath: "docs/evergreen/b.md",
      content: ["## 1. 第一节", "", "## 2. 第二节"].join("\n"),
    },
  ];

  const { resolved, broken, ambiguous } = prep.buildAnchorNeeds(docs);

  const need = resolved.find((r) => r.target === "docs/evergreen/b.md" && r.section === "1");
  assert.ok(need, "§1 应当被解析为需求");
  assert.equal(need.title, "第一节");
  assert.equal(broken.length, 1);
  assert.equal(broken[0].section, "9");
  assert.equal(ambiguous.length, 1);
  assert.match(ambiguous[0].text, /§1 \/ §2/);
});

test("buildAnchorNeeds does not merge separate markdown links on one line", () => {
  const docs = [
    {
      filePath: "docs/evergreen/a.md",
      content: [
        "见 [b](b.md) §1；另见 [c](c.md) §2。",
        "混合 [b](b.md) §1 / §2；另见 [c](c.md) §2。",
      ].join("\n"),
    },
    { filePath: "docs/evergreen/b.md", content: ["## 1. 第一节", "", "## 2. 第二节"].join("\n") },
    { filePath: "docs/evergreen/c.md", content: "## 2. C 第二节" },
  ];

  const { resolved, broken, ambiguous } = prep.buildAnchorNeeds(docs);

  assert.deepEqual(broken, []);
  assert.equal(ambiguous.length, 1);
  assert.match(ambiguous[0].text, /§1 \/ §2/);
  assert.ok(resolved.some((r) => r.target === "docs/evergreen/b.md" && r.section === "1"));
  const cNeed = resolved.find((r) => r.target === "docs/evergreen/c.md" && r.section === "2");
  assert.equal(cNeed?.from.length, 2);
});

test("buildAnchorNeeds reports a nearby missing target section as broken", () => {
  const docs = [
    {
      filePath: "docs/evergreen/diary/editor.md",
      content: "序号判据见（[diary](../diary.md) §2.8）。",
    },
    {
      filePath: "docs/evergreen/diary.md",
      content: ["## 2. 关键契约", "", "### 2.7 未保存修改"].join("\n"),
    },
  ];

  const { broken } = prep.buildAnchorNeeds(docs);

  assert.equal(broken.length, 1);
  assert.equal(broken[0].target, "docs/evergreen/diary.md");
  assert.equal(broken[0].section, "2.8");
});

test("classifyBand labels size thresholds", () => {
  const caps = { softChars: 10, warnChars: 20, criticalChars: 30, hardChars: 40 };

  assert.equal(prep.classifyBand(9, caps), "ok");
  assert.equal(prep.classifyBand(10, caps), "soft");
  assert.equal(prep.classifyBand(20, caps), "warn");
  assert.equal(prep.classifyBand(30, caps), "critical");
});

test("buildDocProfiles reports size band and section ref counts", () => {
  const docs = [
    {
      filePath: "docs/evergreen/a.md",
      content: [
        "---",
        "type: evergreen",
        "title: A",
        "covers:",
        "  - packages/a/**",
        "contracts:",
        "  - packages/a/src/schema.ts",
        "last-reviewed: 2026-08-04",
        "---",
        "# A",
        "",
        '<a id="existing"></a>',
        "见 [B](b.md) §1 以及 §2。",
        "另见 §3。",
        "## 9. 标题里的 §4 不计数",
        "x".repeat(15100),
      ].join("\n"),
    },
  ];

  const [profile] = prep.buildDocProfiles(docs);

  assert.equal(profile.filePath, "docs/evergreen/a.md");
  assert.equal(profile.band, "soft");
  assert.deepEqual(profile.covers, ["packages/a/**"]);
  assert.deepEqual(profile.contracts, ["packages/a/src/schema.ts"]);
  assert.deepEqual(profile.anchors, ["existing"]);
  assert.equal(profile.crossRefs, 2);
  assert.equal(profile.bareRefs, 1);
});

test("buildAssignments groups within topics without crossing cap", () => {
  const profiles = [
    { filePath: "docs/evergreen/sync.md", chars: 60 },
    { filePath: "docs/evergreen/sync/domain-registry.md", chars: 30 },
    { filePath: "docs/evergreen/todo.md", chars: 80 },
    { filePath: "docs/evergreen/todo/sub.md", chars: 50 },
    { filePath: "docs/evergreen/large.md", chars: 120 },
  ];

  assert.deepEqual(prep.buildAssignments(profiles, 100), [
    { topic: "large", docs: ["docs/evergreen/large.md"], chars: 120 },
    { topic: "sync", docs: ["docs/evergreen/sync.md", "docs/evergreen/sync/domain-registry.md"], chars: 90 },
    { topic: "todo", docs: ["docs/evergreen/todo.md"], chars: 80 },
    { topic: "todo", docs: ["docs/evergreen/todo/sub.md"], chars: 50 },
  ]);
});
