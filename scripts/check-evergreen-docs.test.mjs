import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as docsCheck from "./check-evergreen-docs.mjs";

import {
  CliUsageError,
  EVERGREEN_RULES_SUMMARY,
  SIZE_CAPS,
  buildSizeHints,
  classifySizeWarning,
  countSubDocs,
  diffSizeBaseline,
  evaluateDocSync,
  evaluateLinks,
  evaluateSizes,
  getAddedFiles,
  getChangedFiles,
  parseArgs,
  selectChangedEvergreenDocs,
  selectCrossCutExhausted,
  selectUncovered,
} from "./check-evergreen-docs.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("stripCode preserves line count while removing fenced and inline code", () => {
  assert.equal(typeof docsCheck.stripCode, "function");
  const content = ["before `inline`", "```js", "const a = 1;", "```", "after"].join("\n");

  const stripped = docsCheck.stripCode(content);

  assert.equal(stripped.split("\n").length, 5);
  assert.doesNotMatch(stripped, /const a/);
  assert.doesNotMatch(stripped, /inline/);
});

test("stripCode removes tilde, long, unclosed, and indented code blocks", () => {
  const content = [
    "~~~html",
    '<a id="tilde-example"></a>',
    "~~~~",
    "````markdown",
    '<a id="long-example"></a>',
    "````",
    "    <a id=\"indented-example\"></a>",
    "```md",
    '<a id="unclosed-example"></a>',
  ].join("\n");

  const stripped = docsCheck.stripCode(content);

  assert.equal(stripped.split("\n").length, content.split("\n").length);
  assert.deepEqual(docsCheck.parseAnchors(stripped), []);
});

test("stripCode removes inline code spans delimited by more than one backtick", () => {
  const content = 'before ``<a id="inline-example"></a>`` after';

  assert.deepEqual(docsCheck.parseAnchors(docsCheck.stripCode(content)), []);
});

test("parseMarkdownLinks records the source line for links on lines 3 and 5", () => {
  assert.equal(typeof docsCheck.parseMarkdownLinks, "function");
  const content = ["one", "two", "[A](a.md)", "four", "[B](b.md#target)"].join("\n");

  assert.deepEqual(docsCheck.parseMarkdownLinks(content), [
    { target: "a.md", anchor: null, line: 3 },
    { target: "b.md", anchor: "target", line: 5 },
  ]);
});

test("parseAnchors extracts paired anchors and ignores fenced examples", () => {
  assert.equal(typeof docsCheck.parseAnchors, "function");
  const content = [
    '<a id="first"></a>',
    "```html",
    '<a id="example"></a>',
    "```",
    '<a id="second"></a>',
  ].join("\n");

  assert.deepEqual(docsCheck.parseAnchors(docsCheck.stripCode(content)), ["first", "second"]);
});

test("parseArgs rejects unknown arguments with CLI usage exit code", () => {
  assert.throws(
    () => parseArgs(["--wat"]),
    (err) => err instanceof CliUsageError && err.exitCode === 2,
  );
});

test("parseArgs rejects invalid modes with CLI usage exit code", () => {
  assert.throws(
    () => parseArgs(["--mode=invalid"]),
    (err) => err instanceof CliUsageError && err.exitCode === 2,
  );
});

test("EVERGREEN_RULES_SUMMARY points back to the docs guide §0", () => {
  const text = EVERGREEN_RULES_SUMMARY.join("\n");
  assert.match(text, /docs\/evergreen\/_docs-guide\.md/);
  assert.match(text, /没有任何改动发生时也成立/);
});

test("selectChangedEvergreenDocs picks evergreen bodies and excludes ADR/code", () => {
  const changed = [
    "docs/evergreen/todo.md",
    "docs/evergreen/sync/domain-registry.md",
    "docs/adr/0022-list-markers.md",
    "packages/client/src/App.tsx",
    "docs/evergreen/img.png",
  ];
  assert.deepEqual(selectChangedEvergreenDocs(changed), [
    "docs/evergreen/todo.md",
    "docs/evergreen/sync/domain-registry.md",
  ]);
});

test("getChangedFiles invokes git diff without shell parsing", () => {
  const calls = [];
  const execFileSync = (file, args, options) => {
    calls.push({ file, args, options });
    return "packages/client/src/App.tsx\n";
  };

  assert.deepEqual(getChangedFiles("origin/main", { execFileSync }), ["packages/client/src/App.tsx"]);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    file: "git",
    args: ["diff", "origin/main", "--name-only"],
    options: { cwd: REPO_ROOT, encoding: "utf8" },
  });
});

test("getChangedFiles invokes git ls-files without shell parsing for HEAD", () => {
  const calls = [];
  const execFileSync = (file, args, options) => {
    calls.push({ file, args, options });
    if (args[0] === "diff") return "packages/client/src/App.tsx\n";
    return "scripts/new-doc-check.mjs\n";
  };

  assert.deepEqual(getChangedFiles("HEAD", { execFileSync }), [
    "packages/client/src/App.tsx",
    "scripts/new-doc-check.mjs",
  ]);
  assert.deepEqual(
    calls.map((call) => [call.file, call.args, call.options.encoding]),
    [
      ["git", ["diff", "HEAD", "--name-only"], "utf8"],
      ["git", ["ls-files", "--others", "--exclude-standard"], "utf8"],
    ],
  );
});

test("evaluateDocSync strict uses contracts, not covers", () => {
  const docs = [
    {
      filePath: "docs/evergreen/sync.md",
      title: "同步机制",
      covers: ["packages/server/src/sync/**"],
      contracts: ["packages/shared/src/syncDomains.ts"],
    },
  ];

  // 改域内普通文件：命中 covers、不命中 contracts → strict 放行。
  const helperChange = evaluateDocSync(docs, ["packages/server/src/sync/notifier.ts"], {
    field: "contracts",
  });
  assert.equal(helperChange.hits.length, 0);
  assert.equal(helperChange.unmatched, 0);

  // warn 仍看 covers → 提示该文档。
  const helperWarn = evaluateDocSync(docs, ["packages/server/src/sync/notifier.ts"], { field: "covers" });
  assert.equal(helperWarn.hits.length, 1);

  // 改契约文件、未同步文档 → strict 记为未更新。
  const contractChange = evaluateDocSync(docs, ["packages/shared/src/syncDomains.ts"], {
    field: "contracts",
  });
  assert.equal(contractChange.hits.length, 1);
  assert.equal(contractChange.unmatched, 1);

  // 改契约文件 + 同批改了文档 → strict 放行。
  const contractSynced = evaluateDocSync(
    docs,
    ["packages/shared/src/syncDomains.ts", "docs/evergreen/sync.md"],
    { field: "contracts" },
  );
  assert.equal(contractSynced.unmatched, 0);
});

test("evaluateDocSync treats a doc with no contracts as a strict no-op", () => {
  const docs = [{ filePath: "docs/evergreen/cli.md", title: "CLI", covers: ["packages/cli/**"], contracts: [] }];

  const res = evaluateDocSync(docs, ["packages/cli/src/index.ts"], { field: "contracts" });

  assert.equal(res.hits.length, 0);
  assert.equal(res.unmatched, 0);
});

test("evaluateSizes does NOT ratchet char growth under the hard cap", () => {
  // 正文可自由增长：远超旧「基线」字符数，只要不过 hard cap 就放行。
  const docs = [{ filePath: "docs/evergreen/a.md", covers: ["x"], chars: 24000 }];
  const baseline = { "docs/evergreen/a.md": { covers: 1 } };

  const res = evaluateSizes(docs, baseline, { softChars: 15000, hardChars: 25000 });

  assert.equal(res.ok, true);
});

test("evaluateSizes flags a doc that exceeds the hard cap (too-long)", () => {
  const docs = [{ filePath: "docs/evergreen/a.md", covers: ["x"], chars: 25001 }];
  const baseline = { "docs/evergreen/a.md": { covers: 1 } };

  const res = evaluateSizes(docs, baseline, { softChars: 15000, hardChars: 25000 });

  assert.equal(res.ok, false);
  assert.equal(res.violations[0].kind, "too-long");
  assert.equal(res.violations[0].limit, 25000);
});

test("evaluateSizes flags a doc whose covers grew past baseline", () => {
  const docs = [{ filePath: "docs/evergreen/a.md", covers: ["x", "y"], chars: 9000 }];
  const baseline = { "docs/evergreen/a.md": { covers: 1 } };

  const res = evaluateSizes(docs, baseline, { softChars: 15000, hardChars: 25000 });

  assert.equal(res.ok, false);
  assert.equal(res.violations[0].kind, "grew-covers");
});

test("evaluateSizes fails a doc missing from an empty baseline", () => {
  const docs = [{ filePath: "docs/evergreen/new.md", covers: ["x"], chars: 1000 }];

  const res = evaluateSizes(docs, {}, { softChars: 15000, hardChars: 25000 });

  assert.equal(res.ok, false);
  assert.deepEqual(res.violations[0], {
    filePath: "docs/evergreen/new.md",
    kind: "missing-baseline",
    current: 1000,
    limit: 0,
  });
});

test("evaluateSizes fails a doc missing from baseline even when over hard cap", () => {
  const docs = [{ filePath: "docs/evergreen/new.md", covers: ["x"], chars: 26000 }];

  const res = evaluateSizes(docs, {}, { softChars: 15000, hardChars: 25000 });

  assert.equal(res.ok, false);
  assert.equal(res.violations[0].kind, "missing-baseline");
});

test("evaluateSizes fails when an evergreen doc is missing from a non-empty baseline", () => {
  const docs = [
    { filePath: "docs/evergreen/a.md", covers: ["x"], chars: 9000 },
    { filePath: "docs/evergreen/new.md", covers: ["x"], chars: 1000 },
  ];
  const baseline = { "docs/evergreen/a.md": { covers: 1 } };

  const res = evaluateSizes(docs, baseline, { softChars: 15000, hardChars: 25000 });

  assert.equal(res.ok, false);
  assert.deepEqual(res.violations[0], {
    filePath: "docs/evergreen/new.md",
    kind: "missing-baseline",
    current: 1000,
    limit: 0,
  });
});

test("evaluateSizes fails when baseline contains a removed evergreen doc", () => {
  const docs = [{ filePath: "docs/evergreen/a.md", covers: ["x"], chars: 9000 }];
  const baseline = {
    "docs/evergreen/a.md": { covers: 1 },
    "docs/evergreen/removed.md": { covers: 0 },
  };

  const res = evaluateSizes(docs, baseline, { softChars: 15000, hardChars: 25000 });

  assert.equal(res.ok, false);
  assert.deepEqual(res.violations[0], {
    filePath: "docs/evergreen/removed.md",
    kind: "stale-baseline",
    current: 0,
    limit: 0,
  });
});

test("getAddedFiles invokes git diff --diff-filter=A plus untracked", () => {
  const calls = [];
  const execFileSync = (_file, args) => {
    calls.push(args);
    if (args[0] === "diff") return "packages/client/src/lib/new.ts\n";
    return "packages/server/src/routes/new.ts\n";
  };

  assert.deepEqual(getAddedFiles("origin/main", { execFileSync }), [
    "packages/client/src/lib/new.ts",
    "packages/server/src/routes/new.ts",
  ]);
  assert.deepEqual(calls, [
    ["diff", "--diff-filter=A", "--name-only", "origin/main"],
    ["ls-files", "--others", "--exclude-standard"],
  ]);
});

test("selectUncovered flags an added source file matching no covers", () => {
  const files = ["packages/client/src/lib/newThing.ts"];
  const docs = [{ covers: ["packages/client/src/lib/tasks.ts"] }];

  const res = selectUncovered(files, docs, {
    roots: ["packages/client/src/"],
    exempts: [/\.test\.[jt]sx?$/],
  });

  assert.deepEqual(res, ["packages/client/src/lib/newThing.ts"]);
});

test("selectUncovered ignores test files via exempt patterns", () => {
  const files = ["packages/client/src/lib/newThing.test.ts"];

  const res = selectUncovered(files, [], {
    roots: ["packages/client/src/"],
    exempts: [/\.test\.[jt]sx?$/],
  });

  assert.deepEqual(res, []);
});

test("selectUncovered ignores files already covered (exact and glob)", () => {
  const files = ["packages/client/src/lib/tasks.ts", "packages/client/src/pages/todo/New.tsx"];
  const docs = [
    { covers: ["packages/client/src/lib/tasks.ts"] },
    { covers: ["packages/client/src/pages/todo/**"] },
  ];

  const res = selectUncovered(files, docs, {
    roots: ["packages/client/src/"],
    exempts: [/\.test\.[jt]sx?$/],
  });

  assert.deepEqual(res, []);
});

test("selectUncovered ignores files outside code roots", () => {
  const files = ["packages/mobile/android/app/Foo.java", "scripts/x.mjs"];

  const res = selectUncovered(files, [], {
    roots: ["packages/client/src/"],
    exempts: [],
  });

  assert.deepEqual(res, []);
});

test("evaluateLinks flags a link to a missing doc", () => {
  const docs = [{ filePath: "docs/evergreen/a.md", links: [{ target: "missing.md", anchor: null }] }];

  const res = evaluateLinks(docs);

  assert.equal(res.ok, false);
  assert.equal(res.broken[0].from, "docs/evergreen/a.md");
  assert.equal(res.broken[0].target, "missing.md");
});

test("evaluateLinks passes when all links resolve", () => {
  const docs = [
    { filePath: "docs/evergreen/a.md", links: [{ target: "b.md", anchor: null }] },
    { filePath: "docs/evergreen/b.md", links: [] },
  ];

  assert.equal(evaluateLinks(docs).ok, true);
});

test("evaluateLinks passes when the target document contains the explicit anchor", () => {
  const docs = [
    { filePath: "docs/evergreen/a.md", links: [{ target: "b.md", anchor: "exists", line: 12 }] },
    { filePath: "docs/evergreen/b.md", links: [], anchors: ["exists"] },
  ];

  assert.deepEqual(evaluateLinks(docs), { broken: [], ok: true });
});

test("evaluateLinks reports a missing anchor with target fragment and source line", () => {
  const docs = [
    { filePath: "docs/evergreen/a.md", links: [{ target: "b.md", anchor: "gone", line: 42 }] },
    { filePath: "docs/evergreen/b.md", links: [], anchors: ["exists"] },
  ];

  assert.deepEqual(evaluateLinks(docs).broken, [
    {
      from: "docs/evergreen/a.md",
      line: 42,
      target: "b.md#gone",
      kind: "missing-anchor",
    },
  ]);
});

test("evaluateLinks does not validate anchors when the link has no fragment", () => {
  const docs = [
    { filePath: "docs/evergreen/a.md", links: [{ target: "b.md", anchor: null, line: 5 }] },
    { filePath: "docs/evergreen/b.md", links: [] },
  ];

  assert.equal(evaluateLinks(docs).ok, true);
});

test("evaluateLinks reports a missing target document only once", () => {
  const docs = [
    { filePath: "docs/evergreen/a.md", links: [{ target: "missing.md", anchor: "gone", line: 7 }] },
  ];

  assert.deepEqual(evaluateLinks(docs).broken, [
    {
      from: "docs/evergreen/a.md",
      line: 7,
      target: "missing.md",
      kind: "missing-doc",
    },
  ]);
});

test("evaluateLinks resolves ../ relative links across subdirs", () => {
  const docs = [
    { filePath: "docs/evergreen/sync/domain-registry.md", links: [{ target: "../sync.md", anchor: null }] },
    { filePath: "docs/evergreen/sync.md", links: [] },
  ];

  assert.equal(evaluateLinks(docs).ok, true);
});

test("evaluateLinks ignores links outside the docs tree", () => {
  const docs = [
    { filePath: "docs/evergreen/a.md", links: [{ target: "../../docs_local/x.md", anchor: null }] },
  ];

  assert.equal(evaluateLinks(docs).ok, true);
});

test("findMalformedAnchors reports only malformed standalone anchor lines", () => {
  assert.equal(typeof docsCheck.findMalformedAnchors, "function");
  const content = [
    '<a id="good"></a>',
    '<a id="unclosed">',
    '<a id="self-closing" />',
    "## 标题 <a id=\"inline\"></a>",
  ].join("\n");

  assert.deepEqual(docsCheck.findMalformedAnchors(docsCheck.stripCode(content)), [
    { line: 2, text: '<a id="unclosed">' },
    { line: 3, text: '<a id="self-closing" />' },
  ]);
});

test("findMalformedAnchors ignores attributes whose names or values merely contain id", () => {
  const content = ['<a data-id="demo"></a>', '<a aria-label="foo id=demo"></a>'].join("\n");

  assert.deepEqual(docsCheck.findMalformedAnchors(content), []);
});

test("findDuplicateAnchors reports the first and second documents sharing an id", () => {
  assert.equal(typeof docsCheck.findDuplicateAnchors, "function");
  const docs = [
    { filePath: "docs/evergreen/first.md", anchors: ["shared-id"] },
    { filePath: "docs/evergreen/second.md", anchors: ["shared-id"] },
  ];

  assert.deepEqual(docsCheck.findDuplicateAnchors(docs), [
    { id: "shared-id", first: "docs/evergreen/first.md", second: "docs/evergreen/second.md" },
  ]);
});

test("modeLinks reports link, malformed-anchor, and duplicate-anchor failures together", () => {
  assert.equal(typeof docsCheck.modeLinks, "function");
  const docs = [
    {
      filePath: "docs/evergreen/a.md",
      links: [{ target: "missing.md", anchor: null, line: 11 }],
      anchors: ["shared-id"],
      malformedAnchors: [{ line: 12, text: '<a id="bad" />' }],
    },
    { filePath: "docs/evergreen/b.md", links: [], anchors: ["shared-id"], malformedAnchors: [] },
  ];
  const output = [];
  const originalError = console.error;
  const originalLog = console.log;
  console.error = (...args) => output.push(args.join(" "));
  console.log = (...args) => output.push(args.join(" "));
  try {
    assert.equal(docsCheck.modeLinks(docs), 1);
  } finally {
    console.error = originalError;
    console.log = originalLog;
  }

  const text = output.join("\n");
  assert.match(text, /docs\/evergreen\/a\.md:11 → missing\.md/);
  assert.match(text, /docs\/evergreen\/a\.md:12/);
  assert.match(text, /shared-id/);
  assert.match(text, /docs\/evergreen\/b\.md/);
});

test("diffSizeBaseline 把被抬高的 covers 单列出来（重写基线时要喊出来的那部分）", () => {
  const previous = { "a.md": { covers: 3 }, "b.md": { covers: 5 }, "gone.md": { covers: 1 } };
  const next = { "a.md": { covers: 4 }, "b.md": { covers: 2 }, "new.md": { covers: 7 } };

  assert.deepEqual(diffSizeBaseline(previous, next), {
    added: ["new.md"],
    removed: ["gone.md"],
    raised: ["a.md：covers 3 → 4"],
    lowered: ["b.md：covers 5 → 2"],
  });
});

test("diffSizeBaseline 在无变化时四个清单都是空的", () => {
  const same = { "a.md": { covers: 3 } };
  assert.deepEqual(diffSizeBaseline(same, { "a.md": { covers: 3 } }), {
    added: [],
    removed: [],
    raised: [],
    lowered: [],
  });
});

test("countSubDocs counts sibling docs under the topic's own subdirectory", () => {
  const docs = [
    { filePath: "docs/evergreen/todo.md", covers: ["a"] },
    { filePath: "docs/evergreen/todo/at-hand.md", covers: ["b"] },
    { filePath: "docs/evergreen/todo/gravity.md", covers: ["c"] },
    { filePath: "docs/evergreen/sync.md", covers: ["d"] },
    { filePath: "docs/evergreen/sync/domain-registry.md", covers: ["e"] },
  ];
  assert.equal(countSubDocs("docs/evergreen/todo.md", docs), 2);
  assert.equal(countSubDocs("docs/evergreen/sync.md", docs), 1);
});

test("countSubDocs returns 0 for a doc that has no subdirectory", () => {
  const docs = [
    { filePath: "docs/evergreen/cli.md", covers: ["a"] },
    { filePath: "docs/evergreen/todo/at-hand.md", covers: ["b"] },
  ];
  assert.equal(countSubDocs("docs/evergreen/cli.md", docs), 0);
});

test("countSubDocs does not count a sub-doc as its own child", () => {
  const docs = [
    { filePath: "docs/evergreen/todo/at-hand.md", covers: ["a"] },
    { filePath: "docs/evergreen/todo/gravity.md", covers: ["b"] },
  ];
  assert.equal(countSubDocs("docs/evergreen/todo/at-hand.md", docs), 0);
});

// 上面那条「does not count a sub-doc as its own child」其实测不到 `d.filePath !== docPath` 这道守卫：
// docPath 以 .md 结尾时，dir 的末位是 `/`、自身末位是 `d`，本来就不可能自匹配。
// 只有路径不带 .md 后缀（replace 不生效、dir === docPath）时守卫才真正承压——
// 故自身这条也必须带 covers，否则它会先被「只数横切」那道过滤剔掉，守卫又落不到压力上。
test("countSubDocs never counts the doc itself, even when the path has no .md suffix", () => {
  const docs = [
    { filePath: "docs/evergreen/todo", covers: ["a"] },
    { filePath: "docs/evergreen/todo/at-hand.md", covers: ["b"] },
  ];
  assert.equal(countSubDocs("docs/evergreen/todo", docs), 1);
});

// `dir` 末尾那个 `/` 是唯一阻止同前缀兄弟被误数的机制，`startsWith` 则挡路径中段命中。
test("countSubDocs 只认目录前缀，不认撞名兄弟、不认路径中段命中", () => {
  const docs = [
    { filePath: "docs/evergreen/todo.md", covers: ["a"] },
    { filePath: "docs/evergreen/todo/at-hand.md", covers: ["b"] },
    { filePath: "docs/evergreen/todos.md", covers: ["c"] },
    { filePath: "docs/evergreen/todo-archive.md", covers: ["d"] },
    { filePath: "docs/adr/docs/evergreen/todo/nested.md", covers: ["e"] },
  ];
  assert.equal(countSubDocs("docs/evergreen/todo.md", docs), 1);
});

// 判别数据：横切子文档从母文档迁走 covers（≥1），纵切子文档 covers 按设计恒空。
// 若把纵切也算进来，一个只走过纵切的主题会被断言「横切已用尽」，把执行者从真正可走的轴上推开。
test("countSubDocs 只数横切子文档，纵切（零 covers）不占横切轴", () => {
  const docs = [
    { filePath: "docs/evergreen/todo.md", covers: ["a"] },
    { filePath: "docs/evergreen/todo/at-hand.md", covers: ["b"] },
    { filePath: "docs/evergreen/todo/invariants.md", covers: [] },
    { filePath: "docs/evergreen/todo/modules.md", covers: [] },
  ];
  assert.equal(countSubDocs("docs/evergreen/todo.md", docs), 1);
});

test("selectCrossCutExhausted 只点名横切子文档已有 2 份及以上的文档", () => {
  // 1 份不入列（挡 `>= 1`）。
  assert.deepEqual(
    selectCrossCutExhausted(
      [{ filePath: "a.md" }],
      [
        { filePath: "a.md", covers: ["x"] },
        { filePath: "a/x.md", covers: ["y"] },
      ],
    ),
    [],
  );
  // 2 份要入列（挡 `> 2`）。
  assert.deepEqual(
    selectCrossCutExhausted(
      [{ filePath: "a.md" }],
      [
        { filePath: "a.md", covers: ["x"] },
        { filePath: "a/x.md", covers: ["y"] },
        { filePath: "a/y.md", covers: ["z"] },
      ],
    ),
    [{ filePath: "a.md", subs: 2 }],
  );
});

test("selectCrossCutExhausted 不把纵切子文档算成横切已用尽", () => {
  assert.deepEqual(
    selectCrossCutExhausted(
      [{ filePath: "a.md" }],
      [
        { filePath: "a.md", covers: ["x"] },
        { filePath: "a/p.md", covers: [] },
        { filePath: "a/q.md", covers: [] },
      ],
    ),
    [],
  );
});

const CAPS = { softChars: 15000, warnChars: 20000, criticalChars: 23000, hardChars: 25000 };

test("classifySizeWarning returns null below soft cap and at the boundary", () => {
  assert.equal(classifySizeWarning(14999, CAPS), null);
  assert.equal(classifySizeWarning(15000, CAPS), null);
});

test("classifySizeWarning escalates across the three bands", () => {
  assert.equal(classifySizeWarning(15001, CAPS), "notice");
  assert.equal(classifySizeWarning(20000, CAPS), "notice");
  assert.equal(classifySizeWarning(20001, CAPS), "warning");
  assert.equal(classifySizeWarning(23000, CAPS), "warning");
  assert.equal(classifySizeWarning(23001, CAPS), "critical");
  assert.equal(classifySizeWarning(25000, CAPS), "critical");
});

test("classifySizeWarning returns null past hard cap (too-long violation handles it)", () => {
  assert.equal(classifySizeWarning(25001, CAPS), null);
});

// caps 缺 warnChars/criticalChars（本文件里就有大量两键 caps 的既有写法）时，裸读会让
// `chars > undefined` 恒假，把 🔴 静默降成 🟡；caps 整个缺失则直接 TypeError。
test("classifySizeWarning 的 caps 胜出于默认值，缺的键才回落到 SIZE_CAPS", () => {
  // 刻度全部远离 SIZE_CAPS：合并方向若反过来（默认值盖住调用方），这三条都会转红。
  const TINY = { softChars: 100, warnChars: 200, criticalChars: 300, hardChars: 400 };
  assert.equal(classifySizeWarning(150, TINY), "notice");
  assert.equal(classifySizeWarning(250, TINY), "warning");
  assert.equal(classifySizeWarning(350, TINY), "critical");
  assert.equal(classifySizeWarning(450, TINY), null);
  // 部分键：给的键要胜出，没给的键才回落——150 过自定义 softChars 100，但够不着默认 warnChars 20000。
  assert.equal(classifySizeWarning(150, { softChars: 100, hardChars: 400 }), "notice");
  assert.equal(classifySizeWarning(24000, undefined), "critical");
  assert.equal(classifySizeWarning(100, undefined), null);
});

test("SIZE_CAPS 四档阈值逐值锁死，且严格递增（不许把某一档挤成不可达的死档）", () => {
  assert.deepEqual(SIZE_CAPS, {
    softChars: 15000,
    warnChars: 20000,
    criticalChars: 23000,
    hardChars: 25000,
  });
  assert.ok(
    SIZE_CAPS.softChars < SIZE_CAPS.warnChars &&
      SIZE_CAPS.warnChars < SIZE_CAPS.criticalChars &&
      SIZE_CAPS.criticalChars < SIZE_CAPS.hardChars,
  );
});

test("buildSizeHints 不给未过 soft cap 的文档出提示", () => {
  assert.deepEqual(buildSizeHints([{ filePath: "s.md", chars: 100 }], CAPS), []);
});

test("buildSizeHints 按档位给图标、按 hard cap 算余量", () => {
  const [hint] = buildSizeHints([{ filePath: "s.md", chars: 24000 }], CAPS);
  assert.equal(hint.band, "critical");
  assert.equal(hint.mark, "🔴");
  assert.equal(hint.remaining, 1000);
  assert.equal(buildSizeHints([{ filePath: "s.md", chars: 21000 }], CAPS)[0].mark, "🟠");
  assert.equal(buildSizeHints([{ filePath: "s.md", chars: 16000 }], CAPS)[0].mark, "🟡");
});

test("buildSizeHints 按字符数倒序——最逼近上限的排最前", () => {
  assert.deepEqual(
    buildSizeHints(
      [
        { filePath: "a.md", chars: 16000 },
        { filePath: "b.md", chars: 24000 },
      ],
      CAPS,
    ).map((x) => x.filePath),
    ["b.md", "a.md"],
  );
});

test("buildSizeHints 给每档配上对应提示语，且超 hard cap 的不进软提示", () => {
  // 三档各喂一份：只验 notice 一档时，把 hint 恒定成 notice 那句的变异不会红。
  const [notice] = buildSizeHints([{ filePath: "s.md", chars: 16000 }], CAPS);
  const [warning] = buildSizeHints([{ filePath: "s.md", chars: 21000 }], CAPS);
  const [critical] = buildSizeHints([{ filePath: "s.md", chars: 24000 }], CAPS);
  assert.match(notice.hint, /soft cap/);
  assert.match(warning.hint, /不足 5k/);
  assert.match(critical.hint, /不足 2k/);
  assert.deepEqual(buildSizeHints([{ filePath: "s.md", chars: 25001 }], CAPS), []);
});
