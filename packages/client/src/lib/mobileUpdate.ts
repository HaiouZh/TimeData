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

export function getAndroidApkUpdateFromRelease(release: GitHubRelease, currentVersionCode: string): AndroidApkUpdate | null {
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
  return update.pageUrl;
}

export async function openAndroidApkUpdate(update: AndroidApkUpdate, opener: AndroidApkUpdateOpener = openExternalUrl): Promise<void> {
  await opener(getAndroidApkUpdateUrl(update));
}

async function openExternalUrl(url: string): Promise<void> {
  try {
    await Browser.open({ url });
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

  return getAndroidApkUpdateFromRelease(await res.json() as GitHubRelease, currentVersionCode);
}
