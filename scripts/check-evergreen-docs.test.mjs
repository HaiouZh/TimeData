import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CliUsageError,
  evaluateDocSync,
  evaluateLinks,
  evaluateSizes,
  getAddedFiles,
  getChangedFiles,
  parseArgs,
  selectUncovered,
} from "./check-evergreen-docs.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

test("evaluateLinks resolves ../ relative links across subdirs", () => {
  const docs = [
    { filePath: "docs/evergreen/health/charts.md", links: [{ target: "../health.md", anchor: null }] },
    { filePath: "docs/evergreen/health.md", links: [] },
  ];

  assert.equal(evaluateLinks(docs).ok, true);
});

test("evaluateLinks ignores links outside the docs tree", () => {
  const docs = [
    { filePath: "docs/evergreen/a.md", links: [{ target: "../../docs_local/x.md", anchor: null }] },
  ];

  assert.equal(evaluateLinks(docs).ok, true);
});
