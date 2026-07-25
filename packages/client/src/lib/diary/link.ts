// 日记编辑器 Ctrl+K 补 markdown 链接。
// 权威语义见 docs_local/plans/2026-07-25-diary-workbench-编辑器-勘察/4-键位语义.md 第二部分（§2.1–§2.8），
// 边界表（K1–K28）全部原型（同目录 p2keys-proto2.mjs）实跑产出，本文件的测试直接抄自那张表（link.test.ts）。
// 代码围栏 / front-matter 豁免复用 listModel.ts 的 scanProtected——这是审查发现的缺口（G4，原设计
// design §4.4 没提）：在这些块里插 "[]()" 一样会污染 vault，危害与 Tab 缩进（indent.ts）完全同构。

import { lineIndexAt, scanProtected, splitLines } from "./listModel.js";
import type { EditAction } from "./textareaEdit.js";

/**
 * 行内扫描器：判定 [selStart, selEnd] 是否落在同一行内已有的 markdown 链接 `[文本](URL)` 上。
 * 不用正则——嵌套圆括号（维基百科式 URL，如 `Foo_(bar)`）必须靠深度计数，正则做不到。
 * 只在 selStart 与 selEnd 落在同一行时才可能命中：跨行选区更早被 case ③（含换行 → noop）拦截，
 * 走不到这里；单点光标天然满足"同一行"。
 */
function findLinkAt(value: string, selStart: number, selEnd: number): { urlStart: number; urlEnd: number } | null {
  const ls = value.lastIndexOf("\n", selStart - 1) + 1;
  const nlAfterEnd = value.indexOf("\n", selEnd);
  const le = nlAfterEnd === -1 ? value.length : nlAfterEnd;
  if (value.lastIndexOf("\n", selEnd - 1) + 1 !== ls) return null; // 保险：selStart/selEnd 不同行

  const line = value.slice(ls, le);
  let i = 0;
  while (i < line.length) {
    if (line[i] !== "[") {
      i += 1;
      continue;
    }
    let j = i + 1;
    let brokenByNestedBracket = false;
    while (j < line.length && line[j] !== "]") {
      if (line[j] === "[") {
        brokenByNestedBracket = true;
        break;
      }
      j += 1;
    }
    if (brokenByNestedBracket) {
      i = j; // 不允许嵌套方括号：把起点重置到那个新 "["，继续扫描
      continue;
    }
    if (j >= line.length || line[j + 1] !== "(") {
      i = j + 1; // 没找到 "]" 或 "]" 后不接 "(" ：不是链接，从 "]" 之后继续找
      continue;
    }
    let k = j + 2;
    let depth = 1;
    while (k < line.length) {
      if (line[k] === "(") depth += 1;
      else if (line[k] === ")") depth -= 1;
      if (depth === 0) break;
      k += 1;
    }
    if (depth !== 0) {
      i = j + 1; // 到行尾深度仍未归零：未闭合，不是链接
      continue;
    }
    const open = ls + i;
    const urlStart = ls + j + 2;
    const close = ls + k;
    // 命中判定两种模式分开写：
    // 无选区取严格开区间（open < selStart <= close）——⌶[a](b) 与 [a](b)⌶ 都不命中，
    //   紧贴链接两侧按 Ctrl+K 是想在旁边插新链接，不是编辑这一条。
    // 有选区取闭区间（open <= selStart && selEnd <= close+1）——允许"恰好选中整条链接"。
    // 空 URL "[文本]()" 算命中：这正是 case ⑤/⑦ 刚生成的形态，命中后光标落进空括号，
    // "打标题→跳去填地址" 因此成为一条连招（K13/K14）。
    const hit = selStart === selEnd ? selStart > open && selStart <= close : selStart >= open && selEnd <= close + 1;
    if (hit) return { urlStart, urlEnd: close };
    i = k + 1; // 不命中：跳过整条链接，继续找同行下一条（K26 同行多链接）
  }
  return null;
}

/**
 * 协议白名单判定：只认 http/https。判定专用——只用 `new URL()` 抛不抛 / protocol 是什么，
 * 绝不使用它的 `.href` 输出（会做归一：加斜杠、中文域名转 punycode、空格转 %20）。
 */
function isHttpUrl(text: string): boolean {
  // 含空白一律不当 URL，两个作用：① 挡掉 "https://a.com/a b" 这种含空格文本——new URL 会接受
  //   并把空格编码成 %20，但原文含空格的 markdown 链接在多数渲染器里是断的，生成即坏链接；
  // ② 二道保险：WHATWG URL 解析器会先剥掉字符串里所有 tab/LF/CR 再解析（"a\nb" 不抛），
  //   即使调用方不慎把这条判定挪到了"选区含换行"检查之前，这里也会先一步把换行选区挡下，
  //   不会被误判成 URL、生成把两行硬粘起来的错链接。
  if (text === "" || /\s/.test(text)) return false;
  let u: URL;
  try {
    u = new URL(text);
  } catch {
    return false;
  }
  return u.protocol === "http:" || u.protocol === "https:";
}

/**
 * Ctrl+K 补 markdown 链接。
 * @param value 完整文本
 * @param selStart 选区起点（光标或选区左端）
 * @param selEnd 选区终点（光标或选区右端）
 * @returns 六态：
 *   `null`               = 不处理，不 preventDefault，交还浏览器（代码围栏 / front-matter 内）；
 *   `{ kind: "noop" }`    = 吃掉按键但不改任何东西（选区 trim 后仍含换行）；
 *   `{ kind: "select" }`  = 只挪光标去 URL 段，不走 execCommand、不置 dirty（已落在既有链接上）；
 *   `{ kind: "replace" }` = 插入链接骨架（无选区 / URL 选区 / 普通文字选区三种落点不同）。
 *
 * IME 组合态守卫在调用方 `handleKeyDown` 顶部与 Tab/Enter 共用同一处判断，本函数不重复判断
 * （§0.3 / indent.ts 同款约定）。
 *
 * 执行顺序与 design §4.4 的表格顺序不同，是本函数最要命的一条（§2.1）：代码围栏/front-matter
 * 守卫必须最先做；"选区含换行→noop" 必须早于"选区是 URL"判定——WHATWG URL 解析器会先剥掉
 * 字符串里的 tab/LF/CR 再解析，跨行选区若先过 URL 判定会被误判成合法 URL，生成把两行硬粘
 * 起来的错链接，而且看起来"成功了"。
 */
export function applyLinkShortcut(value: string, selStart: number, selEnd: number): EditAction | null {
  const lines = splitLines(value);
  const prot = scanProtected(lines); // 代码围栏 / front-matter：直接复用，不另写扫描器（G4）

  // case ②：代码围栏 / front-matter 内一律放行。selStart/selEnd 可能落在不同行（如选区跨越
  // 保护区边界），任一端落在保护区内就整体放行——宁可功能不生效，不可在受保护区里插入内容。
  const startLine = lineIndexAt(lines, selStart);
  const endLine = lineIndexAt(lines, selEnd);
  if (prot[startLine] || prot[endLine]) return null;

  const raw = value.slice(selStart, selEnd);

  // case ③：选区 trim 后仍含换行 → 吃掉按键但不改动。必须早于 case ⑥ 的 URL 判定（见上方
  // 函数级注释 / isHttpUrl 内的 /\s/ 二道保险），否则跨行选区会被误判成 URL。
  if (selStart !== selEnd && raw.trim().includes("\n")) return { kind: "noop" };

  // case ④：光标/选区落在已有 [文本](URL) 上 → 只挪光标到 URL 段，不改文本、不置 dirty
  // （select 不走 execCommand，用户只是想改地址，一个字没改不该变脏、不该多一条撤销条目）。
  const hit = findLinkAt(value, selStart, selEnd);
  if (hit) return { kind: "select", selStart: hit.urlStart, selEnd: hit.urlEnd };

  const lead = raw.length - raw.trimStart().length;
  const body = raw.trim();

  // case ⑤：无选区 / 全空白选区 → 插入 "[]()"，光标落在方括号之间。插入点用 selStart 而非
  // "selStart + lead"：全空白选区时不能动用户已有的任何一个空白字符（K20）。
  if (body === "") {
    return {
      kind: "replace",
      start: selStart,
      end: selStart,
      text: "[]()",
      selStart: selStart + 1,
      selEnd: selStart + 1,
    };
  }

  const s = selStart + lead;
  const e = s + body.length; // 两端空白留在链接外面，与 case ⑦ 用同一套 s/e

  // case ⑥：trim 后是 http/https URL → 把 URL 塞进圆括号，光标落进方括号等待填标题。
  // 输出用原文 trim 后的字符串（body），绝不用 new URL().href——见 isHttpUrl 上方注释。
  if (isHttpUrl(body)) {
    return { kind: "replace", start: s, end: e, text: `[](${body})`, selStart: s + 1, selEnd: s + 1 };
  }

  // case ⑦：其余情况——把选中文字包进方括号，光标落进圆括号等待填地址。
  const cursor = s + body.length + 3; // "[" + body + "]" + "(" 共 body.length+3 个字符
  return { kind: "replace", start: s, end: e, text: `[${body}]()`, selStart: cursor, selEnd: cursor };
}
