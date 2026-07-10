import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTRYPOINT = path.join(REPO_ROOT, "packages/server/docker-entrypoint.sh");

function writeCommand(dir, name, body) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`);
  fs.chmodSync(file, 0o755);
}

function runEntrypoint(diaryVaultDir, resolvedPath, { mkdirFails = false } = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "timedata-entrypoint-"));
  const binDir = path.join(tempDir, "bin");
  const logFile = path.join(tempDir, "calls.log");
  fs.mkdirSync(binDir);

  writeCommand(binDir, "id", 'test "$1" = "-u" && echo 0');
  writeCommand(
    binDir,
    "mkdir",
    `printf "mkdir %s\\\\n" "$*" >> "$CALL_LOG"${mkdirFails ? '\ncase "$*" in *"/app/vault"*) exit 1 ;; esac' : ""}`,
  );
  writeCommand(binDir, "chown", 'printf "chown %s\\n" "$*" >> "$CALL_LOG"');
  writeCommand(binDir, "readlink", 'printf "%s\\n" "$RESOLVED_PATH"');
  writeCommand(binDir, "su-exec", 'printf "su-exec %s\\n" "$*" >> "$CALL_LOG"');

  try {
    const result = spawnSync("sh", ["-c", 'PATH=./bin:/usr/bin:/bin exec sh "$@"', "sh", ENTRYPOINT, "server"], {
      cwd: tempDir,
      encoding: "utf8",
      env: {
        ...process.env,
        CALL_LOG: logFile,
        DIARY_VAULT_DIR: diaryVaultDir,
        RESOLVED_PATH: resolvedPath,
      },
    });
    return {
      ...result,
      calls: fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8") : "",
    };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

test("entrypoint grants ownership only through the fixed /app/vault mount root", () => {
  const result = runEntrypoint("/app/vault/Time", "/app/vault/Time");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.calls, /chown -R timedata:timedata \/app\/data/);
  assert.match(result.calls, /mkdir -p \/app\/vault/);
  assert.doesNotMatch(result.calls, /mkdir .*\/app\/vault\/Time/);
  assert.match(result.calls, /chown -R timedata:timedata \/app\/vault/);
  assert.doesNotMatch(result.calls, /chown .*\/app\/vault\/Time/);
});

test("entrypoint rejects traversal before creating any diary path", () => {
  const result = runEntrypoint("/app/vault/../../app/data/probe", "/app/data/probe");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /refusing path traversal in DIARY_VAULT_DIR/);
  assert.doesNotMatch(result.calls, /mkdir .*\/app\/vault/);
  assert.doesNotMatch(result.calls, /chown -R timedata:timedata \/app\/vault/);
});

test("entrypoint refuses ownership changes when DIARY_VAULT_DIR resolves outside /app/vault", () => {
  const result = runEntrypoint("/", "/");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /refusing to create or change ownership outside \/app\/vault/);
  assert.doesNotMatch(result.calls, /mkdir \/$/m);
  assert.doesNotMatch(result.calls, /chown .* \/$/m);
});

test("entrypoint keeps starting when a read-only vault prevents directory creation", () => {
  const result = runEntrypoint("/app/vault/Time", "/app/vault/Time", { mkdirFails: true });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /unable to create diary vault mount root \/app\/vault/);
  assert.doesNotMatch(result.calls, /chown -R timedata:timedata \/app\/vault/);
  assert.match(result.calls, /su-exec timedata .* server/);
});
