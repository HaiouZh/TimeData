import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { collectFindings, run, violatesRule } from "./check-legacy-prerequisites.mjs";

test("violatesRule：字面量空数组放行（含尾随逗号与空白）", () => {
  assert.equal(violatesRule("    prerequisites: [],"), false);
  assert.equal(violatesRule("  prerequisites: []"), false);
  assert.equal(violatesRule("prerequisites: []  "), false);
});

test("violatesRule：以 ; 结尾的类型/接口字段声明放行", () => {
  assert.equal(violatesRule("  prerequisites: GoalPrerequisite[];"), false);
  assert.equal(violatesRule("prerequisites: Array<GoalPrerequisite>;"), false);
});

test("violatesRule：往旧字段写表达式判违规", () => {
  assert.equal(violatesRule("    prerequisites: goal.prerequisites ?? [],"), true);
  assert.equal(violatesRule("  prerequisites: someVar"), true);
  assert.equal(violatesRule("    prerequisites: JSON.parse(payload)"), true);
  assert.equal(violatesRule("    prerequisites: ["), true);
});

test("violatesRule：非对象键形态（读取/注释）不受影响", () => {
  assert.equal(violatesRule("  for (const edge of goal.prerequisites ?? [])"), false);
  assert.equal(violatesRule('  path: ["prerequisites"],'), false);
  assert.equal(violatesRule("  // prerequisites: x"), false);
});

/** 造一棵最小扫描树：root/src/<相对路径>，内容按 files 给。 */
function makeFixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "timedata-prereq-"));
  const dir = path.join(root, "src");
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return { root, dir };
}

const silent = { log: () => {}, error: () => {} };

test("collectFindings：跳过测试文件与豁免清单，测试文件即使违规也不报", () => {
  const { root, dir } = makeFixture({
    "lib/goals.ts": "const g = { prerequisites: someVar };\n",
    "lib/goals.test.ts": "const g = { prerequisites: someVar };\n",
    "lib/goalPrerequisiteHydration.ts": "return { ...goal, prerequisites: relationsToPrerequisites(own) };\n",
    "lib/notTs.js": "const g = { prerequisites: someVar };\n",
  });
  const findings = collectFindings({
    dirs: [dir],
    root,
    allowlist: ["src/lib/goalPrerequisiteHydration.ts"],
  });
  assert.deepEqual(findings.map((f) => f.file), ["src/lib/goals.ts"]);
  fs.rmSync(root, { recursive: true, force: true });
});

test("run：干净树退 0", () => {
  const { root, dir } = makeFixture({ "lib/a.ts": "const g = { prerequisites: [] };\n" });
  assert.equal(run({ dirs: [dir], root, ...silent }), 0);
  fs.rmSync(root, { recursive: true, force: true });
});

test("run：违规树退 1 并打印 文件:行号", () => {
  const { root, dir } = makeFixture({ "lib/b.ts": "const g = { prerequisites: x ?? [] };\n" });
  const out = [];
  assert.equal(
    run({ dirs: [dir], root, log: (m) => out.push(m), error: (m) => out.push(m) }),
    1,
  );
  assert.match(out.join("\n"), /lib\/b\.ts:1/);
  fs.rmSync(root, { recursive: true, force: true });
});
