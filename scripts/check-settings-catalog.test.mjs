import assert from "node:assert/strict";
import test from "node:test";
import { loadAllowlist, reconcile, scanCodeText, scanDocText } from "./check-settings-catalog.mjs";

const emptyAllowlist = () => loadAllowlist({ entries: [] });

test("flags a key defined in code but missing from the catalog", () => {
  const code = scanCodeText('export const FOO_KEY = "foo.bar.v1";\n', "packages/client/src/lib/foo.ts");
  assert.deepEqual(code, [{ key: "foo.bar.v1", file: "packages/client/src/lib/foo.ts", line: 1 }]);

  const { errors } = reconcile(code, [], emptyAllowlist());
  assert.equal(errors.length, 1);
  assert.match(errors[0], /设置键 foo\.bar\.v1/);
  assert.match(errors[0], /packages\/client\/src\/lib\/foo\.ts:1/);
  assert.match(errors[0], /未登记进 settings-catalog\.md/);
});

test("flags a key registered in the catalog but missing from code", () => {
  const doc = scanDocText("| `retired.foo.v1` | 已退役 |\n");
  assert.deepEqual(doc, ["retired.foo.v1"]);

  const { errors } = reconcile([], doc, emptyAllowlist());
  assert.equal(errors.length, 1);
  assert.match(errors[0], /settings-catalog\.md 登记了 retired\.foo\.v1/);
  assert.match(errors[0], /代码里找不到/);
});

test("allowlist exempts a mismatch in either direction", () => {
  const allowlist = loadAllowlist({
    entries: [
      {
        file: "packages/client/src/lib/foo.ts",
        rule: "key-not-in-doc",
        lineText: "foo.bar.v1",
        reason: "测试豁免",
        ownerBatch: "td-ratchet",
        removeBy: "待复核",
      },
      {
        file: "docs/evergreen/categories-settings/settings-catalog.md",
        rule: "key-not-in-code",
        lineText: "retired.foo.v1",
        reason: "测试豁免",
        ownerBatch: "td-ratchet",
        removeBy: "待复核",
      },
    ],
  });
  const code = scanCodeText('export const FOO_KEY = "foo.bar.v1";\n', "packages/client/src/lib/foo.ts");
  const doc = scanDocText("| `retired.foo.v1` | 已退役 |\n");

  const { errors, stale } = reconcile(code, doc, allowlist);
  assert.deepEqual(errors, []);
  assert.deepEqual(stale, []);
});

test("reconciles clean when both sides agree", () => {
  const code = scanCodeText('export const A_KEY = "nav.a.v1";\n', "a.ts");
  const doc = scanDocText("| `nav.a.v1` | x |");
  const { errors } = reconcile(code, doc, emptyAllowlist());
  assert.deepEqual(errors, []);
});

test("ignores string literals that are not setting key constants", () => {
  // 无 .v<数字> 结尾的键形态（sleep.categoryId 是文档既有但无版本号，不在对账范围）
  const code = scanCodeText('export const SLEEP_KEY = "sleep.categoryId";\n', "a.ts");
  assert.deepEqual(code, []);
  // getSetting("...") 不是 `= "..."` 形态
  assert.deepEqual(scanCodeText('await getSetting("nav.a.v1");\n', "a.ts"), []);
  // 文档里的非键行内代码（如 `lib/foo.ts` 路径）不抓
  assert.deepEqual(scanDocText("包装文件：`lib/foo.ts`\n"), []);
});

test("reports stale allowlist entries that no longer match a mismatch", () => {
  const allowlist = loadAllowlist({
    entries: [
      {
        file: "x.ts",
        rule: "key-not-in-doc",
        lineText: "ghost.key.v1",
        reason: "旧债",
        ownerBatch: "td-ratchet",
        removeBy: "待复核",
      },
    ],
  });
  const { errors, stale } = reconcile([], [], allowlist);
  assert.deepEqual(errors, []);
  assert.deepEqual(stale.map((entry) => entry.lineText), ["ghost.key.v1"]);
});

test("validates allowlist schema like design-language allowlist", () => {
  assert.throws(
    () =>
      loadAllowlist({
        entries: [
          {
            file: "x.ts",
            rule: "key-not-in-doc",
            lineText: "foo.bar.v1",
            reason: "旧债",
            ownerBatch: "td-ratchet",
          },
        ],
      }),
    /removeBy/,
  );
  assert.throws(
    () =>
      loadAllowlist({
        entries: [
          {
            file: "x.ts",
            rule: "no-such-rule",
            lineText: "foo.bar.v1",
            reason: "旧债",
            ownerBatch: "td-ratchet",
            removeBy: "待复核",
          },
        ],
      }),
    /unknown rule/,
  );
});
