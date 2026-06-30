import type { VersionInfo } from "@timedata/shared";

const CACHE_TTL_MS = 30_000;

let cache: { value: VersionInfo; expiresAt: number } | null = null;

export function _resetCache(): void {
  cache = null;
}

export async function fetchLatestSha(owner: string, repo: string): Promise<string> {
  const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/build.yml/runs?status=success&branch=main&per_page=1`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
    if (process.env.GITHUB_TOKEN) {
      headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    }
    const res = await fetch(url, {
      headers,
      signal: controller.signal,
    });
    if (!res.ok) return "unknown";
    const body = (await res.json()) as { workflow_runs?: Array<{ head_sha: string }> };
    const sha = body.workflow_runs?.[0]?.head_sha;
    return sha ? sha.slice(0, 7) : "unknown";
  } catch {
    return "unknown";
  } finally {
    clearTimeout(timeout);
  }
}

export async function getVersionInfo(opts: { currentSha: string; repo: string; force?: boolean }): Promise<VersionInfo> {
  const now = Date.now();
  if (!opts.force && cache && cache.expiresAt > now) {
    return cache.value;
  }
  const [owner, repo] = opts.repo.split("/");
  const latest = await fetchLatestSha(owner, repo);
  const current = opts.currentSha.slice(0, 7);
  const checkOk = latest !== "unknown";
  const hasUpdate = current !== "dev" && checkOk && current !== latest;
  const info: VersionInfo = {
    current,
    latest,
    hasUpdate,
    checkedAt: new Date(now).toISOString(),
    checkOk,
  };
  cache = { value: info, expiresAt: now + CACHE_TTL_MS };
  return info;
}
