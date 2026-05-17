#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { runCategories } from "./commands/categories.js";
import { runDoctor } from "./commands/doctor.js";
import { commandRegistry, runHelp } from "./commands/help.js";
import { runList } from "./commands/list.js";
import { runLog } from "./commands/log.js";
import { runVersion } from "./commands/version.js";
import { parseFlags } from "./lib/args.js";
import { readFileConfig, resolveConfig, type FileConfigResult } from "./lib/config.js";
import { formatResult, resolveOutputFormat } from "./lib/format.js";

export const dispatchCommandNames = commandRegistry
  .map((command) => command.name)
  .filter((name) => !["help", "version"].includes(name));

interface CliDeps {
  env?: Record<string, string | undefined>;
  fileConfig?: FileConfigResult;
  fetchImpl?: typeof fetch;
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

  if (command === "version") return runVersion(deps.env || process.env);

  if (!commandRegistry.some((item) => item.name === command)) {
    return {
      ok: false,
      error: {
        code: "UNKNOWN_COMMAND",
        message: `Unknown command: ${command}`,
      },
    };
  }

  const fileConfig = deps.fileConfig === undefined ? readFileConfig() : deps.fileConfig;

  if (command === "doctor") {
    return runDoctor(flags, deps.env || process.env, fileConfig, deps.fetchImpl);
  }

  const config = resolveConfig(flags, deps.env || process.env, fileConfig);
  if ("ok" in config) return config;

  if (command === "categories") return runCategories(config, deps.fetchImpl);
  if (command === "list") return runList(config, flags, deps.fetchImpl);
  if (command === "log") return runLog(config, flags, deps.fetchImpl);

  return runHelp(command);
}

function isDirectExecution(): boolean {
  return Boolean(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href);
}

if (isDirectExecution()) {
  const argv = process.argv.slice(2);
  const flags = parseFlags(argv.filter((arg) => arg.startsWith("--")));
  const format = resolveOutputFormat({ isTTY: Boolean(process.stdout.isTTY), format: flags.format });

  runCli(argv).then((result) => {
    const ok = Boolean(result && typeof result === "object" && "ok" in result && result.ok === true);
    console.log(formatResult(result, format));
    process.exit(ok ? 0 : 1);
  });
}
