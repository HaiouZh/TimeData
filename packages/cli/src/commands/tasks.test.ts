import { describe, expect, it, vi } from "vitest";
import { runTasks, runTaskDone, runTaskSchedule, runTaskTag, runTaskTurn, runTaskUnschedule } from "./tasks.js";

const config = { serverUrl: "http://x", token: "t" };

function ok(data: unknown) {
  return new Response(JSON.stringify({ ok: true, ...data }), { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("runTasks", () => {
  it("查询所有任务", async () => {
    const fetchImpl = vi.fn(async () => ok({ tasks: [] }));
    const r = await runTasks(config, {}, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining("/api/tasks"), expect.anything());
    expect(r).toEqual({ ok: true, tasks: [] });
  });
});

describe("runTaskSchedule", () => {
  it("POST /api/tasks/:id/schedule", async () => {
    const fetchImpl = vi.fn(async () => ok({ task: { id: "1", scheduledAt: "2026-06-20T00:00:00.000Z" } }));
    await runTaskSchedule(config, { id: "1", date: "2026-06-20" }, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining("/api/tasks/1/schedule"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("缺 id → INVALID_REQUEST", async () => {
    const r = await runTaskSchedule(config, { date: "2026-06-20" }, vi.fn());
    expect((r as { error: { code: string } }).error.code).toBe("INVALID_REQUEST");
  });

  it("缺 date → INVALID_REQUEST", async () => {
    const r = await runTaskSchedule(config, { id: "1" }, vi.fn());
    expect((r as { error: { code: string } }).error.code).toBe("INVALID_REQUEST");
  });
});

describe("runTaskUnschedule", () => {
  it("POST scheduledDate=null", async () => {
    const fetchImpl = vi.fn(async () => ok({ task: { id: "1", scheduledAt: null } }));
    await runTaskUnschedule(config, { id: "1" }, fetchImpl);
    const call = fetchImpl.mock.calls[0];
    expect(JSON.parse(call[1].body)).toEqual({ scheduledDate: null });
  });

  it("缺 id → INVALID_REQUEST", async () => {
    const r = await runTaskUnschedule(config, {}, vi.fn());
    expect((r as { error: { code: string } }).error.code).toBe("INVALID_REQUEST");
  });
});

describe("agent task turn commands", () => {
  it("runTaskTurn handback posts turn=me and note to agent endpoint", async () => {
    const fetchImpl = vi.fn(async () => ok({ task: { id: "task-1" } }));

    await runTaskTurn("me", config, { id: "task-1", note: "done PR#123" }, fetchImpl);

    const call = fetchImpl.mock.calls[0];
    expect(call[0]).toContain("/api/agent/tasks/task-1/status");
    expect(call[1]).toMatchObject({ method: "POST" });
    expect(JSON.parse(String(call[1].body))).toEqual({ turn: "me", note: "done PR#123" });
  });

  it("runTaskTurn running posts only turn", async () => {
    const fetchImpl = vi.fn(async () => ok({ task: { id: "task-1" } }));

    await runTaskTurn("running", config, { id: "task-1", note: "ignored" }, fetchImpl);

    expect(JSON.parse(String(fetchImpl.mock.calls[0][1].body))).toEqual({ turn: "running" });
  });

  it("runTaskDone posts done=true", async () => {
    const fetchImpl = vi.fn(async () => ok({ task: { id: "task-1" } }));

    await runTaskDone(config, { id: "task-1" }, fetchImpl);

    expect(fetchImpl.mock.calls[0][0]).toContain("/api/agent/tasks/task-1/status");
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1].body))).toEqual({ done: true });
  });

  it("requires id for agent task writes", async () => {
    const turnResult = await runTaskTurn("parked", config, {}, vi.fn());
    const doneResult = await runTaskDone(config, {}, vi.fn());

    expect((turnResult as { error: { code: string } }).error.code).toBe("INVALID_REQUEST");
    expect((doneResult as { error: { code: string } }).error.code).toBe("INVALID_REQUEST");
  });

  it("runTaskTag posts tags array", async () => {
    let body: unknown;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return ok({ task: { id: "task-1" } });
    }) as unknown as typeof fetch;

    await runTaskTag(config, { id: "task-1", tags: "agent,idea" }, fetchImpl);

    expect(body).toEqual({ tags: ["agent", "idea"] });
  });
});
