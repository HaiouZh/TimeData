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
// 变体名 → 动作 id。带载荷的变体（`Navigate { .. } => "navigate"`）也要认得出，
// 故变体名后允许跟一个 `{ … }` 模式。
const ACTION_ARM = /HotkeyAction::(\w+)(?:\s*\{[^}]*\})?\s*=>\s*"([^"]+)"/g;
const variantToId = new Map([...body[1].matchAll(ACTION_ARM)].map((m) => [m[1], m[2]]));
const rustActions = [...variantToId.values()].sort();
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

// ---- 消费分支覆盖 ----
// 上面三处比的都是**声明点**。真正决定「事件到了之后干什么」的是消费分支，
// 它一处都不在比对内：加动作时把三处声明点改全、漏掉消费分支 → 设置页选得到、
// Rust 校验通过、热键注册成功、按下去零可观察结果，而编译、全部测试、两道闸全绿。
// 规则：凡是 target_window 返回 Some 的动作，必须在**对应窗口**的消费文件里
// 出现一处 `event.action === "<id>"`；返回 None 的必须一处都没有。
const shellSource = readFileSync(new URL("../src-tauri/src/shell.rs", import.meta.url), "utf8");

const TARGET_WINDOW_FN = /pub fn target_window\(action: &HotkeyAction\) -> Option<&'static str> \{([\s\S]*?)\n\}/;
const twBody = TARGET_WINDOW_FN.exec(shellSource);
if (!twBody) {
  throw new Error(
    "[hotkey-actions] shell.rs 里找不到 target_window 函数体。投递映射的权威清单就是它，" +
      "函数改名/改形状要同步改本闸。",
  );
}

// 窗口常量名 → label 字面量（`pub const MAIN_WINDOW: &str = "main";`）。
// 比的是 label 值而不是常量名：闸里那张消费文件表按 label 写，改常量名不该让它失效。
const WINDOW_CONST = /pub const (\w+): &str = "([^"]+)";/g;
const constToLabel = new Map([...shellSource.matchAll(WINDOW_CONST)].map((m) => [m[1], m[2]]));

// label → 消费文件。加第三个窗口时必须在这里登记，否则下面会显式报错。
const CONSUMER_FILES = {
  main: "../../client/src/components/desktop/DesktopBridge.tsx",
  capture: "../../client/src/capture/CaptureApp.tsx",
};
const consumerSources = new Map(
  Object.entries(CONSUMER_FILES).map(([label, rel]) => [label, readFileSync(new URL(rel, import.meta.url), "utf8")]),
);

const ARM = /HotkeyAction::(\w+)(?:\s*\{[^}]*\})?\s*=>\s*(?:Some\((\w+)\)|(None))/g;
const arms = [...twBody[1].matchAll(ARM)];
if (arms.length !== variantToId.size) {
  throw new Error(
    `[hotkey-actions] target_window 解析到 ${arms.length} 支，action_id 有 ${variantToId.size} 个动作。` +
      "两处必须一一对应——对不上说明有动作没写投递映射，或本闸的正则跟不上新写法。",
  );
}

function consumesAction(source, id) {
  // 认 `event.action === "id"`，双引号/单引号都收，容许空白差异。
  return new RegExp(`\\.action\\s*===\\s*["']${id}["']`).test(source);
}

for (const [, variant, windowConst, isNone] of arms) {
  const id = variantToId.get(variant);
  if (!id) {
    throw new Error(`[hotkey-actions] target_window 里的 HotkeyAction::${variant} 在 action_id 里没有对应动作名。`);
  }
  if (isNone) {
    // Rust 直办的动作**不许**有消费分支：事件根本不会投到 WebView，那条分支是死代码。
    // 反向也守住了——某个动作的 target_window 被误改成 None 时，它遗留的消费分支会让本闸红，
    // 而那正是「热键按下去没反应」的成因。
    for (const [label, source] of consumerSources) {
      if (consumesAction(source, id)) {
        throw new Error(
          `[hotkey-actions] 动作 "${id}" 的 target_window 是 None（Rust 直办、不投任何 WebView），` +
            `但 ${label} 窗口的消费文件里有 event.action === "${id}" 分支。` +
            "要么把投递映射改回 Some，要么删掉那条永远触发不到的分支。",
        );
      }
    }
    continue;
  }
  const label = constToLabel.get(windowConst);
  if (!label) {
    throw new Error(`[hotkey-actions] shell.rs 里找不到窗口常量 ${windowConst} 的 label 字面量。`);
  }
  const source = consumerSources.get(label);
  if (!source) {
    throw new Error(
      `[hotkey-actions] label "${label}" 没有登记消费文件。新增窗口时要在本闸的 CONSUMER_FILES 里加一行，` +
        "否则投给它的动作漏写消费分支不会有任何东西报红。",
    );
  }
  if (!consumesAction(source, id)) {
    throw new Error(
      `[hotkey-actions] 动作 "${id}" 投给窗口 "${label}"，但 ${CONSUMER_FILES[label]} 里找不到 ` +
        `event.action === "${id}" 的消费分支。热键会注册成功、按下去零反应，且没有任何测试会红。`,
    );
  }
}

console.log(`[hotkey-actions] 动作名四处一致（含消费分支）：${JSON.stringify(rustActions)}`);
