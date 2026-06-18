import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CliUsageError,
  evaluateSizes,
  getChangedFiles,
  parseArgs,
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

test("evaluateSizes flags a doc that grew beyond baseline chars", () => {
  const docs = [{ filePath: "docs/evergreen/a.md", covers: ["x"], chars: 16000 }];
  const baseline = { "docs/evergreen/a.md": { chars: 15000, covers: 1 } };

  const res = evaluateSizes(docs, baseline, { softChars: 15000, hardChars: 25000 });

  assert.equal(res.ok, false);
  assert.equal(res.violations[0].kind, "grew-chars");
});

test("evaluateSizes allows a doc that shrank below baseline", () => {
  const docs = [{ filePath: "docs/evergreen/a.md", covers: ["x"], chars: 9000 }];
  const baseline = { "docs/evergreen/a.md": { chars: 15000, covers: 1 } };

  const res = evaluateSizes(docs, baseline, { softChars: 15000, hardChars: 25000 });

  assert.equal(res.ok, true);
});

test("evaluateSizes fails a NEW doc over hard cap", () => {
  const docs = [{ filePath: "docs/evergreen/new.md", covers: ["x"], chars: 26000 }];

  const res = evaluateSizes(docs, {}, { softChars: 15000, hardChars: 25000 });

  assert.equal(res.ok, false);
  assert.equal(res.violations[0].kind, "new-over-hard");
});
