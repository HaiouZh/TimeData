import { readFileSync } from "node:fs";

// 热键动作名的跨语言契约。Rust 侧三处（HotkeyAction 枚举、action_id、handle_hotkey 的 match）
// 被编译器绑在一起，漏改一处编译不过；**跨过 IPC 之后的几处全是独立字面量**：
// 前端的联合类型、设置页的 ACTION_OPTIONS。
// 漏改 ACTION_OPTIONS 的表现是：新动作在设置页根本选不到，用户配不上，零条测试会红。
const actionIdSource = readFileSync(new URL("../src-tauri/src/config.rs", import.meta.url), "utf8");
const ACTION_ID_FN = /pub fn action_id\(action: &HotkeyAction\) -> &'static str \{([\s\S]*?)\n\}/;
const body = ACTION_ID_FN.exec(actionIdSource);
if (!body) {
  throw new Error(
    "[hotkey-actions] packages/desktop/src-tauri/src/config.rs 里找不到 action_id 函数体。" +
      "动作名的权威清单就是它，函数改名/改形状要同步改本闸。",
  );
}
const rustActions = [...body[1].matchAll(/=>\s*"([^"]+)"/g)].map((m) => m[1]).sort();
if (rustActions.length === 0) {
  throw new Error("[hotkey-actions] action_id 里一个动作都没解析到，闸失去比对对象。");
}

function assertSameSet(label, actual, hint) {
  const got = [...new Set(actual)].sort();
  if (JSON.stringify(got) !== JSON.stringify(rustActions)) {
    throw new Error(
      `[hotkey-actions] ${label} 的动作集合是 ${JSON.stringify(got)}，而 Rust action_id 是 ${JSON.stringify(rustActions)}。${hint}`,
    );
  }
}

const api = readFileSync(new URL("../../client/src/lib/desktop/api.ts", import.meta.url), "utf8");
const UNION = /action:\s*((?:"[^"]+"\s*\|\s*)*"[^"]+")\s*;/;
const union = UNION.exec(api);
if (!union) {
  throw new Error('[hotkey-actions] api.ts 里找不到 `action: "…" | "…";` 联合类型。');
}
assertSameSet(
  "packages/client/src/lib/desktop/api.ts 的 action 联合类型",
  [...union[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]),
  "联合类型少一个动作，配置文件里存在的绑定在前端会是类型外的值；多一个则是设置页能选、Rust 不认。",
);

const settings = readFileSync(
  new URL("../../client/src/pages/settings/SettingsDesktopPage.tsx", import.meta.url),
  "utf8",
);
const OPTIONS = /const ACTION_OPTIONS[^=]*=\s*\[([\s\S]*?)\];/;
const options = OPTIONS.exec(settings);
if (!options) {
  throw new Error("[hotkey-actions] SettingsDesktopPage.tsx 里找不到 ACTION_OPTIONS 数组。");
}
assertSameSet(
  "设置页的 ACTION_OPTIONS",
  [...options[1].matchAll(/value:\s*"([^"]+)"/g)].map((m) => m[1]),
  "漏一个动作，用户在「桌面设置」里根本选不到它——热键配不上，且没有任何测试会红。",
);

console.log(`[hotkey-actions] 动作名三处一致：${JSON.stringify(rustActions)}`);
