// 日记回顾页只读渲染的预处理：把 Obsidian 风格的 wikilink 语法转换成
// react-markdown 认识的标准语法，或者干脆降级为纯文本。
//
// 只认 spec 白名单的图片扩展名，绝不对裸文件名做贪婪嗅探——正文里出现的
// `a.png` 这类普通文字不应被当成嵌入图片。

// 图片扩展名白名单（大小写不敏感）。
const IMAGE_EXT = "jpg|jpeg|png|gif|webp|svg";

// ① 图片 wikilink：![[img.png]] / ![[img.png|alt]] → ![alt](td-asset:img.png)
//    用自造的 td-asset: scheme 包一层，防止 react-markdown 把相对路径当成站内链接处理。
const IMAGE_EMBED_RE = new RegExp(`!\\[\\[([^\\]|]+\\.(?:${IMAGE_EXT}))(?:\\|([^\\]]*))?\\]\\]`, "gi");

// ② 非图片嵌入：![[笔记.md]] → 纯文本（取别名或原名）。
const NON_IMAGE_EMBED_RE = /!\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g;

// ③ 普通内部链接：[[页面]] / [[页面|别名]] → 纯文本（取别名或原名）。
const WIKILINK_RE = /\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g;

export function preprocessDiaryMarkdown(content: string): string {
  let result = content.replace(IMAGE_EMBED_RE, (_match, path: string, alias: string | undefined) => {
    return `![${alias ?? ""}](td-asset:${path})`;
  });

  result = result.replace(NON_IMAGE_EMBED_RE, (_match, path: string, alias: string | undefined) => {
    return alias ?? path;
  });

  result = result.replace(WIKILINK_RE, (_match, path: string, alias: string | undefined) => {
    return alias ?? path;
  });

  return result;
}
