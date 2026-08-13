import { checkHotkeyActions } from "./check-hotkey-actions.mjs";

// check-hotkey-actions.mjs 的消费分支检查自测（夹具驱动，不碰真实文件）。
//
// 背景：消费分支那段被架空（`if (false && !consumesAction(...))`）时，脚本照常
// exit 0 并打印成功行——这道闸「一边失效、一边在宣称自己在守」，没有任何东西
// 会发现它坏了。这里用假源码喂给抽出来的纯函数 checkHotkeyActions，验证它真的
// 会红。若有人再把消费分支检查架空，下面「消费文件缺分支必须抛错」就会变成
// 「该抛没抛」，本自测红。

// 夹具对应的动作面 = 生产代码现状：punch/toggleMain/capture/navigate 四动作，
// target_window 分别投 main / None / capture / main。
function actionIdSource() {
  return `pub fn action_id(action: &HotkeyAction) -> &'static str {
    match action {
        HotkeyAction::Punch => "punch",
        HotkeyAction::ToggleMain => "toggleMain",
        HotkeyAction::Capture => "capture",
        HotkeyAction::Navigate { .. } => "navigate",
    }
}
`;
}

function shellSource() {
  return `pub const MAIN_WINDOW: &str = "main";
pub const CAPTURE_WINDOW: &str = "capture";

pub fn target_window(action: &HotkeyAction) -> Option<&'static str> {
    match action {
        HotkeyAction::Punch => Some(MAIN_WINDOW),
        HotkeyAction::Capture => Some(CAPTURE_WINDOW),
        HotkeyAction::ToggleMain => None,
        HotkeyAction::Navigate { .. } => Some(MAIN_WINDOW),
    }
}
`;
}

function apiSource() {
  return `export type DesktopHotkeyEvent = {
  action: "punch" | "toggleMain" | "capture" | "navigate";
};
`;
}

function settingsSource() {
  return `const ACTION_OPTIONS = [
  { value: "punch", label: "打点" },
  { value: "toggleMain", label: "主窗口" },
  { value: "capture", label: "速记" },
  { value: "navigate", label: "跳转" },
];
`;
}

const CONSUMER_PATHS = {
  main: "../../client/src/components/desktop/DesktopBridge.tsx",
  capture: "../../client/src/capture/CaptureApp.tsx",
};

// 完整版：punch/navigate 由主窗口消费，capture 由浮窗消费，toggleMain 无分支（正确）。
// 用与生产代码一致的 `event.action === "id"` 形态——consumesAction 认的就是它。
function consumerSources(overrides = {}) {
  return {
    main: `if (event.action === "punch") { void punchNow(); }
if (event.action === "navigate") { void navigateTo(event.target); }
`,
    capture: `if (event.action === "capture") { void openCapture(); }
`,
    ...overrides,
  };
}

function fullFixture(consumerOverrides = {}) {
  return {
    actionIdSource: actionIdSource(),
    apiSource: apiSource(),
    settingsSource: settingsSource(),
    shellSource: shellSource(),
    consumerSources: consumerSources(consumerOverrides),
    consumerPaths: CONSUMER_PATHS,
  };
}

function expectOk(label, fn) {
  try {
    fn();
  } catch (e) {
    throw new Error(`用例「${label}」应当通过却抛错：${e.message}`);
  }
}

function expectThrow(label, fn, messagePart) {
  let threw = false;
  try {
    fn();
  } catch (e) {
    threw = true;
    if (messagePart && !e.message.includes(messagePart)) {
      throw new Error(`用例「${label}」抛错了但信息不含「${messagePart}」：${e.message}`);
    }
  }
  if (!threw) {
    throw new Error(`用例「${label}」应当抛错却没有抛`);
  }
}

// ① 全部齐全 → 通过（返回值必须是原样成功行）。
expectOk("全部齐全时通过", () => {
  const line = checkHotkeyActions(fullFixture());
  if (line !== '[hotkey-actions] 动作名四处一致（含消费分支）：["capture","navigate","punch","toggleMain"]') {
    throw new Error(`成功行与原样不一致：${line}`);
  }
});

// ② 动作投给某窗口但消费文件里没有对应分支 → 必须抛错。
//    这条同时就是变异测试：把消费分支检查架空后这里会「该抛没抛」，本自测立刻红。
expectThrow(
  "消费文件缺 navigate 分支必须抛错",
  () =>
    checkHotkeyActions(
      fullFixture({
        main: `if (event.action === "punch") { void punchNow(); }
`,
      }),
    ),
  '"navigate"',
);

// ③ target_window 是 None 的动作在消费文件里却有分支 → 必须抛错。
expectThrow(
  "None 动作带消费分支必须抛错",
  () =>
    checkHotkeyActions(
      fullFixture({
        main: `${consumerSources().main}
if (event.action === "toggleMain") { /* 死代码 */ }
`,
      }),
    ),
  '"toggleMain"',
);

console.log("[hotkey-actions.test] 3 条自测通过（含消费分支立闸，能抓住消费分支检查被架空）");
