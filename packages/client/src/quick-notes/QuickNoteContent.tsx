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
  h1: ({ children }) => <p className="mb-1 mt-2 text-base font-semibold">{children}</p>,
  h2: ({ children }) => <p className="mb-1 mt-2 text-[15px] font-semibold">{children}</p>,
  h3: ({ children }) => <p className="mb-1 mt-2 text-sm font-semibold">{children}</p>,
  ul: ({ node: _node, ...props }) => <ul {...props} className="my-1 ml-4 list-disc space-y-0.5" />,
  ol: ({ node: _node, ...props }) => <ol {...props} className="my-1 ml-4 list-decimal space-y-0.5" />,
  blockquote: ({ node: _node, ...props }) => (
    <blockquote {...props} className="my-1 border-l-2 border-slate-600 pl-3 text-slate-300" />
  ),
  a: ({ node: _node, children, ...props }) => (
    <a
      {...props}
      className="text-emerald-300 underline underline-offset-2"
      target="_blank"
      rel="noreferrer"
    >
      {children}
    </a>
  ),
  pre: ({ node: _node, ...props }) => (
    <pre {...props} className="my-1 overflow-x-auto rounded-lg bg-slate-950/70 p-3 text-[13px]" />
  ),
  code: ({ node: _node, children, className, ...props }) => {
    const isBlock = String(children).includes("\n") || /language-/.test(className ?? "");
    return isBlock ? (
      <code {...props} className={className}>
        {children}
      </code>
    ) : (
      <code {...props} className="rounded bg-slate-800/80 px-1 py-0.5 text-[13px]">
        {children}
      </code>
    );
  },
  table: ({ node: _node, ...props }) => (
    <div className="my-1 overflow-x-auto">
      <table {...props} className="border-collapse text-sm" />
    </div>
  ),
  th: ({ node: _node, ...props }) => <th {...props} className="border border-slate-700 px-2 py-1 text-left" />,
  td: ({ node: _node, ...props }) => <td {...props} className="border border-slate-700 px-2 py-1" />,
} satisfies Components;

export default function QuickNoteContent({ text, trailing }: { text: string; trailing?: ReactNode }) {
  const plain = (
    <span className="whitespace-pre-wrap break-words">
      {text}
      {trailing}
    </span>
  );
  if (!looksLikeMarkdown(text)) return plain;

  return (
    <MarkdownBoundary fallback={plain}>
      <div className="text-[15px] leading-relaxed">
        <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} components={components}>
          {text}
        </Markdown>
      </div>
    </MarkdownBoundary>
  );
}
