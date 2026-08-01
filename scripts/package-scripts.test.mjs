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

function readRootPackage() {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
}

function pnpmSetupStep(workflow) {
  const start = workflow.indexOf("uses: pnpm/action-setup@v6");
  assert.notEqual(start, -1);
  const nextStep = workflow.indexOf("\n      - name:", start + 1);
  return nextStep === -1 ? workflow.slice(start) : workflow.slice(start, nextStep);
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

test("tooling resolves pnpm version from the root packageManager", () => {
  const pkg = readRootPackage();
  const ciWorkflow = fs.readFileSync(path.join(REPO_ROOT, ".github/workflows/ci.yml"), "utf8");
  const androidWorkflow = fs.readFileSync(path.join(REPO_ROOT, ".github/workflows/android-apk.yml"), "utf8");
  const serverDockerfile = fs.readFileSync(path.join(REPO_ROOT, "packages/server/Dockerfile"), "utf8");

  assert.match(pkg.packageManager, /^pnpm@\d+\.\d+\.\d+$/);
  assert.equal(pnpmSetupStep(ciWorkflow).includes("version:"), false);
  assert.equal(pnpmSetupStep(androidWorkflow).includes("version:"), false);
  assert.match(serverDockerfile, /packageManager\.split\('@'\)\[1\]/);
  assert.doesNotMatch(serverDockerfile, /npm install -g pnpm@\d/);
});

test("compose preserves an explicitly empty DIARY_VAULT_DIR to disable diary", () => {
  const compose = fs.readFileSync(path.join(REPO_ROOT, "docker-compose.yml"), "utf8");

  assert.match(compose, /DIARY_VAULT_DIR=\$\{DIARY_VAULT_DIR-\/app\/vault\}/);
  assert.doesNotMatch(compose, /DIARY_VAULT_DIR=\$\{DIARY_VAULT_DIR:-\/app\/vault\}/);
});

import { GATE_STEPS } from "./gate.mjs";

// CI 里跑了但 gate 不跑的命令，每条都要有理由——加豁免等于放松棘轮，必须显式。
const CI_ONLY = new Map([
  ["pnpm install --frozen-lockfile", "装依赖，不是门禁"],
  ["pnpm audit --audit-level=high --prod", "要联网查漏洞库，本地离线时会假红；CI 有即可"],
  ["pnpm check:docs --since=<expr>", "dependabot/renovate PR 专用的 warn 降级版；gate 跑的是更严的 strict，已覆盖"],
]);

function ciPnpmCommands(workflow) {
  return workflow
    .split("\n")
    .map((line) => line.match(/^\s*run:\s*(pnpm .+)$/)?.[1]?.trim())
    .filter(Boolean)
    .map((cmd) => cmd.replace(/\$\{\{[^}]+\}\}/g, "<expr>"));
}

test("gate 清单覆盖 CI 跑的每条 pnpm 步骤（CI 加新棘轮，gate 不许静默漏掉）", () => {
  const ciWorkflow = fs.readFileSync(path.join(REPO_ROOT, ".github/workflows/ci.yml"), "utf8");
  const gateNames = new Set(GATE_STEPS.map((s) => s.name));

  const missing = ciPnpmCommands(ciWorkflow).filter((cmd) => {
    if (CI_ONLY.has(cmd)) return false;
    // client-unit 那 4 个分片 job 是 CI 侧的加速切分，本地 `pnpm test` 已整桶跑完同一批用例
    if (cmd.includes("--shard=")) return false;
    return ![...gateNames].some((name) => cmd.includes(name));
  });

  assert.deepEqual(missing, [], `这些 CI 步骤在 pnpm gate 里没有对应：\n${missing.join("\n")}`);
});

test("root gate script 指向 scripts/gate.mjs", () => {
  assert.equal(readRootScripts().gate, "node scripts/gate.mjs");
});
