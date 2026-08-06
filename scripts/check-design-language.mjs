import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "packages", "client", "src");
const ALLOWLIST = join(ROOT, "scripts", "design-language-allowlist.json");
const COLOR_PREFIXES =
  "bg|text|border(?:-[trblxy]{1,2})?|ring|from|to|via|divide|placeholder|ring-offset|fill|stroke|outline|caret|accent|shadow|decoration";
const TAILWIND_VARIANTS = "(?:[a-z][a-z0-9-]*:)*!?";
// unknown-semantic-color 只审计这 12 个颜色 utility 前缀（COLOR_PREFIXES 里 from/to/via/shadow
// 是渐变/阴影词、ring-offset 归 offset-* 形态，不产生「拼错 token 静默失效」类问题）。
const SEMANTIC_COLOR_PREFIXES =
  "text|bg|border|ring|outline|fill|stroke|divide|decoration|placeholder|caret|accent";
// `(?<![a-z0-9-])` 拒绝 `td-text-caption` / `data-ring-*` 这类连字符合成词——它们不是颜色 utility。
// 变体前缀照收（hover:text-ink、md:bg-surface、dark:border-danger 都合法）；name 必须小写开头，
// 纯数字档（border-2、ring-1）与数字开头的字号档（text-2xl）天然匹配不上，无需白名单。
const UNKNOWN_SEMANTIC_COLOR_RE = new RegExp(
  `(?<![a-z0-9-])(?:[a-z][a-z0-9-]*:)*(?:${SEMANTIC_COLOR_PREFIXES})-([a-z][a-z0-9-]*)`,
  "g",
);
// Tailwind 内置调色板（slate-400、blue-600 等）是「裸色」，已由既有 bare-* 规则管辖，
// 本规则不重复报；判据是「调色板名 + 数字档」形态。black/white 无数字档、裸写
// `text-white`/`bg-black` 由 bare-black-white 管辖，同样放行不重复报。
const BUILTIN_PALETTE_NAME_RE = new RegExp(
  "^(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\\d+$|^(?:black|white)(?:-\\d+)?$",
);
// Tailwind 内置「非颜色」工具类里恰好落在 `<前缀>-<名字>` 形态的合法用法。
// 这份清单是 Tailwind v4 框架 API 的一部分，不是项目内手抄清单；新增合法用法在此补登记。
const BUILTIN_UTIL_NAMES = {
  all: new Set(["transparent", "current", "inherit"]), // 全前缀通用：透明 / 当前色 / 继承
  text: new Set([
    // 对齐 / 换行 / 溢出
    "left", "center", "right", "justify", "start", "end", "wrap", "nowrap", "balance", "pretty",
    "ellipsis", "clip",
    // 字号档（xs/sm/base/lg/xl；2xl-9xl 数字开头匹配不上扫描正则，天然豁免）
    "xs", "sm", "base", "lg", "xl",
  ]),
  bg: new Set([
    // 背景尺寸 / 位置 / 重复 / 附着
    "none", "cover", "contain", "auto", "fixed", "local", "scroll",
    "center", "top", "bottom", "left", "right", "repeat", "no-repeat",
  ]),
  border: new Set([
    // 边框样式 / 表格边框 / box-sizing 讨论词（`border-box` 是 CSS 属性值，注释与文档里常见）
    "solid", "dashed", "dotted", "double", "hidden", "none", "collapse", "separate", "spacing", "box",
  ]),
  ring: new Set(["inset", "none", "solid", "dashed", "dotted", "double"]),
  outline: new Set(["none", "solid", "dashed", "dotted", "double"]),
  divide: new Set(["none", "solid", "dashed", "dotted", "double"]),
  decoration: new Set(["none", "solid", "dashed", "dotted", "double", "wavy"]),
  fill: new Set(["none"]),
  stroke: new Set([
    // SVG presentation 属性名（stroke-dasharray 等，JSX 属性/注释里常见）
    "none", "dasharray", "dashoffset", "linecap", "linejoin", "miterlimit", "width",
  ]),
  caret: new Set(["auto"]),
  accent: new Set(["auto"]),
  placeholder: new Set([]),
};
// 形态白名单：带子功能的复合 utility，只按形态放行不穷举后缀。
const BUILTIN_UTIL_NAME_PATTERNS = [
  /^origin-[\w-]+$/, // bg-origin-*（background-origin）
  /^clip-[\w-]+$/, // bg-clip-*（background-clip）
  /^blend-[\w-]+$/, // bg-blend-*（混合模式）
  /^gradient-to-[a-z]+$/, // bg-gradient-to-*（渐变方向）
  /^offset-[\w-]+$/, // ring/outline/decoration 的 offset-*
  /^[trblxyse](?:-\d+)?$/, // border 方位（border-t、border-l-2）；divide-x/y 同理
];
const LEGAL_RULE_IDS = new Set();

// 「文本字符冒充图标」白名单。收录判据：该字符在 UI 里几乎只可能当图标用（关闭/勾选、尖角、
// 三角、箭头、放大还原、省略更多、步进正负、菜单星标），不会作为正文内容出现。
// **不收**真正的文字标点与数学符号：`–`(en dash) / `—`(em dash，中文破折号) / `±` / `÷` / `≈` /
// `•` 都可能是正文，收进来会大面积误报。白名单是穷举式的，新符号需显式补入。
const INTERACTIVE_TEXT_ICON_CHARS = [
  // 关闭 / 勾选
  "x",
  "×",
  "✕",
  "✖",
  "✗",
  "✘",
  "✓",
  "✔",
  // 尖角 / 折叠指示
  "›",
  "‹",
  "❯",
  "❮",
  "⌃",
  "⌄",
  // 三角（展开 / 排序 / 步进）
  "▲",
  "▼",
  "◀",
  "▶",
  "▴",
  "▾",
  "◂",
  "▸",
  // 箭头
  "←",
  "→",
  "↑",
  "↓",
  "↔",
  "↕",
  // 放大 / 还原（对角双向箭头 + 窗口方块）
  "⤢",
  "⤡",
  "▢",
  // 省略 / 更多
  "⋯",
  "…",
  "⋮",
  "...",
  // 步进正负（`−` 是 U+2212 减号、`－` 是 U+FF0D 全角，都不是 ASCII `-`）
  "+",
  "＋",
  "➕",
  "-",
  "−",
  "－",
  "➖",
  // 菜单 / 星标
  "☰",
  "★",
  "☆",
];
const INTERACTIVE_TEXT_ICON_ENTITIES = [
  "&times;",
  "&plus;",
  "&minus;",
  "&rarr;",
  "&larr;",
  "&uarr;",
  "&darr;",
  "&hellip;",
  "&rsaquo;",
  "&lsaquo;",
  "&check;",
  "&cross;",
];

function escapeForRegExp(literal) {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const INTERACTIVE_TEXT_ICON_PATTERN = `(?:${[...INTERACTIVE_TEXT_ICON_CHARS, ...INTERACTIVE_TEXT_ICON_ENTITIES]
  .map(escapeForRegExp)
  .join("|")})`;
const INTERACTIVE_TEXT_ICON_RE = new RegExp(
  `(?:>\\s*${INTERACTIVE_TEXT_ICON_PATTERN}\\s*<|\\{\\s*["']${INTERACTIVE_TEXT_ICON_PATTERN}["']\\s*\\})`,
);
const INTERACTIVE_TEXT_ICON_EXACT_RE = new RegExp(`^${INTERACTIVE_TEXT_ICON_PATTERN}$`);
const INTERACTIVE_CONTEXT_RE = /<button\b|<a\b|<Link\b|<NavLink\b|role=["']button["']|onClick=/;
const TD_TEXT_STEP = "td-text-(?:caption|label|body|title|display)";
// 变体前缀照收，但 important 不收：`leading-6!` / `!leading-6` 会翻转 layer 优先级、真的压过顶层
// 规则，那不是死类，按死类报会给出错误指引。
const LEADING_UTIL = "(?:[a-z][a-z0-9-]*:)*(?<!!)leading-(?:\\[[^\\]]+\\]|[a-z0-9.]+)(?!!)";

const COLOR_FIXTURE_RULES = new Set([
  "retired-module-colors",
  "retired-data-colors",
  "retired-motion-tokens",
  "retired-soft-status-colors",
  "bare-action-blue",
  "bare-status-color",
  "bare-slate-chrome",
  "bare-black-white",
  "bare-raw-color",
  "unknown-semantic-color",
]);

const RULES = [
  {
    id: "retired-module-colors",
    re: new RegExp(`(--color-mod-|${TAILWIND_VARIANTS}(?:${COLOR_PREFIXES})-mod-)`),
    msg: "退役模块署名色不得新增或继续消费；UI chrome 改 page/surface/border/ink 中性 token",
  },
  {
    id: "retired-data-colors",
    re: new RegExp(
      `(?:--color-data-|\\b${TAILWIND_VARIANTS}(?:${COLOR_PREFIXES})-data-(?:blue|teal|green|amber|red|purple)(?:\\/\\d+)?\\b)`,
    ),
    msg: "退役 data palette 不得重新定义或消费；图表序列走业务数据色，Track agent 使用 track-agent",
  },
  {
    id: "retired-motion-tokens",
    re: new RegExp(
      `(?:--(?:duration-(?:fast|base|slow)|ease-(?:standard|emphasized))\\b|var\\(--(?:duration-(?:fast|base|slow)|ease-(?:standard|emphasized))\\)|\\b${TAILWIND_VARIANTS}(?:duration|ease)-(?:fast|base|slow|standard|emphasized)\\b)`,
    ),
    msg: "motion 使用 Tailwind 标准档；keyframe 在 index.css 邻近写具体时长/曲线，不再使用退役 motion token",
  },
  {
    id: "retired-soft-status-colors",
    re: new RegExp(
      `(?:--color-(?:ok|warn|danger)-soft\\b|var\\(--color-(?:ok|warn|danger)-soft\\)|\\b${TAILWIND_VARIANTS}(?:${COLOR_PREFIXES})-(?:ok|warn|danger)-soft(?:\\/\\d+)?\\b)`,
    ),
    msg: "退役 soft 状态色不得通过任何颜色 utility 消费；状态面使用 ok/warn/danger 的 alpha 档（背景 /10，hover /15）",
  },
  {
    id: "bare-action-blue",
    re: new RegExp(`\\b${TAILWIND_VARIANTS}(?:${COLOR_PREFIXES})-(?:blue|sky)-\\d{2,3}(?:\\/\\d+)?\\b`),
    msg: "动作/焦点蓝必须使用 accent token（bg-accent / text-accent / ring-accent / focus-visible:ring-accent）",
  },
  {
    id: "bare-status-color",
    re: new RegExp(
      `\\b${TAILWIND_VARIANTS}(?:${COLOR_PREFIXES})-(?:emerald|green|amber|yellow|orange|red|rose|gray)-\\d{2,3}(?:\\/\\d+)?\\b`,
    ),
    msg: "状态色必须使用 ok/warn/danger token（bg-ok、text-danger、border-warn 等）",
  },
  {
    id: "bare-slate-chrome",
    re: new RegExp(`\\b${TAILWIND_VARIANTS}(?:${COLOR_PREFIXES})-slate-\\d{2,3}(?:\\/\\d+)?\\b`),
    msg: "UI chrome 必须使用 page/surface/border/ink token（bg-surface、text-ink-2、border-border 等）",
  },
  {
    id: "bare-black-white",
    re: new RegExp(
      `\\b${TAILWIND_VARIANTS}(?:${COLOR_PREFIXES})-(?:white|black)(?:\\/\\d+(?:\\.\\d+)?)?\\b|\\b${TAILWIND_VARIANTS}(?:${COLOR_PREFIXES})-\\[(?:white|black)(?:\\/\\d+(?:\\.\\d+)?)?\\]`,
    ),
    msg: "黑白命名色必须 token 化：遮罩用 bg-backdrop/*，accent 实心面反白字用 text-accent-contrast",
    skip: (file) => isTestFile(file),
  },
  {
    id: "bare-raw-color",
    re: /(?:#[0-9A-Fa-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(|oklab\(|lch\(|lab\()/,
    msg: "UI chrome 不得直接写裸 hex/rgb/hsl/oklch/lab；颜色唯一事实源是 index.css @theme 的 --color-* token",
    skip: (file, line) => isThemeTokenDeclaration(file, line) || isTokenColorMirror(file),
  },
  {
    id: "interactive-text-icon",
    re: INTERACTIVE_TEXT_ICON_RE,
    msg: "交互图标必须使用 Phosphor（components/Icon.tsx 包装），不得用文字字符/emoji 伪装",
    skip: (_file, line) => !isInteractiveTextIconLine(line),
  },
  {
    id: "font-mono-business-number",
    re: /\bfont-mono\b/,
    msg: "业务时间/数字/统计值使用 td-num/td-time/td-duration 语义类；font-mono 只给 code/pre/kbd/samp 等技术文本",
    skip: (file, line) => isFontMonoTechnicalLine(file, line),
  },
  {
    id: "bare-card-radius",
    re: new RegExp(
      `\\b${TAILWIND_VARIANTS}rounded(?:-(?:[trblxy]{1,2}|[se]{1,2}))?-(?:md|lg|xl|2xl|3xl|full)\\b|\\b${TAILWIND_VARIANTS}rounded-\\[[0-9.]+(?:px|rem)\\]`,
    ),
    msg: "生产圆角必须使用 rounded-ctl/row/card/pill（rounded/rounded-sm 仅保留给原子细节），对应 --radius-ctl/row/card/pill",
    skip: (file) => isTestFile(file),
  },
  {
    id: "bare-zindex",
    re: new RegExp(`\\b${TAILWIND_VARIANTS}z-(?:(?!0\\b|10\\b|20\\b)\\d{1,3}\\b|\\[\\d+\\])`),
    msg: "全局浮层 z-index 必须用 z-[var(--z-*)]（局部 stacking 用 z-10/z-20；内联 style.zIndex 用 lib/zLayers.ts 的 Z）",
    skip: (file) => isTestFile(file),
  },
  {
    id: "bare-text-size",
    re: new RegExp(`\\b${TAILWIND_VARIANTS}text-(?:xs|sm|base|lg|\\dxl|xl)\\b|\\btext-\\[[0-9.]+(?:px|rem)\\]`),
    msg: "字号必须使用 .td-text-{caption,label,body,title,display} 语义类；input/textarea/select 与图标按钮上的字号声明不生效，直接删除",
    skip: (file) => isTestFile(file) || normalizePath(file).endsWith(".css"),
  },
  {
    id: "dead-leading-on-td-text",
    // 同一 className 串里同时出现两者即违规（谁在前都算）；[^"]* 保证不跨属性误伤。
    re: new RegExp(`\\b${TD_TEXT_STEP}\\b[^"]*\\b${LEADING_UTIL}|\\b${LEADING_UTIL}[^"]*\\b${TD_TEXT_STEP}\\b`),
    msg: "td-text-* 锁死 line-height 且定义在顶层未分层区、优先级压过 @layer utilities，同串的 leading-* 在此是死类；要调高度改 padding 或 flex 居中，确需改行高则加排版角色语义类（design-language §2）",
    skip: (file) => isTestFile(file),
  },
  {
    id: "bare-arbitrary-value",
    // 间距/尺寸/定位的裸任意值（纯数字+单位）；字号任意值归 bare-text-size，calc/var/content 例外。
    re: new RegExp(
      `\\b${TAILWIND_VARIANTS}(?:w|h|min-w|min-h|max-w|max-h|top|bottom|left|right|inset|m[trblxy]?|p[trblxy]?|gap|gap-[xy]|translate-[xy])-\\[[0-9.]+(?:px|rem|em|vh|vw)\\]`,
    ),
    msg: "裸任意尺寸/间距值收进 --radius/--shadow token 或标准 Tailwind 阶；功能专有几何在 index.css @layer components 加功能语义类（calc/var 例外）",
    skip: (file) => isTestFile(file),
  },
  {
    id: "handwritten-segmented-control",
    re: /aria-pressed=\{[^>]*rounded-pill|rounded-pill[^>]*aria-pressed=\{/,
    msg: "单选筛选分段必须使用 SegmentedControl（role=radiogroup）；手写 rounded-pill + aria-pressed 是历史遗留形态，新代码不得复制",
    skip: (file, line) =>
      isTestFile(file) || /role="tablist"|role="tab"/.test(line) || /SegmentedControl/.test(line),
  },
  {
    id: "bare-text-empty-state",
    re: /py-10[^>]*text-center/,
    msg: "空态必须使用 EmptyState 组件（card/inline 档）；裸 py-10 text-center 文本是历史遗留形态，新代码不得复制",
    skip: (file, line) =>
      isTestFile(file) || /EmptyState/.test(line) || normalizePath(file).endsWith("/components/ui/EmptyState.tsx"),
  },
  {
    id: "h1-without-title-size",
    re: /<h1\b/,
    msg: "页面 h1 必须使用 td-text-title 或 td-text-display（td-text-body font-medium 当标题是历史遗留层级分裂，新代码不得复制）",
    skip: (file, line) => isTestFile(file) || /td-text-title/.test(line) || /td-text-display/.test(line),
  },
];

for (const rule of RULES) {
  LEGAL_RULE_IDS.add(rule.id);
}
// 跨行才判得了（td-text-* 落在普通元素上完全合法），不进 RULES；id 在此登记以便 allowlist 校验。
LEGAL_RULE_IDS.add("input-font-size-override");
// 合法颜色名要运行时读 index.css @theme 的 --color-* 集合（硬编码就是又一份会漂的手抄清单），
// 不进静态 RULES；id 在此登记以便 allowlist 校验。
LEGAL_RULE_IDS.add("unknown-semantic-color");

const INPUT_TAG_RE = /<(?:input|textarea|select)\b[\s\S]*?\/?>/g;
const TD_TEXT_CLASS_RE = new RegExp(TD_TEXT_STEP);
// key 用 lines 数组本身：每次读文件都是新数组，天然隔离不同文件与不同调用。
const inputTagLinesCache = new WeakMap();

/** 落在 input / textarea / select 开标签内部的行号集合（1-based）。 */
function inputTagLines(lines) {
  const cached = inputTagLinesCache.get(lines);
  if (cached) return cached;
  // JSX 属性里的箭头函数 => 含 >，会把标签匹配截断，扫描前先换成替身。
  const src = lines.join("\n").replace(/=>/g, "=»");
  const covered = new Set();
  INPUT_TAG_RE.lastIndex = 0;
  let match = INPUT_TAG_RE.exec(src);
  while (match !== null) {
    const start = src.slice(0, match.index).split("\n").length;
    const end = start + match[0].split("\n").length - 1;
    for (let line = start; line <= end; line++) covered.add(line);
    match = INPUT_TAG_RE.exec(src);
  }
  inputTagLinesCache.set(lines, covered);
  return covered;
}

// JSX 纯文本子节点：`>` 与下一个 `<` 之间的内容。`[^<>]*` 把匹配锁在同一对尖括号之间，
// 既天然不贪婪（吞不掉整段 JSX），又让属性里的箭头函数 `=>` 自动落空（它后面必然先遇到标签的
// `>` 而不是 `<`）。`<` 用前瞻不消费，避免相邻两段子节点被吃掉一个。
const JSX_TEXT_CHILD_RE = />([^<>]*)(?=<)/g;
const JSX_STRING_LITERAL_RE = /"([^"]*)"|'([^']*)'/g;
// key 用 lines 数组本身，同 inputTagLinesCache。
const textIconChildLinesCache = new WeakMap();

/**
 * 这段 JSX 子节点内容是不是「整个子节点就是一个伪装图标」。
 * 两种形态：裸字符（`▢` 独占一行）与纯字面量表达式（`{expanded ? "▢" : "⤢"}`）。
 * 表达式形态刻意排除括号 / 嵌套花括号 / 模板串——`{t("x")}` 这类调用不算图标。
 */
function isTextIconChild(text) {
  const trimmed = text.trim();
  if (trimmed === "") return false;
  if (INTERACTIVE_TEXT_ICON_EXACT_RE.test(trimmed)) return true;
  if (!/^\{[^(){}<>`]*\}$/.test(trimmed)) return false;
  let sawIcon = false;
  JSX_STRING_LITERAL_RE.lastIndex = 0;
  let match = JSX_STRING_LITERAL_RE.exec(trimmed);
  while (match !== null) {
    const literal = match[1] ?? match[2] ?? "";
    // 空串是三元的「另一支不渲染」，不影响判定
    if (literal !== "") {
      if (!INTERACTIVE_TEXT_ICON_EXACT_RE.test(literal)) return false;
      sawIcon = true;
    }
    match = JSX_STRING_LITERAL_RE.exec(trimmed);
  }
  return sawIcon;
}

/** 承载伪装图标文本子节点的行号集合（1-based）；符号独占一行时 `>`/`<` 不同行，只能整文件扫。 */
function textIconChildLines(lines) {
  const cached = textIconChildLinesCache.get(lines);
  if (cached) return cached;
  const src = lines.join("\n");
  const hits = new Set();
  JSX_TEXT_CHILD_RE.lastIndex = 0;
  let match = JSX_TEXT_CHILD_RE.exec(src);
  while (match !== null) {
    const text = match[1];
    if (isTextIconChild(text)) {
      const inner = new RegExp(INTERACTIVE_TEXT_ICON_PATTERN).exec(text);
      const offset = match.index + 1 + (inner?.index ?? 0);
      hits.add(src.slice(0, offset).split("\n").length);
    }
    match = JSX_TEXT_CHILD_RE.exec(src);
  }
  textIconChildLinesCache.set(lines, hits);
  return hits;
}

function normalizePath(file) {
  return file.replace(/\\/g, "/");
}

// index.css @theme 的 --color-<name> 集合（运行时读取，唯一事实源）。
// null = 未加载；懒加载避免测试里 import 模块时就被文件系统绑定。
let semanticColorNames = null;
const THEME_COLOR_RE = /^\s*--color-([a-z][a-z0-9-]*):/;

export function getSemanticColorNames() {
  if (semanticColorNames === null) {
    semanticColorNames = new Set();
    const cssPath = join(ROOT, "packages", "client", "src", "index.css");
    if (existsSync(cssPath)) {
      for (const line of readFileSync(cssPath, "utf8").split(/\r?\n/)) {
        const match = THEME_COLOR_RE.exec(line);
        if (match) semanticColorNames.add(match[1]);
      }
    }
  }
  return semanticColorNames;
}

/** 测试注入：传 null 恢复真实文件读取。 */
export function setSemanticColorNamesForTests(names) {
  semanticColorNames = names === null ? null : new Set(names);
}

/** name 是否 Tailwind 内置非颜色工具类（否则就是「看起来像语义色、实际不存在」的拼错 token）。 */
function isBuiltinNonColorUtil(prefix, name) {
  if (BUILTIN_PALETTE_NAME_RE.test(name)) return true;
  if (BUILTIN_UTIL_NAMES.all.has(name)) return true;
  if (BUILTIN_UTIL_NAMES[prefix]?.has(name)) return true;
  return BUILTIN_UTIL_NAME_PATTERNS.some((pattern) => pattern.test(name));
}

function isTestFile(file) {
  return /\.test\.[jt]sx?$/.test(normalizePath(file));
}

// index.css @theme 里的设计 token 定义本身是颜色的唯一事实源，不算「裸色」。
// 覆盖 --color-* / --galaxy-* 颜色值，以及 --shadow-* 阴影 token（其值含 rgba 但同属 token 定义）。
function isThemeTokenDeclaration(file, line) {
  const normalized = normalizePath(file);
  if (normalized !== "packages/client/src/index.css" && normalized !== "index.css") return false;
  return (
    /^\s*--(?:color|galaxy)-[\w-]+:\s*(?:#[0-9A-Fa-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(|oklab\(|lch\(|lab\()/.test(line) ||
    /^\s*--shadow-[\w-]+:/.test(line)
  );
}

// Token 镜像文件：SVG presentation 属性（recharts）与 SVG data-URI（favicon）都不解析 var()，
// 故这些文件把 index.css 的 --color-* token 镜像成具体 hex 的 JS 常量，是 token 唯一事实源的镜像，
// 不是 UI chrome 裸色。集中登记，便于审计。
const TOKEN_MIRROR_FILES = new Set([
  "packages/client/src/pages/stats/chartColors.ts", // 中性 chrome token
  "packages/client/src/lib/navigation/routeFavicon.ts", // --color-page / --color-ink（favicon SVG data-URI）
]);

function isTokenColorMirror(file) {
  return TOKEN_MIRROR_FILES.has(normalizePath(file));
}

function isFontMonoTechnicalLine(file, line) {
  if (normalizePath(file).endsWith(".css")) return true;
  if (line.includes("--font-mono")) return true;
  return /<(?:code|pre|kbd|samp)\b/.test(line);
}

function isInteractiveTextIconLine(line) {
  return INTERACTIVE_CONTEXT_RE.test(line) && INTERACTIVE_TEXT_ICON_RE.test(line);
}

export function classifyLine(file, line) {
  const normalized = normalizePath(file);
  const testFile = isTestFile(normalized);
  const violations = [];

  for (const rule of RULES) {
    if (testFile && (COLOR_FIXTURE_RULES.has(rule.id) || rule.id === "font-mono-business-number")) continue;
    if (rule.skip?.(normalized, line)) continue;
    if (rule.re.test(line)) {
      violations.push({ rule: rule.id, message: rule.msg });
    }
  }

  // unknown-semantic-color：颜色 token 集合是运行时读取的，不进 RULES 静态数组。
  // 只扫 .tsx/.ts（class 名使用处）；.css 里的 text-transform/border-radius 等是 CSS 属性名不是 class。
  // 测试文件跳过（fixture 断言字符串不算代码审计对象，与 COLOR_FIXTURE_RULES 同一惯例）。
  if (!testFile && !normalized.endsWith(".css")) {
    const colorNames = getSemanticColorNames();
    UNKNOWN_SEMANTIC_COLOR_RE.lastIndex = 0;
    let match = UNKNOWN_SEMANTIC_COLOR_RE.exec(line);
    while (match !== null) {
      const name = match[1];
      if (!colorNames.has(name) && !isBuiltinNonColorUtil(unknownColorPrefix(match[0]), name)) {
        violations.push({
          rule: "unknown-semantic-color",
          message: `语义色 utility「${match[0]}」在本项目不存在（index.css @theme 无 --color-${name}）——Tailwind 不报错、类静默失效，元素继承父级颜色；去 packages/client/src/index.css 核对 token 名或补 token`,
        });
      }
      match = UNKNOWN_SEMANTIC_COLOR_RE.exec(line);
    }
  }

  return violations;
}

// 匹配串里去掉变体前缀后的颜色前缀（hover:text-inkk → text）。
function unknownColorPrefix(fullMatch) {
  const core = fullMatch.slice(fullMatch.lastIndexOf(":") + 1);
  return core.slice(0, core.indexOf("-"));
}

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full, files);
      continue;
    }
    if (/\.(?:ts|tsx|css)$/.test(name)) files.push(full);
  }
  return files;
}

function normalizeLineText(lineText) {
  return String(lineText ?? "").trim();
}

function allowlistKey({ file, rule, lineText }) {
  return `${rule}:${normalizePath(file)}:${normalizeLineText(lineText)}`;
}

export function loadAllowlist(raw = undefined) {
  const source = raw ?? (existsSync(ALLOWLIST) ? JSON.parse(readFileSync(ALLOWLIST, "utf8")) : { entries: [] });
  if (source.version !== undefined && source.version !== 1) {
    throw new Error(`scripts/design-language-allowlist.json: unsupported version ${source.version}`);
  }

  const entries = source.entries ?? [];
  if (!Array.isArray(entries)) {
    throw new Error("scripts/design-language-allowlist.json: entries must be an array");
  }

  const counts = new Map();
  entries.forEach((entry, index) => {
    for (const field of ["file", "rule", "lineText", "reason", "ownerBatch", "removeBy"]) {
      if (!entry[field]) {
        throw new Error(`scripts/design-language-allowlist.json: entries[${index}] missing ${field}`);
      }
    }
    if (!LEGAL_RULE_IDS.has(entry.rule)) {
      throw new Error(`scripts/design-language-allowlist.json: entries[${index}] unknown rule ${entry.rule}`);
    }
    const key = allowlistKey(entry);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });

  return { entries, counts, usedCounts: new Map() };
}

export function isAllowed(file, rule, lineText, allowlist) {
  const key = allowlistKey({ file, rule, lineText });
  const allowedCount = allowlist.counts.get(key) ?? 0;
  const usedCount = allowlist.usedCounts.get(key) ?? 0;
  if (usedCount >= allowedCount) return false;
  allowlist.usedCounts.set(key, usedCount + 1);
  return true;
}

export function collectViolations({ src = SRC, root = ROOT, allowlist = loadAllowlist(), files = null } = {}) {
  const violations = [];
  const inputs =
    files ??
    walk(src).map((full) => ({
      file: normalizePath(relative(root, full)),
      content: readFileSync(full, "utf8"),
    }));

  for (const input of inputs) {
    const rel = normalizePath(input.file);
    const lines = input.content.split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const violation of classifyLineWithContext(rel, line, lines, index)) {
        const lineText = normalizeLineText(line);
        if (isAllowed(rel, violation.rule, lineText, allowlist)) continue;
        violations.push({
          file: rel,
          line: index + 1,
          rule: violation.rule,
          message: violation.message,
          lineText,
        });
      }
    });
  }

  const remainingUsedCounts = new Map(allowlist.usedCounts);
  const staleAllowlist = allowlist.entries.filter((entry) => {
    const key = allowlistKey(entry);
    const usedCount = remainingUsedCounts.get(key) ?? 0;
    if (usedCount <= 0) return true;
    remainingUsedCounts.set(key, usedCount - 1);
    return false;
  });
  return { violations, staleAllowlist };
}

function classifyLineWithContext(file, line, lines, index) {
  const violations = classifyLine(file, line);
  if (TD_TEXT_CLASS_RE.test(line) && inputTagLines(lines).has(index + 1)) {
    violations.push({
      rule: "input-font-size-override",
      message:
        "输入控件不写字号类：index.css 已把 input/textarea/select 兜底到 16px 消除 iOS 聚焦缩放，td-text-* 三档都小于 16px，类选择器优先级更高会把兜底顶掉",
    });
  }
  if (violations.some((violation) => violation.rule === "interactive-text-icon")) return violations;
  if (!INTERACTIVE_TEXT_ICON_RE.test(line) && !textIconChildLines(lines).has(index + 1)) return violations;

  const contextStart = Math.max(0, index - 8);
  const contextEnd = Math.min(lines.length, index + 9);
  const context = lines.slice(contextStart, contextEnd).join("\n");
  if (INTERACTIVE_CONTEXT_RE.test(context)) {
    violations.push({
      rule: "interactive-text-icon",
      message: "交互图标必须使用 Phosphor Icon",
    });
  }
  return violations;
}

function main() {
  const { violations, staleAllowlist } = collectViolations();
  if (violations.length > 0) {
    console.error(
      `✗ 设计语言棘轮闸（新增违规 ${violations.length}）：\n${violations
        .map((violation) => `${violation.file}:${violation.line} ${violation.rule} ${violation.message}`)
        .join("\n")}\n\n修法指引：正确 token / 语义类与规则清单见 docs/evergreen/design-language.md §3，效果可在 /dev/styleguide 预览。旧债请写入 scripts/design-language-allowlist.json，并在对应批次完成后删除；新代码违规不得写入 allowlist。`,
    );
    process.exit(1);
  }
  if (staleAllowlist.length > 0) {
    console.error(
      `✗ 设计语言 allowlist 有 ${staleAllowlist.length} 条已失效，请删除：\n${staleAllowlist
        .map((entry) => `${entry.file} ${entry.rule} ${JSON.stringify(entry.lineText)}`)
        .join("\n")}`,
    );
    process.exit(1);
  }
  console.log("✓ 设计语言：无未豁免违规（裸色/退役色/退役 token/黑白命名色/裸字号/输入控件字号/裸圆角/裸 z-index/裸任意值/散装图标/业务 font-mono/未知语义色）");
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main();
}
