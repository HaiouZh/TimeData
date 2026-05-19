import { AppLauncher } from "@capacitor/app-launcher";
import { Browser } from "@capacitor/browser";

export interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
}

export interface GitHubRelease {
  tag_name: string;
  html_url: string;
  assets: GitHubReleaseAsset[];
}

function isGitHubReleaseAsset(value: unknown): value is GitHubReleaseAsset {
  return Boolean(
    value &&
      typeof value === "object" &&
      "name" in value &&
      typeof value.name === "string" &&
      "browser_download_url" in value &&
      typeof value.browser_download_url === "string",
  );
}

function isGitHubRelease(value: unknown): value is GitHubRelease {
  return Boolean(
    value &&
      typeof value === "object" &&
      "tag_name" in value &&
      typeof value.tag_name === "string" &&
      "html_url" in value &&
      typeof value.html_url === "string" &&
      "assets" in value &&
      Array.isArray(value.assets) &&
      value.assets.every(isGitHubReleaseAsset),
  );
}

export interface AndroidApkUpdate {
  versionCode: string;
  pageUrl: string;
  apkName: string;
  apkUrl: string;
  hasUpdate: boolean;
}

export function getAndroidVersionCodeFromReleaseTag(tagName: string): string | null {
  const match = tagName.match(/^(?:android-|v)?(\d{8})$/);
  return match?.[1] ?? null;
}

export function getAndroidApkUpdateFromRelease(
  release: GitHubRelease,
  currentVersionCode: string,
): AndroidApkUpdate | null {
  const versionCode = getAndroidVersionCodeFromReleaseTag(release.tag_name);
  if (!versionCode) return null;

  const apk = release.assets.find((asset) => asset.name.toLowerCase().endsWith(".apk"));
  if (!apk) return null;

  return {
    versionCode,
    pageUrl: release.html_url,
    apkName: apk.name,
    apkUrl: apk.browser_download_url,
    hasUpdate: Number(versionCode) > Number(currentVersionCode),
  };
}

export type AndroidApkUpdateOpener = (url: string) => Promise<void> | void;

export function getAndroidApkUpdateUrl(update: AndroidApkUpdate): string {
  // 故意返回 Release 页（HTML）而不是 .apk 直链：Android Intent.ACTION_VIEW
  // 收到 .apk URL 时浏览器通常静默甩给下载管理器，部分机型 / 浏览器组合下
  // 表现为"选了浏览器但什么都没发生"。Release 页是普通 HTML，任何浏览器都能
  // 正常渲染，用户在页面上点 APK 资产开始下载，链路确定性最强。
  return update.pageUrl;
}

export async function openAndroidApkUpdate(
  update: AndroidApkUpdate,
  opener: AndroidApkUpdateOpener = openExternalUrl,
): Promise<void> {
  await opener(getAndroidApkUpdateUrl(update));
}

async function openExternalUrl(url: string): Promise<void> {
  // AppLauncher.openUrl 不抛错，靠返回的 completed 字段判断是否真的派发出去；
  // completed=false（多见于 Android 11+ 包可见性未配置、URL 没人接）时落到
  // Browser.open（Chrome Custom Tabs），最后 window.open 兜底非原生环境。
  try {
    const result = await AppLauncher.openUrl({ url });
    if (result.completed) return;
  } catch {
    // AppLauncher 抛错（如插件未注册），继续 fallback
  }
  try {
    await Browser.open({ url });
    return;
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

export async function fetchAndroidApkUpdate(currentVersionCode: string): Promise<AndroidApkUpdate | null> {
  const res = await fetch("https://api.github.com/repos/HaiouZh/TimeData/releases/latest", {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub Release 检查失败：${res.status}`);

  const release = await res.json();
  if (!isGitHubRelease(release)) throw new Error("GitHub Release 响应格式无效");
  return getAndroidApkUpdateFromRelease(release, currentVersionCode);
}
