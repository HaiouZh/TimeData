import { Component, type ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { looksLikeMarkdown } from "./looksLikeMarkdown.ts";

class MarkdownBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

const components = {
  p: ({ node: _node, ...props }) => <p {...props} className="my-1 first:mt-0 last:mb-0" />,
  h1: ({ children }) => <p className="mb-1 mt-2 font-bold">{children}</p>,
  h2: ({ children }) => <p className="mb-1 mt-2 font-semibold">{children}</p>,
  h3: ({ children }) => <p className="mb-1 mt-2 font-medium">{children}</p>,
  ul: ({ node: _node, ...props }) => <ul {...props} className="my-1 ml-4 list-disc space-y-0.5" />,
  // 外侧序号落在 ol 的左缩进里，而 NoteBubble 外层 overflow-hidden 会裁掉缩进外的部分：
  // 缩进按最大序号的位数给（ch = 数字宽，另 1.5ch 容纳「. 」），固定 ml-4 会把「10.」裁成「0.」。
  ol: ({ node, ...props }) => {
    const itemCount = node?.children.filter((child) => child.type === "element" && child.tagName === "li").length ?? 0;
    const lastNumber = (props.start ?? 1) + Math.max(itemCount, 1) - 1;
    return (
      <ol
        {...props}
        className="my-1 list-decimal space-y-0.5"
        style={{ marginInlineStart: `${String(Math.max(lastNumber, 0)).length + 1.5}ch` }}
      />
    );
  },
  blockquote: ({ node: _node, ...props }) => (
    <blockquote {...props} className="my-1 border-l-2 border-border-strong pl-3 text-ink-2" />
  ),
  a: ({ node: _node, children, ...props }) => (
    <a
      {...props}
      className="text-accent underline underline-offset-2"
      target="_blank"
      rel="noreferrer"
    >
      {children}
    </a>
  ),
  // 代码块与表格能横滚，给 iOS 边缘返回让路（EdgeSwipeBack 只认这个显式标记）。
  pre: ({ node: _node, ...props }) => (
    <pre
      {...props}
      data-edge-swipe-block=""
      className="my-1 overflow-x-auto rounded-ctl bg-page/70 p-3 td-text-label"
    />
  ),
  code: ({ node: _node, children, className, ...props }) => {
    const isBlock = String(children).includes("\n") || /language-/.test(className ?? "");
    return isBlock ? (
      <code {...props} className={className}>
        {children}
      </code>
    ) : (
      <code {...props} className="rounded bg-surface-elevated px-1 py-0.5 td-text-label">
        {children}
      </code>
    );
  },
  table: ({ node: _node, ...props }) => (
    <div data-edge-swipe-block="" className="my-1 overflow-x-auto">
      <table {...props} className="border-collapse" />
    </div>
  ),
  th: ({ node: _node, ...props }) => <th {...props} className="border border-border px-2 py-1 text-left" />,
  td: ({ node: _node, ...props }) => <td {...props} className="border border-border px-2 py-1" />,
} satisfies Components;

// 字号只由 Markdown 根节点给、标题与表格一律继承：日记参考栏复用本组件时整体小一档（td-text-label）。
export default function QuickNoteContent({
  text,
  trailing,
  textClassName = "td-text-body",
}: {
  text: string;
  trailing?: ReactNode;
  textClassName?: string;
}) {
  const plain = (
    <span className="whitespace-pre-wrap break-words">
      {text}
      {trailing}
    </span>
  );
  if (!looksLikeMarkdown(text)) return plain;

  return (
    <MarkdownBoundary fallback={plain}>
      <div className={`${textClassName} break-words`}>
        <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} components={components}>
          {text}
        </Markdown>
      </div>
    </MarkdownBoundary>
  );
}
