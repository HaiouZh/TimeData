import { afterEach, describe, expect, it, vi } from "vitest";
import { commandRegistry } from "./commands/help.js";
import { dispatchCommandNames, runCli, runFromArgv } from "./index.js";

describe("runCli", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("has dispatch coverage for registry commands that need runtime handlers", () => {
    const runtimeCommandNames = commandRegistry
      .filter((command) => command.handler)
      .map((command) => command.name);

    expect(dispatchCommandNames).toEqual(runtimeCommandNames);
    expect(runtimeCommandNames).toEqual(expect.arrayContaining(["categories", "list", "log", "doctor"]));
  });

  it("returns help without configuration for an empty command", async () => {
    const result = await runCli([], { env: {}, fileConfig: null });

    expect(result).toMatchObject({
      ok: true,
      command: "help",
      commands: expect.arrayContaining([
        expect.objectContaining({ name: "log", writesData: true }),
        expect.objectContaining({ name: "doctor", writesData: false }),
      ]),
    });
  });

  it("returns help without configuration for --help", async () => {
    const result = await runCli(["--help"], { env: {}, fileConfig: null });

    expect(result).toMatchObject({ ok: true, command: "help" });
  });

  it("returns command-specific help without configuration", async () => {
    const result = await runCli(["log", "--help"], { env: {}, fileConfig: null });

    expect(result).toMatchObject({
      ok: true,
      command: "help",
      topic: "log",
      commands: [expect.objectContaining({ name: "log", writesData: true })],
    });
  });

  it("returns UNKNOWN_COMMAND before reading configuration", async () => {
    const result = await runCli(["delete"], { env: {}, fileConfig: null });

    expect(result).toEqual({
      ok: false,
      error: { code: "UNKNOWN_COMMAND", message: "Unknown command: delete" },
    });
  });

  it("still requires configuration for data commands", async () => {
    const result = await runCli(["categories"], { env: {}, fileConfig: null });

    expect(result).toEqual({
      ok: false,
      error: { code: "CONFIG_MISSING", message: "Missing TimeData server URL" },
    });
  });

  it("dispatches categories with injected fetch", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify([]), { status: 200 }));

    const result = await runCli(["categories"], {
      env: {},
      fileConfig: { serverUrl: "https://server.example", token: "secret" },
      fetchImpl,
    });

    expect(result).toEqual({ ok: true, categories: [] });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://server.example/api/categories",
      expect.objectContaining({
        method: "GET",
        headers: { Authorization: "Bearer secret" },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("direct execution parses --format human", async () => {
    const writeStdout = vi.fn();
    const writeStderr = vi.fn();
    const exit = vi.fn();

    await runFromArgv(["node", "timedata", "list", "--format", "human"], {
      isTTY: false,
      writeStdout,
      writeStderr,
      exit,
    });

    expect(writeStdout).not.toHaveBeenCalled();
    expect(writeStderr).toHaveBeenCalledWith("Error [CONFIG_MISSING]: Missing TimeData server URL\n");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("失败结果走 stderr，stdout 保持空字符串", async () => {
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    const exit = vi.fn();

    await runFromArgv(["node", "timedata", "unknown-cmd"], {
      writeStdout: (text) => stdoutChunks.push(text),
      writeStderr: (text) => stderrChunks.push(text),
      exit,
    });

    expect(stdoutChunks.join("")).toBe("");
    expect(stderrChunks.join("")).toContain("UNKNOWN_COMMAND");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("成功结果走 stdout 不出现在 stderr", async () => {
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    const exit = vi.fn();

    await runFromArgv(["node", "timedata", "--help"], {
      writeStdout: (text) => stdoutChunks.push(text),
      writeStderr: (text) => stderrChunks.push(text),
      exit,
    });

    expect(stdoutChunks.join("")).toContain('"ok": true');
    expect(stderrChunks.join("")).toBe("");
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("dispatches doctor before normal command configuration handling", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "ok" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));

    const result = await runCli(["doctor", "--server", "https://server.example", "--token", "secret"], {
      env: {},
      fileConfig: null,
      fetchImpl,
    });

    expect(result).toEqual({
      ok: true,
      checks: [
        { name: "config", ok: true, message: "Configuration resolved" },
        { name: "serverUrl", ok: true, message: "Server URL is valid" },
        { name: "server", ok: true, message: "Server health check passed" },
        { name: "auth", ok: true, message: "Read-only API check passed" },
      ],
    });
  });
});
