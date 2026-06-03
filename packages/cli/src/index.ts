#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { commandRegistry, runHelp } from "./commands/help.js";
import { parseFlags } from "./lib/args.js";
import { type FileConfigResult, readFileConfig, resolveConfig } from "./lib/config.js";
import { formatResult, resolveOutputFormat } from "./lib/format.js";

export const dispatchCommandNames = commandRegistry
  .filter((command) => command.handler)
  .map((command) => command.name);

interface CliDeps {
  env?: Record<string, string | undefined>;
  fileConfig?: FileConfigResult;
  fetchImpl?: typeof fetch;
}

interface RunFromArgvDeps {
  isTTY?: boolean;
  writeStdout?: (text: string) => void;
  writeStderr?: (text: string) => void;
  exit?: (code: number) => void;
}

export async function runCli(argv: string[], deps: CliDeps = {}): Promise<unknown> {
  const first = argv[0];
  const isFlagOnly = !first || first.startsWith("--");
  let command = isFlagOnly ? "help" : first;
  const rest = isFlagOnly ? argv : argv.slice(1);
  const flags = parseFlags(rest);

  // `--version` is an alias for the `version` command, mirroring the convention
  // most CLI tools follow.
  if (isFlagOnly && (flags.version === "true" || argv.includes("--version"))) {
    command = "version";
  }

  if (command === "help") {
    const topic = rest.find((arg) => !arg.startsWith("--"));
    return runHelp(topic);
  }

  if (flags.help === "true") return runHelp(command);

  const entry = commandRegistry.find((item) => item.name === command);
  if (!entry?.handler) {
    return {
      ok: false,
      error: {
        code: "UNKNOWN_COMMAND",
        message: `Unknown command: ${command}`,
      },
    };
  }

  const env = deps.env || process.env;
  const fileConfig = deps.fileConfig === undefined ? readFileConfig() : deps.fileConfig;
  const needsConfig = !["doctor", "version"].includes(entry.name);
  const config = needsConfig ? resolveConfig(flags, env, fileConfig) : null;
  if (config && "ok" in config) return config;

  return entry.handler({
    config,
    flags,
    env,
    fileConfig,
    fetchImpl: deps.fetchImpl,
  });
}

function isDirectExecution(): boolean {
  return Boolean(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href);
}

export async function runFromArgv(processArgv: string[], deps: RunFromArgvDeps = {}): Promise<void> {
  const argv = processArgv.slice(2);
  const flags = parseFlags(argv);
  const format = resolveOutputFormat({ isTTY: Boolean(deps.isTTY), format: flags.format });

  const result = await runCli(argv);
  const ok = Boolean(result && typeof result === "object" && "ok" in result && result.ok === true);
  const formatted = `${formatResult(result, format)}\n`;
  const writeStdout = deps.writeStdout ?? ((text) => process.stdout.write(text));
  const writeStderr = deps.writeStderr ?? ((text) => process.stderr.write(text));

  if (ok) {
    writeStdout(formatted);
  } else {
    writeStderr(formatted);
  }

  (deps.exit ?? process.exit)(ok ? 0 : 1);
}

if (isDirectExecution()) {
  void runFromArgv(process.argv);
}
