import { createElement } from "react";
// @vitest-environment jsdom
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, resetDb } from "../../test/dbReset.js";
import { renderDom, unmount } from "../../test/domHarness.js";
import { GOAL_PREREQUISITES_SNAPSHOT_KEY, restoreGoalPrerequisitesFromSnapshot } from "../../db/index.ts";
import SettingsDataPage from "./SettingsDataPage.js";

// spy:true 让 restoreGoalPrerequisitesFromSnapshot 可被 4h 用例闸门控制，其余导出保持真实行为（call-through）。
vi.mock("../../db/index.ts", { spy: true });

const syncContextMock = vi.hoisted(() => ({
  value: {
    syncing: false,
    error: null,
    forceReplace: vi.fn(),
    refreshSyncStatus: vi.fn(),
    healthReport: null,
    healthLoading: false,
    forcePushPreparation: null,
    syncFailureCount: 0,
    needsSyncDiagnostics: false,
    runDiagnostics: vi.fn(),
    prepareForcePushToServer: vi.fn(),
    forcePushToServer: vi.fn(),
    apiUrl: "https://example.com",
    updateApiUrl: vi.fn(),
    cloudSyncEnabled: true,
    setCloudSyncEnabledInContext: vi.fn(),
    conflicts: [],
    handleConflictResolution: vi.fn(),
  },
}));

vi.mock("../../contexts/SyncContext.tsx", () => ({
  useSyncContext: () => syncContextMock.value,
}));

const localStorageMock = (() => {
  let store = new Map<string, string>();

  return {
    clear: () => {
      store = new Map<string, string>();
    },
    getItem: (key: string) => store.get(key) ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };
})();

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  configurable: true,
});

describe("SettingsDataPage", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("timedata_api_url", "https://example.com");
    localStorage.setItem("timedata_cloud_sync_enabled", "true");
    syncContextMock.value = {
      syncing: false,
      error: null,
      forceReplace: vi.fn(),
      refreshSyncStatus: vi.fn(),
      healthReport: null,
      healthLoading: false,
      forcePushPreparation: null,
      syncFailureCount: 0,
      needsSyncDiagnostics: false,
      runDiagnostics: vi.fn(),
      prepareForcePushToServer: vi.fn(),
      forcePushToServer: vi.fn(),
      apiUrl: "https://example.com",
      updateApiUrl: vi.fn(),
      cloudSyncEnabled: true,
      setCloudSyncEnabledInContext: vi.fn(),
      conflicts: [],
      handleConflictResolution: vi.fn(),
    };
  });

  it("renders the target data setting sections", () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(SettingsDataPage)));

    expect(html).toContain("数据设置");
    expect(html).toContain("是否开启云同步");
    expect(html).not.toContain("跨天记录合并展示");
    expect(html).toContain("备份与数据");
    expect(html).toContain("速记数据");
    expect(html).toContain("导出速记 JSON");
    expect(html).toContain("导出速记 Markdown");
    expect(html).toContain("导入速记 JSON");
    expect(html).toContain("删除日期范围速记");
    expect(html).toContain("高级 · 数据恢复");
    expect(html).toContain("强制替换");
    expect(html).toContain("导出完整备份");
    expect(html).toContain("立即在服务器备份");
    expect(html).toContain("从完整备份恢复");
    expect(html).toContain("同步健康诊断");
    expect(html).toContain("将本地数据覆盖到云端");
    expect(html).toContain("数据重置");
    expect(html).not.toContain("本地未来记录修复");
    expect(html).not.toContain("检查本地未来记录");
  });

  it("shows the restore status from navigation state", () => {
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: [{ pathname: "/settings/data", state: { dataStatus: "已恢复完整备份" } }] },
        createElement(SettingsDataPage),
      ),
    );

    expect(html).toContain("已恢复完整备份");
  });

  it("shows remote delete conflict choices", () => {
    syncContextMock.value.conflicts = [
      {
        tableName: "time_entries",
        recordId: "entry-delete-conflict",
        local: {
          id: "entry-delete-conflict",
          categoryId: "cat-local",
          startTime: "2026-05-07T09:00:00.000Z",
          endTime: "2026-05-07T10:00:00.000Z",
          note: "local pending",
          createdAt: "2026-05-07T08:00:00.000Z",
          updatedAt: "2026-05-07T12:00:00.000Z",
        },
        remote: null,
        remoteAction: "delete",
      },
    ];

    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(SettingsDataPage)));

    expect(html).toContain("服务器上这条记录已被删除");
    expect(html).toContain("保留本地（重新创建到服务器）");
    expect(html).toContain("接受删除（丢弃本地修改）");
  });

  it("uses settings design tokens instead of legacy slate/blue shell classes", () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(SettingsDataPage)));

    expect(html).not.toMatch(
      /(?:bg|text|border|divide|placeholder|ring-offset)-slate-|rounded-xl|bg-blue-|text-blue-|border-blue-|red-950|amber-900/,
    );
  });

  it("opens the recovery details when sync diagnostics are needed", async () => {
    syncContextMock.value.needsSyncDiagnostics = true;
    syncContextMock.value.syncFailureCount = 3;
    const { host, root } = await renderDom(createElement(MemoryRouter, null, createElement(SettingsDataPage)));

    const details = host.querySelector("details");
    expect(details?.open).toBe(true);
    expect(host.textContent).toContain("普通同步已连续失败 3 次");
    expect(host.querySelector("[data-tone='warn']")).toBeInstanceOf(HTMLElement);

    await unmount(root);
  });
});

const RESTORE_GOAL = {
  id: "goal-1",
  title: "装修",
  kind: "project",
  status: "active",
  members: [
    { kind: "task" as const, id: "t-1" },
    { kind: "task" as const, id: "t-2" },
  ],
  prerequisites: [],
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

const RESTORE_EDGE = {
  blocker: { kind: "task" as const, id: "t-1" },
  blocked: { kind: "task" as const, id: "t-2" },
};

describe("SettingsDataPage 前置依赖快照恢复按钮", () => {
  // fake-indexeddb 用真实 setImmediate 驱动事务回调：只伪造 Date/setTimeout 系列，别动 setImmediate。
  beforeEach(async () => {
    await resetDb();
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  });

  afterEach(async () => {
    vi.useRealTimers();
  });

  /** 推进计时器让 useLiveQuery 与恢复事务结算（fake-indexeddb 回调走真实 setImmediate，需要让出事件循环）。 */
  async function settle(rounds = 3): Promise<void> {
    await act(async () => {
      for (let index = 0; index < rounds; index += 1) {
        await vi.advanceTimersByTimeAsync(300);
      }
    });
  }

  function restoreButtonOf(host: HTMLElement): HTMLButtonElement | undefined {
    return [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("从快照重建前置依赖"),
    );
  }

  it("快照存在时按钮出现，不存在时不出现", async () => {
    await db.migrationSnapshots.put({
      key: GOAL_PREREQUISITES_SNAPSHOT_KEY,
      value: JSON.stringify({ "goal-1": [RESTORE_EDGE] }),
      updatedAt: "2026-08-01T00:00:00.000Z",
    });
    const { host, root } = await renderDom(createElement(MemoryRouter, null, createElement(SettingsDataPage)));
    await settle();
    expect(restoreButtonOf(host)).toBeDefined();
    await unmount(root);

    await resetDb();
    const { host: emptyHost, root: emptyRoot } = await renderDom(
      createElement(MemoryRouter, null, createElement(SettingsDataPage)),
    );
    await settle();
    expect(restoreButtonOf(emptyHost)).toBeUndefined();
    await unmount(emptyRoot);
  });

  it("点击后确认弹窗出现，确认后调用恢复函数并在状态区显示结果", async () => {
    await db.goals.add(RESTORE_GOAL);
    await db.migrationSnapshots.put({
      key: GOAL_PREREQUISITES_SNAPSHOT_KEY,
      value: JSON.stringify({ "goal-1": [RESTORE_EDGE] }),
      updatedAt: "2026-08-01T00:00:00.000Z",
    });
    const { host, root } = await renderDom(createElement(MemoryRouter, null, createElement(SettingsDataPage)));
    await settle();

    const restoreButton = restoreButtonOf(host);
    expect(restoreButton).toBeDefined();
    await act(async () => {
      restoreButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const dialogTitle = [...document.body.querySelectorAll("button")]
      .find((button) => button.textContent?.trim() === "确认");
    expect(dialogTitle).toBeDefined();
    expect(document.body.textContent).toContain("确认从快照重建前置依赖");

    await act(async () => {
      dialogTitle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();

    expect(host.textContent).toContain("新写入 1 条边，失败 0 条");
    const rows = await db.taskRelations.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ blockerKind: "task", blockerId: "t-1", blockedKind: "task", blockedId: "t-2" });

    await unmount(root);
  });

  it("4h 恢复进行中按钮 disabled，结束后恢复可用", async () => {
    let releaseRestore!: (value: { restored: number; failed: number }) => void;
    const gate = new Promise<{ restored: number; failed: number }>((resolve) => {
      releaseRestore = resolve;
    });
    const restoreSpy = vi.mocked(restoreGoalPrerequisitesFromSnapshot);
    restoreSpy.mockImplementation(() => gate);
    try {
      await db.migrationSnapshots.put({
        key: GOAL_PREREQUISITES_SNAPSHOT_KEY,
        value: JSON.stringify({ "goal-1": [RESTORE_EDGE] }),
        updatedAt: "2026-08-01T00:00:00.000Z",
      });
      const { host, root } = await renderDom(createElement(MemoryRouter, null, createElement(SettingsDataPage)));
      await settle();

      const restoreButton = restoreButtonOf(host);
      expect(restoreButton).toBeDefined();
      expect(restoreButton?.disabled).toBe(false);

      await act(async () => {
        restoreButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      const dialogTitle = [...document.body.querySelectorAll("button")]
        .find((button) => button.textContent?.trim() === "确认");
      expect(dialogTitle).toBeDefined();
      await act(async () => {
        dialogTitle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      expect(restoreButton?.disabled).toBe(true);

      await act(async () => {
        releaseRestore({ restored: 2, failed: 1 });
        await vi.advanceTimersByTimeAsync(300);
      });
      expect(restoreButton?.disabled).toBe(false);
      expect(host.textContent).toContain("新写入 2 条边，失败 1 条");

      await unmount(root);
    } finally {
      restoreSpy.mockRestore();
    }
  });
});
