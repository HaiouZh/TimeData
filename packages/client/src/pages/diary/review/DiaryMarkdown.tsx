// 回顾页只读 Markdown 渲染：react-markdown + remark-gfm，wikilink 图片经
// 附件接口（GET /api/diary/asset?path=）取回 blob 展示；不跳外链，不渲染原始 HTML。
import { useEffect, useState } from "react";
import Markdown, { type Components, type UrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { getApiBase, getToken } from "../../../lib/api.js";
import { encodeAssetPath, preprocessDiaryMarkdown } from "../../../lib/diary/reviewMarkdown.js";

// 预处理阶段自造的 scheme 前缀，标记「这是 vault 相对路径的图片」。
const TD_ASSET_SCHEME = "td-asset:";

/** 站内附件接口前缀，同时用于「该不该带 Authorization」的判定。 */
export function assetEndpointPrefix(): string {
  return `${getApiBase()}/api/diary/asset?path=`;
}

// 把预处理产物里的图片 src 转成附件接口的绝对路径。encodedPath 必须已逐段 encodeURIComponent
//（`/` 保留原样，它在 query value 里合法），否则含空格/井号的附件名会丢图。
function assetUrl(encodedPath: string): string {
  return `${assetEndpointPrefix()}${encodedPath}`;
}

const urlTransform: UrlTransform = (url) => {
  if (url.startsWith(TD_ASSET_SCHEME)) {
    return assetUrl(url.slice(TD_ASSET_SCHEME.length));
  }
  // 外链：原样保留，由 <img src> 直连，绝不带 Authorization（见 DiaryImage）。
  if (/^https?:\/\//i.test(url)) return url;
  // 其余带 scheme 的（data:/javascript:/blob: …）一律不放行：它们绕开附件接口的全部校验，
  // 且回顾页只该显示 vault 内的图片。返回空串 → DiaryImage 降级为文件名/alt 占位。
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return "";
  // 裸相对路径（未经 wikilink 预处理产出的标准 markdown 图片语法）同样当 vault 相对路径处理。
  return assetUrl(encodeAssetPath(url));
};

// 鉴权图片：<img src> 直连附件接口会 401，需自行 fetch 带 Authorization 头拿 blob 再转 objectURL。
// 只有「确认指向本站附件接口」的 src 才走这条带凭据的路径——外链一律普通 <img>，
// 否则 vault 里任意一张外链图片就能把 master token 送到第三方服务器。
function DiaryImage({ src, alt }: { src?: string; alt?: string }) {
  const isSiteAsset = Boolean(src?.startsWith(assetEndpointPrefix()));
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setObjectUrl(null);
    setFailed(false);
    if (!src || !isSiteAsset) return;

    let cancelled = false;
    let createdUrl: string | null = null;

    const token = getToken();
    fetch(src, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((res) => {
        if (!res.ok) throw new Error(`asset fetch failed: ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        createdUrl = URL.createObjectURL(blob);
        setObjectUrl(createdUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [src, isSiteAsset]);

  if (!src) {
    return <span className="text-ink-2">{alt || "[图片加载失败]"}</span>;
  }
  if (!isSiteAsset) {
    // 外链图片：不带任何请求头，浏览器按普通图片加载。
    return <img src={src} alt={alt ?? ""} className="max-w-full rounded-ctl" />;
  }
  if (failed) {
    return <span className="text-ink-2">{alt || "[图片加载失败]"}</span>;
  }
  if (!objectUrl) {
    return <span className="text-ink-2">{alt || "加载中…"}</span>;
  }
  return <img src={objectUrl} alt={alt ?? ""} className="max-w-full rounded-ctl" />;
}

// Tailwind preflight 会把 h1-h6 的字号/字重、ul/ol 的项目符号全部清零，
// 不逐元素给类名的话 `# 标题`/`- 列表` 解析出来了也长得跟正文一模一样（用户报的「不渲染 md」即此）。
const components = {
  img: ({ src, alt }) => <DiaryImage src={typeof src === "string" ? src : undefined} alt={alt} />,
  // 回顾页只读，不跳外链：链接一律降级为纯文本。
  a: ({ children }) => <span>{children}</span>,
  p: ({ children }) => <p className="my-1 first:mt-0 last:mb-0">{children}</p>,
  h1: ({ children }) => <h1 className="mb-1 mt-2 td-text-title first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-1 mt-2 td-text-body font-semibold first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1 mt-2 td-text-body font-semibold first:mt-0">{children}</h3>,
  h4: ({ children }) => <h4 className="mb-1 mt-2 td-text-label font-semibold first:mt-0">{children}</h4>,
  h5: ({ children }) => <h5 className="mb-1 mt-2 td-text-label font-semibold first:mt-0">{children}</h5>,
  h6: ({ children }) => <h6 className="mb-1 mt-2 td-text-caption font-semibold first:mt-0">{children}</h6>,
  strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  ul: ({ children }) => <ul className="my-1 ml-4 list-disc space-y-0.5">{children}</ul>,
  ol: ({ children }) => <ol className="my-1 ml-4 list-decimal space-y-0.5">{children}</ol>,
  li: ({ children }) => <li className="marker:text-ink-3">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-1 border-l-2 border-border-strong pl-3 text-ink-2">{children}</blockquote>
  ),
  hr: () => <hr className="my-2 border-border" />,
  pre: ({ children }) => (
    <pre className="my-1 overflow-x-auto rounded-ctl bg-page/70 p-3 td-text-caption">{children}</pre>
  ),
  code: ({ children, className }) => {
    const isBlock = String(children).includes("\n") || /language-/.test(className ?? "");
    return isBlock ? (
      <code className={className}>{children}</code>
    ) : (
      <code className="rounded bg-surface-elevated px-1 py-0.5 td-text-caption">{children}</code>
    );
  },
  table: ({ children }) => (
    <div className="my-1 overflow-x-auto">
      <table className="border-collapse td-text-caption">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border border-border px-2 py-1 text-left font-semibold">{children}</th>,
  td: ({ children }) => <td className="border border-border px-2 py-1">{children}</td>,
} satisfies Components;

export default function DiaryMarkdown({ content }: { content: string }) {
  const preprocessed = preprocessDiaryMarkdown(content);
  return (
    <div className="td-text-body">
      <Markdown remarkPlugins={[remarkGfm]} urlTransform={urlTransform} components={components}>
        {preprocessed}
      </Markdown>
    </div>
  );
}
