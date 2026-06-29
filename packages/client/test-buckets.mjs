// 测试分桶的唯一事实源。被 vitest.config.ts（决定 include/exclude）与
// scripts/check-test-hygiene.mjs（dirty-file-in-clean-bucket 棘轮）共同 import，保证两边判定一致。
//
// 干净桶（unit-clean）：lib + quick-notes 下的纯逻辑测试——跑在 node、不碰 db / 不碰 DOM，
// 故可翻 isolate:false 免去每文件隔离（import + jsdom 环境）的巨额开销。
// 任一脏标记命中即视为脏文件，留在 unit(isolate:true) 桶。脏标记的依据见
// docs_local/plans/2026-06-28-client-isolate-stage1-discovery-plan.md 的 Stage 1 产出（向量①db / ②③DOM）。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// Stage 3a：从 lib/quick-notes 扩到全 src——纯逻辑/renderToStaticMarkup 测试无论在哪个目录都能进 node 快桶。
export const CLEAN_BUCKET_DIRS = ["src"];

// 命中任一即为脏：db（fake-indexeddb 全局 + db 单例三态竞态、db.delete 重建 schema）、
// DOM（jsdom 环境 / React root / domHarness）、全局态注入（stubGlobal / defineProperty(window）。
// 这些在 no-isolate 下跨文件串味，必须留在 isolate:true 的 unit 桶（或洗白后进各自的 isolate:false 桶）。
// 注：`fake-indexeddb` 只命中"测试文件直接 import fake-indexeddb/auto"者；db 测试洗白后改 import
// ./test/dbReset 助手（字样只在助手里、助手非 .test 文件不被扫），故自然落入 node 派生桶。
export const DIRTY_MARKERS = [
  /@vitest-environment\s+jsdom/,
  /fake-indexeddb/,
  /react-dom\/client/,
  /\bcreateRoot\b/,
  /domHarness/,
  /stubGlobal/,
  /defineProperty\(\s*window/,
  /\bdb\.delete\(/,
];

const isTestFile = (name) => /\.test\.[jt]sx?$/.test(name);

function walkTests(dir, acc) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return acc; // 目录不存在（如 worktree 裁剪）时安静跳过
  }
  for (const name of entries) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walkTests(full, acc);
    else if (isTestFile(name)) acc.push(full);
  }
  return acc;
}

export function isDirtyTest(absPath) {
  const txt = readFileSync(absPath, "utf8");
  return DIRTY_MARKERS.some((re) => re.test(txt));
}

// 列出干净桶目录下的全部测试文件（绝对路径）。clientRoot = packages/client 的绝对路径。
function listBucketTests(clientRoot) {
  const acc = [];
  for (const d of CLEAN_BUCKET_DIRS) walkTests(join(clientRoot, d), acc);
  return acc;
}

const toPosixRel = (clientRoot, abs) => relative(clientRoot, abs).replaceAll("\\", "/");

// 干净桶成员（相对 clientRoot 的 posix 路径，已排序）：lib/quick-notes 测试减去脏文件。
export function resolveCleanBucket(clientRoot) {
  return listBucketTests(clientRoot)
    .filter((f) => !isDirtyTest(f))
    .map((f) => toPosixRel(clientRoot, f))
    .sort();
}

// 干净桶目录里仍命中脏标记的文件（相对 posix 路径，已排序）：供 check:test 棘轮列为待 Stage 3 还债项。
export function listCleanBucketDirtyFiles(clientRoot) {
  return listBucketTests(clientRoot)
    .filter((f) => isDirtyTest(f))
    .map((f) => toPosixRel(clientRoot, f))
    .sort();
}
