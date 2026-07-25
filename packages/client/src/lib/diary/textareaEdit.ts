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
 * 唯一的机检形式是 textareaEdit.test.tsx 里那条「React 零回写计数器」护栏测试，别删它。
 */

export type EditAction =
  | { kind: "replace"; start: number; end: number; text: string; selStart: number; selEnd: number }
  | { kind: "select"; selStart: number; selEnd: number }
  | { kind: "noop" };

export type ApplyResult =
  | { ok: true; kind: "applied" }
  | { ok: false; kind: "unsupported" | "rejected"; fallbackValue: string };

/** 编辑描述符 → 整篇新文本。成功判据 / 降级路径 / 单测三处共用，避免两处真相源。 */
export function previewEdit(value: string, edit: Extract<EditAction, { kind: "replace" }>): string {
  return value.slice(0, edit.start) + edit.text + value.slice(edit.end);
}

export function applyEdit(field: HTMLTextAreaElement, edit: Extract<EditAction, { kind: "replace" }>): ApplyResult {
  const { start, end, text, selStart, selEnd } = edit;

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
      // （Firefox 55 前抛异常）。而 delete 在**光标折叠**时语义是退格、会吃掉前一个字符，
      // 所以 start === end 的情形绝不能落到这里——那种情况由 runEditAction 的 select 变体接走。
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
  requestAnimationFrame(() => field.setSelectionRange(action.selStart, action.selEnd));
}
