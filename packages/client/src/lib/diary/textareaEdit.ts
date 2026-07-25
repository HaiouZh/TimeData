/**
 * textarea 程序化编辑的**唯一**出口。
 *
 * 为什么必须走 document.execCommand("insertText") 而不是 setState：
 * React 受控 textarea 用 setState 写回时，react-dom 执行 `element.value = value` 整体赋值，
 * 浏览器原生撤销栈当场清空（Ctrl+Z 撤不回、甚至会撤掉更早内容）。execCommand 是目前唯一
 * 能保留原生撤销栈的程序化编辑手段——MDN 标记 deprecated 但明说"没有可行替代方案，这些场景
 * 可继续使用"；setRangeText 同样会清栈。
 *
 * 为什么这样就不会被 React 重新毁掉（已核实 react-dom@19.2.7）：
 * `updateTextarea`（cjs/react-dom-client.development.js:1842）写回带守卫
 *   value !== element.value && (element.value = value)
 * execCommand 改完 DOM 后，onChange 把同一个字符串灌回 state，重渲染与受控还原
 * （restoreStateOfTarget:3178 → 同一个 updateTextarea）两条路径都短路，一次都不写。
 * 从 React 的视角，这条路径与用户普通打字完全同构。
 *
 * ⚠️ 红线：onChange 里绝不能对 value 做任何加工（trim / 行尾转换 / 任何归一化）。
 * 一加工守卫就不成立，React 整体回写，撤销栈立刻又没了——而且这种坏法**静默**。
 * 机检覆盖两层：textareaEdit.test.tsx 里的「React 零回写计数器」护栏守的是测试文件内部的
 * 等价 Probe 组件；`pages/DiaryPage.successPath.test.tsx`（真实 execCommand + 同一计数器
 * 手法）接的是 DiaryPage.tsx 本体的 onChange——谁在那里加归一化，这条测试当场变红（实测过：
 * 加一个 .trimEnd() 就红）。两条护栏测试都别删。
 */

export type EditAction =
  | { kind: "replace"; start: number; end: number; text: string; selStart: number; selEnd: number }
  | { kind: "select"; selStart: number; selEnd: number }
  | { kind: "noop" };

/**
 * kind: "applied" = execCommand 真改了值；"selection-only" = 退化的 replace（零宽区间 + 空串，
 * 即文本零改动）在 applyEdit 内部被判定为纯挪光标，直接早退，完全不碰 execCommand。
 *
 * 别把这个 "selection-only" 与 EditAction 的 kind:"select" 混为一谈：后者是纯函数层的返回
 * 变体（调用方本来就只想挪光标，压根没产出 replace）；前者是 applyEdit 对一个"形状上是
 * replace、但退化成零改动"的输入做的兜底判定，两者出现在不同的层。
 */
export type ApplyResult =
  | { ok: true; kind: "applied" | "selection-only" }
  | { ok: false; kind: "unsupported" | "rejected"; fallbackValue: string };

/** 编辑描述符 → 整篇新文本。成功判据 / 降级路径 / 单测三处共用，避免两处真相源。 */
export function previewEdit(value: string, edit: Extract<EditAction, { kind: "replace" }>): string {
  return value.slice(0, edit.start) + edit.text + value.slice(edit.end);
}

export function applyEdit(field: HTMLTextAreaElement, edit: Extract<EditAction, { kind: "replace" }>): ApplyResult {
  const { start, end, text, selStart, selEnd } = edit;

  // 退化的 replace（零宽区间 + 空串 = 文本零改动）必须在这里就早退。
  // 放它往下走会落进 execCommand("delete")，而 delete 在光标折叠时语义是**退格**：
  // 先真删掉前一个字符并压一条真删除进撤销栈，接着降级路径整体回写救回文本 —— 撤销栈当场清空。
  // 光靠调用方约定守不住：任何生产者都可能产出这个形状，闸必须在这一层。
  if (start === end && text === "") {
    field.setSelectionRange(selStart, selEnd);
    return { ok: true, kind: "selection-only" };
  }

  // 降级文本**必须在这里**算好：execCommand 失败时可能已经部分应用，事后再拿
  // field.value 去算就是基于污染值算的。这也是本函数不能只返回 boolean 的原因。
  const fallbackValue = previewEdit(field.value, edit);

  const doc = field.ownerDocument;
  // 存在性探测，不是"调用后看返回值"——jsdom 里 execCommand 属性根本不存在，
  // 调用即抛 TypeError，那不是优雅降级是测试当场崩。
  if (typeof doc.execCommand !== "function") return { ok: false, kind: "unsupported", fallbackValue };

  const scrollTop = field.scrollTop;

  // execCommand 作用于**文档当前聚焦元素**，不看参数。keydown 路径下这行是 no-op，
  // 但将来工具条按钮走这条路时焦点在按钮上，不 focus 会把字插到别处。
  if (doc.activeElement !== field) field.focus({ preventScroll: true });

  // "backward" 把选区的 focus 端钉在 start：Gecko 的 setSelectionRange 总是滚到 focus 端，
  // 而重排的区间是"光标 → 块尾"，用默认 forward 会把视口甩到块尾。
  field.setSelectionRange(start, end, "backward");

  try {
    if (text === "") {
      // 空串必须走 delete：execCommand("insertText", …, "") 在实现间不一致
      // （Firefox 55 前抛异常）。走到这里 start < end 恒成立——零宽 + 空串的退化形态已经在
      // 函数开头早退，不会落进来——所以这里的 delete 语义是"删掉 [start,end) 选区"，不是退格。
      doc.execCommand("delete");
    } else {
      doc.execCommand("insertText", false, text);
    }
  } catch {
    return { ok: false, kind: "rejected", fallbackValue };
  }

  // 成功判据看结果不看返回值：Chrome 对 insertText 常返回 true 却什么也没做，
  // 某些实现返回 false 但已经改了值。
  if (field.value !== fallbackValue) return { ok: false, kind: "rejected", fallbackValue };

  field.scrollTop = scrollTop; // 先抹掉中间那次选区跳动
  field.setSelectionRange(selStart, selEnd); // 再定光标，让浏览器"露出光标"有最后发言权
  return { ok: true, kind: "applied" };
}

/**
 * 把纯函数产出的 EditAction 落到 textarea 上。调用方只管调这一个。
 *
 * dirty 记账（四条路径缺一不可）：
 *   replace + 成功 → onChange 置（execCommand 发的真 input 事件会触发它）
 *   replace + 降级 → **这里显式 markDirty()**，因为 setValue 不经 onChange，漏了保存按钮永不亮
 *   select / noop  → 不置（用户一个字没改，不该变脏）
 *
 * 调用约定（后续任务共用）：纯函数返回 null 表示"不管这个按键"——调用方**不**
 * preventDefault，交还浏览器默认行为；返回 { kind: "noop" } 表示"吃掉这个按键"
 * （调用方**要** preventDefault）但不改任何东西。两者传进这里都不会碰 setValue / markDirty，
 * 差别只在按键本身要不要被浏览器继续处理，那一层判断在调用方，不在 runEditAction 内部。
 */
export function runEditAction(
  field: HTMLTextAreaElement,
  action: EditAction,
  setValue: (next: string) => void,
  markDirty: () => void,
): void {
  if (action.kind === "noop") return;
  if (action.kind === "select") {
    field.setSelectionRange(action.selStart, action.selEnd);
    return;
  }
  const result = applyEdit(field, action);
  if (result.ok) return;
  setValue(result.fallbackValue);
  markDirty();
  // 与本模块其余逻辑一致，走 field.ownerDocument 而非裸的全局 window。理论上元素既然已经
  // 挂在 document 上就一定有 defaultView，这里的全局兜底纯粹是防御性的：宁可退化到全局
  // rAF 也要把光标恢复这一步做完，不为拿不到 view 就整段跳过。
  const view = field.ownerDocument.defaultView;
  if (view) {
    view.requestAnimationFrame(() => field.setSelectionRange(action.selStart, action.selEnd));
  } else {
    requestAnimationFrame(() => field.setSelectionRange(action.selStart, action.selEnd));
  }
}
