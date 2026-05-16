/**
 * `timedata version` reports the package version baked in at build time plus,
 * when available, the short git sha that produced the build.
 *
 * Both values are loaded from environment variables so the CLI itself does not
 * need to read package.json at runtime (which would require bundling it or
 * resolving paths against the consumer's cwd). `pnpm build` / CI pipelines can
 * inject `TIMEDATA_CLI_VERSION` and `TIMEDATA_CLI_SHA`.
 */
export interface VersionResult {
  ok: true;
  command: "version";
  version: string;
  gitSha: string;
}

export function runVersion(env: Record<string, string | undefined> = process.env): VersionResult {
  return {
    ok: true,
    command: "version",
    version: env.TIMEDATA_CLI_VERSION ?? "0.1.0",
    gitSha: env.TIMEDATA_CLI_SHA ?? "dev",
  };
}
