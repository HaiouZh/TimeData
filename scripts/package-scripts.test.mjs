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
  const mobileWorkflow = fs.readFileSync(path.join(REPO_ROOT, ".github/workflows/mobile-release.yml"), "utf8");
  const serverDockerfile = fs.readFileSync(path.join(REPO_ROOT, "packages/server/Dockerfile"), "utf8");

  assert.match(pkg.packageManager, /^pnpm@\d+\.\d+\.\d+$/);
  assert.equal(pnpmSetupStep(ciWorkflow).includes("version:"), false);
  assert.equal(pnpmSetupStep(mobileWorkflow).includes("version:"), false);
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

function readMobileWorkflow() {
  return fs.readFileSync(path.join(REPO_ROOT, ".github/workflows/mobile-release.yml"), "utf8");
}

function isCommand(line) {
  const t = line.trim();
  return t !== "" && !t.startsWith("#") && !t.startsWith("//");
}

// prepare 创建 Release 时必须显式 --latest=false：gh 的 --latest 默认是 automatic，
// 对 v<8位> 这类非 semver tag 按创建时间自动成为 latest——不显式关掉，prepare 一创建
// 就把 latest 从上一个带 APK 的 Release 抢走，Android 构建失败时更会永久停在
// 没有 APK 的 Release 上，正好重现「iOS 顶掉 latest」事故。
// 只统计可执行命令行：workflow 注释里也会出现 gh release create / --latest 字样。
test("prepare 创建 Release 显式 --latest=false", () => {
  const workflow = readMobileWorkflow();
  const createLines = workflow.split("\n").filter((line) => isCommand(line) && line.includes("gh release create"));

  assert.equal(createLines.length, 1, `gh release create 出现 ${createLines.length} 次，应恰好 1 次`);
  assert.match(createLines[0], /--latest=false/);
});

// latest 一旦落到只有 .ipa 的 Release 上，安卓的应用内更新就会指向一个装不了的包
// （更早那批走 /releases/latest 的客户端首当其冲）。因此裸 --latest（不带 =false）
// 只允许出现在可执行命令行里一次，且必须与 APK 上传在同一条命令里；iOS 侧与补包
// 路径不许碰。workflow 注释里的 --latest 字样不算数（按 isCommand 过滤）。
test("裸 --latest 只由 APK 发布步骤打，iOS 侧不许碰", () => {
  const workflow = readMobileWorkflow();
  const bareLatestLines = workflow
    .split("\n")
    .filter((line) => isCommand(line) && line.includes("--latest") && !line.includes("--latest=false"));

  assert.equal(bareLatestLines.length, 1, `裸 --latest 出现 ${bareLatestLines.length} 次，应恰好 1 次`);
  assert.match(bareLatestLines[0], /gh release upload .*&& gh release edit .*--latest/);
});

// 少一条 path 就是「改了这里不发版」，而且要过很久才会被发现。
test("mobile-release 触发路径覆盖全部构建输入", () => {
  const workflow = readMobileWorkflow();

  for (const p of [
    "packages/client/**",
    "packages/mobile/**",
    "packages/shared/**",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "tsconfig.base.json",
    "scripts/mobile-version.mjs",
    "scripts/ios-app-icon.mjs",
    "scripts/generate-icons.mjs",
    "icon.png",
    ".github/workflows/mobile-release.yml",
  ]) {
    assert.ok(workflow.includes(`- "${p}"`), `触发路径缺少 ${p}`);
  }
});
