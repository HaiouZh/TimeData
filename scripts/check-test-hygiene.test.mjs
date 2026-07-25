import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  CliUsageError,
  collectFindings,
  keysOf,
  mergeBaseline,
  parseArgs,
  pruneBaseline,
  run,
  selectKeys,
  toBucketPath,
} from "./check-test-hygiene.mjs";

test("parseArgs 拒收 --write-baseline，并给出三条替代路径", () => {
  assert.throws(
    () => parseArgs(["--write-baseline"]),
    (err) =>
      err instanceof CliUsageError && err.exitCode === 2 && err.message.includes("--add") && err.message.includes("--prune"),
  );
});

test("parseArgs 收 --add（可重复 / 逗号分隔 / = 形式），拒收未知参数与空目标", () => {
  assert.deepEqual(parseArgs(["--add", "a.test.ts", "--add=b.test.ts,c.test.ts"]), {
    mode: "add",
    targets: ["a.test.ts", "b.test.ts", "c.test.ts"],
  });
  assert.deepEqual(parseArgs([]), { mode: "check", targets: [] });
  assert.deepEqual(parseArgs(["--prune"]), { mode: "prune", targets: [] });
  assert.throws(() => parseArgs(["--wat"]), (err) => err instanceof CliUsageError);
  assert.throws(() => parseArgs(["--add"]), (err) => err instanceof CliUsageError);
  assert.throws(() => parseArgs(["--add", "a.test.ts", "--prune"]), (err) => err instanceof CliUsageError);
});

test("toBucketPath 归一报错行里的路径 / 反斜杠 / 绝对路径 / src 相对", () => {
  assert.equal(toBucketPath("packages/client/src/pages/Foo.test.tsx"), "pages/Foo.test.tsx");
  assert.equal(toBucketPath("packages\\client\\src\\pages\\Foo.test.tsx"), "pages/Foo.test.tsx");
  assert.equal(toBucketPath("D:/x/TimeData/packages/client/src/lib/a.test.ts"), "lib/a.test.ts");
  assert.equal(toBucketPath("./src/lib/a.test.ts"), "lib/a.test.ts");
  assert.equal(toBucketPath("lib/a.test.ts"), "lib/a.test.ts");
  assert.equal(toBucketPath("packages/client/src/lib/"), "lib");
});

test("selectKeys 只挑指定路径下的违规，不捎带同批的其他违规", () => {
  const keys = ["dirty-in-clean-bucket:lib/a.test.ts", "dirty-in-clean-bucket:lib/b.test.ts", "real-timer-wait:pages/C.test.tsx"];
  assert.deepEqual(selectKeys(keys, ["packages/client/src/lib/a.test.ts"]), ["dirty-in-clean-bucket:lib/a.test.ts"]);
  // 目录前缀：整目录登记是显式行为，但仍不越出该目录
  assert.deepEqual(selectKeys(keys, ["lib"]), [
    "dirty-in-clean-bucket:lib/a.test.ts",
    "dirty-in-clean-bucket:lib/b.test.ts",
  ]);
  // src 根 = 全树收编，正是被移除的行为，必须拒绝
  assert.throws(() => selectKeys(keys, ["packages/client/src"]), (err) => err instanceof CliUsageError);
});

test("mergeBaseline 只增不删（别人正在还的债不会被我这次登记抹掉）", () => {
  assert.deepEqual(mergeBaseline(["b", "a"], ["c", "a"]), ["a", "b", "c"]);
  assert.deepEqual(mergeBaseline(["a"], []), ["a"]);
});

test("pruneBaseline 只删已不再违规的条目，不新增", () => {
  const { next, removed } = pruneBaseline(["a", "b"], ["a", "c"]);
  assert.deepEqual(next, ["a"]);
  assert.deepEqual(removed, ["b"]);
});

/** 造一棵最小 src 树：root/src/<相对路径>，内容按 files 给。返回 { root, src, baselinePath }。 */
function makeFixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "timedata-hygiene-"));
  const src = path.join(root, "src");
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(src, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return { root, src, baselinePath: path.join(root, "baseline.json") };
}

const JSDOM_TEST = "// @vitest-environment jsdom\nexport {};\n";
const silent = { log: () => {}, error: () => {} };

test("collectFindings 认出脏标记与真实定时等待", () => {
  const { root, src } = makeFixture({
    "lib/a.test.ts": JSDOM_TEST,
    "lib/b.test.ts": "await new Promise((r) => setTimeout(r, 50));\n",
    "lib/notATest.ts": JSDOM_TEST,
  });
  const keys = keysOf(collectFindings({ src, root }));
  // b 只有真实定时等待、不含脏标记（jsdom/vi.mock/db 那类），故不算 dirty-in-clean-bucket；
  // notATest.ts 不是测试文件，一条都不出。
  assert.deepEqual(keys, ["dirty-in-clean-bucket:lib/a.test.ts", "real-timer-wait:lib/b.test.ts"]);
  fs.rmSync(root, { recursive: true, force: true });
});

test("工作树里两个新违规，--add 只登记指定的那个，另一个仍被拦下", () => {
  const { root, src, baselinePath } = makeFixture({ "lib/a.test.ts": JSDOM_TEST, "lib/b.test.ts": JSDOM_TEST });
  const opts = { src, root, baselinePath, ...silent };

  assert.equal(run([], opts), 1); // 两条都是新增违规

  assert.equal(run(["--add", "src/lib/a.test.ts"], opts), 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(baselinePath, "utf8")), ["dirty-in-clean-bucket:lib/a.test.ts"]);

  assert.equal(run([], opts), 1); // b 没被顺手收编，闸仍然拦它
  fs.rmSync(root, { recursive: true, force: true });
});

test("--add 不删已有基线条目（哪怕那条对应的文件已修好）", () => {
  const { root, src, baselinePath } = makeFixture({ "lib/a.test.ts": JSDOM_TEST });
  fs.writeFileSync(baselinePath, JSON.stringify(["dirty-in-clean-bucket:lib/gone.test.ts"]));

  assert.equal(run(["--add", "src/lib/a.test.ts"], { src, root, baselinePath, ...silent }), 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(baselinePath, "utf8")), [
    "dirty-in-clean-bucket:lib/a.test.ts",
    "dirty-in-clean-bucket:lib/gone.test.ts",
  ]);
  fs.rmSync(root, { recursive: true, force: true });
});

test("--add 路径写错（该路径下无违规）报错退出，且不动基线", () => {
  const { root, src, baselinePath } = makeFixture({ "lib/a.test.ts": JSDOM_TEST });
  fs.writeFileSync(baselinePath, JSON.stringify(["dirty-in-clean-bucket:lib/keep.test.ts"]));

  assert.equal(run(["--add", "src/lib/typo.test.ts"], { src, root, baselinePath, ...silent }), 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(baselinePath, "utf8")), ["dirty-in-clean-bucket:lib/keep.test.ts"]);
  fs.rmSync(root, { recursive: true, force: true });
});

test("--write-baseline 退出码 2 且一个字节都不写", () => {
  const { root, src, baselinePath } = makeFixture({ "lib/a.test.ts": JSDOM_TEST });

  assert.equal(run(["--write-baseline"], { src, root, baselinePath, ...silent }), 2);
  assert.equal(fs.existsSync(baselinePath), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test("--prune 只删失效条目，--rewrite-baseline 才整体重写", () => {
  const { root, src, baselinePath } = makeFixture({ "lib/a.test.ts": JSDOM_TEST, "lib/b.test.ts": JSDOM_TEST });
  const opts = { src, root, baselinePath, ...silent };
  fs.writeFileSync(baselinePath, JSON.stringify(["dirty-in-clean-bucket:lib/a.test.ts", "dirty-in-clean-bucket:lib/gone.test.ts"]));

  assert.equal(run(["--prune"], opts), 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(baselinePath, "utf8")), ["dirty-in-clean-bucket:lib/a.test.ts"]);
  assert.equal(run([], opts), 1); // prune 不会顺手把 b 收编

  assert.equal(run(["--rewrite-baseline"], opts), 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(baselinePath, "utf8")), [
    "dirty-in-clean-bucket:lib/a.test.ts",
    "dirty-in-clean-bucket:lib/b.test.ts",
  ]);
  fs.rmSync(root, { recursive: true, force: true });
});

test("--rewrite-baseline 把新收编的条目逐条喊出来，不静默放松棘轮", () => {
  const { root, src, baselinePath } = makeFixture({ "lib/a.test.ts": JSDOM_TEST });
  const lines = [];
  fs.writeFileSync(baselinePath, JSON.stringify([]));

  run(["--rewrite-baseline"], { src, root, baselinePath, log: (m) => lines.push(m), error: (m) => lines.push(m) });
  const output = lines.join("\n");
  assert.match(output, /新收编 1 条/);
  assert.match(output, /dirty-in-clean-bucket:lib\/a\.test\.ts/);
  fs.rmSync(root, { recursive: true, force: true });
});
