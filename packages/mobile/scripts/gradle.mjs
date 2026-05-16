#!/usr/bin/env node
/**
 * Cross-platform wrapper around the Gradle wrapper inside `packages/mobile/android`.
 *
 * Usage:
 *   node scripts/gradle.mjs assembleDebug
 *   node scripts/gradle.mjs assembleRelease
 *
 * Previously this lived as an inline `node -e "..."` blob in package.json. The
 * blob made hooks impossible to log against and was the same code twice (once
 * for debug, once for release); pulling it into a script keeps the call site
 * a single line per scenario and lets us add diagnostics in one place.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

function resolveWrapper(androidDir) {
  const isWin = process.platform === "win32";
  const wrapperName = isWin ? "gradlew.bat" : "gradlew";
  return { isWin, wrapper: path.join(androidDir, wrapperName) };
}

function runGradle(task) {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const androidDir = path.resolve(scriptDir, "..", "android");
  const { isWin, wrapper } = resolveWrapper(androidDir);

  const cmd = isWin ? "cmd" : wrapper;
  const args = isWin ? ["/c", wrapper, task] : [task];

  const result = spawnSync(cmd, args, { cwd: androidDir, stdio: "inherit" });
  if (result.error) {
    console.error(`[mobile/gradle] failed to spawn ${cmd}:`, result.error.message);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

const [, , task] = process.argv;
if (!task) {
  console.error("[mobile/gradle] missing gradle task argument (e.g. assembleDebug)");
  process.exit(2);
}

runGradle(task);
