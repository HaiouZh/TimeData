export function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) continue;

    const eqIdx = arg.indexOf("=");
    if (eqIdx > 2) {
      flags[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
      continue;
    }

    const key = arg.slice(2);
    const value = args[i + 1];
    if (!value || value.startsWith("--")) {
      flags[key] = "true";
    } else {
      flags[key] = value;
      i++;
    }
  }
  return flags;
}
