/** 复制文本到剪贴板。优先 navigator.clipboard，失败兜底隐藏 textarea。 */
export async function copyText(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // 某些 WebView 会暴露 clipboard 但拒绝写入；继续走 DOM 兜底。
    }
  }

  if (typeof document === "undefined") throw new Error("剪贴板不可用");

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    const copied = document.execCommand("copy");
    if (!copied) throw new Error("复制失败");
  } finally {
    document.body.removeChild(textarea);
  }
}
