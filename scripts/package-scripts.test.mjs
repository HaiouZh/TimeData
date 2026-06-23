import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readRootScripts() {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
  return pkg.scripts;
}

test("root build keeps shared first and builds app packages in parallel", () => {
  const scripts = readRootScripts();

  assert.equal(
    scripts.build,
    "pnpm build:shared && pnpm -r --workspace-concurrency=3 --filter @timedata/client --filter @timedata/server --filter @timedata/cli build",
  );
});

test("root test allows workspace package tests to overlap", () => {
  const scripts = readRootScripts();

  assert.equal(scripts.test, "pnpm -r --workspace-concurrency=2 test && pnpm test:scripts");
});

test("local fast paths are explicit and do not replace release gates", () => {
  const scripts = readRootScripts();

  assert.equal(scripts["build:client:fast"], "pnpm build:shared && pnpm --filter @timedata/client exec vite build");
  assert.equal(scripts["test:client:changed"], "pnpm --filter @timedata/client exec vitest run --project unit --changed");
});
