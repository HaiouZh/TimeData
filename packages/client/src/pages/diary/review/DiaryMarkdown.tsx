// 回顾页只读 Markdown 渲染：react-markdown + remark-gfm，wikilink 图片经
// 附件接口（GET /api/diary/asset?path=）取回 blob 展示；不跳外链，不渲染原始 HTML。
import { useEffect, useState } from "react";
import Markdown, { type Components, type UrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { getApiBase, getToken } from "../../../lib/api.js";
import { preprocessDiaryMarkdown } from "../../../lib/diary/reviewMarkdown.js";

// 预处理阶段自造的 scheme 前缀，标记「这是 vault 相对路径的图片」。
const TD_ASSET_SCHEME = "td-asset:";

// 把预处理产物里的图片 src 转成附件接口的绝对路径；http(s)/data 原样放行。
function toAssetUrl(relPath: string): string {
  return `${getApiBase()}/api/diary/asset?path=${encodeURIComponent(relPath)}`;
}

const urlTransform: UrlTransform = (url) => {
  if (url.startsWith(TD_ASSET_SCHEME)) {
    return toAssetUrl(url.slice(TD_ASSET_SCHEME.length));
  }
  if (/^(https?:|data:)/i.test(url)) {
    return url;
  }
  // 其余相对路径（未经 wikilink 预处理产出的裸 markdown 图片语法）同样当 vault 相对路径处理。
  return toAssetUrl(url);
};

// 鉴权图片：<img src> 直连附件接口会 401，需自行 fetch 带 Authorization 头拿 blob 再转 objectURL。
function DiaryImage({ src, alt }: { src?: string; alt?: string }) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setObjectUrl(null);
    setFailed(false);
    if (!src) return;

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
  }, [src]);

  if (failed || !src) {
    return <span className="text-ink-2">{alt || "[图片加载失败]"}</span>;
  }
  if (!objectUrl) {
    return <span className="text-ink-2">{alt || "加载中…"}</span>;
  }
  return <img src={objectUrl} alt={alt ?? ""} className="max-w-full rounded-ctl" />;
}

const components = {
  img: ({ src, alt }) => <DiaryImage src={typeof src === "string" ? src : undefined} alt={alt} />,
  // 回顾页只读，不跳外链：链接一律降级为纯文本。
  a: ({ children }) => <span>{children}</span>,
} satisfies Components;

export default function DiaryMarkdown({ content }: { content: string }) {
  const preprocessed = preprocessDiaryMarkdown(content);
  return (
    <div className="text-[15px] leading-relaxed">
      <Markdown remarkPlugins={[remarkGfm]} urlTransform={urlTransform} components={components}>
        {preprocessed}
      </Markdown>
    </div>
  );
}
