// @vitest-environment jsdom
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEYS } from "../../lib/storageKeys.js";
import { click, renderDom, unmount } from "../../test/domHarness.js";

const useLiveQueryMock = vi.hoisted(() =>
  vi.fn((_query: () => unknown, _deps?: unknown[], defaultResult?: unknown) => defaultResult ?? []),
);
const goalGalaxyPropsMock = vi.hoisted(() => vi.fn());

vi.mock("dexie-react-hooks", () => ({ useLiveQuery: useLiveQueryMock }));
vi.mock("../../lib/useIsWideScreen.js", () => ({ useIsWideScreen: vi.fn(() => true) }));
vi.mock("../../lib/goals.js", async () => {
  const actual = await vi.importActual<typeof import("../../lib/goals.js")>("../../lib/goals.js");
  return { ...actual, listGoals: vi.fn(() => []) };
});
vi.mock("../../lib/goalLayoutPins.js", async () => {
  const actual = await vi.importActual<typeof import("../../lib/goalLayoutPins.js")>("../../lib/goalLayoutPins.js");
  return { ...actual, listAllGoalLayoutPins: vi.fn(() => []) };
});
vi.mock("../../lib/tracks.js", async () => {
  const actual = await vi.importActual<typeof import("../../lib/tracks.js")>("../../lib/tracks.js");
  return { ...actual, listTracks: vi.fn(() => []), listAllTrackSteps: vi.fn(() => []) };
});
vi.mock("../../lib/sessions.js", () => ({ getActiveSession: vi.fn(() => null) }));
vi.mock("./goalPageData.js", () => ({ listAllTasksForGoals: vi.fn(() => []) }));
vi.mock("./GoalGalaxyCanvas.js", () => ({
  GoalGalaxyCanvas: (props: Record<string, unknown>) => {
    goalGalaxyPropsMock(props);
    return <div data-galaxy>星图画布</div>;
  },
}));
vi.mock("./GoalsListPage.js", () => ({ default: () => <div data-goals-list>目标列表</div> }));

const { useIsWideScreen } = await import("../../lib/useIsWideScreen.js");
const { GoalsPage } = await import("./GoalsPage.js");

const mockedUseIsWideScreen = vi.mocked(useIsWideScreen);

async function renderPage() {
  return renderDom(
    <MemoryRouter>
      <GoalsPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useLiveQueryMock.mockReset();
  useLiveQueryMock.mockImplementation(
    (_query: () => unknown, _deps?: unknown[], defaultResult?: unknown) => defaultResult ?? [],
  );
  goalGalaxyPropsMock.mockClear();
  mockedUseIsWideScreen.mockReturnValue(true);
  localStorage.clear();
});

describe("GoalsPage", () => {
  it("shows the galaxy by default on wide screens", async () => {
    mockedUseIsWideScreen.mockReturnValue(true);

    const { host, root } = await renderPage();

    expect(host.querySelector("[data-galaxy]")).toBeTruthy();
    expect(host.querySelector("[data-goals-list]")).toBeNull();
    await unmount(root);
  });

  it("waits for all galaxy live query data before mounting the canvas", async () => {
    mockedUseIsWideScreen.mockReturnValue(true);
    useLiveQueryMock
      .mockImplementationOnce(() => [])
      .mockImplementationOnce(() => [])
      .mockImplementationOnce(() => [])
      .mockImplementationOnce(() => [])
      .mockImplementationOnce(() => [])
      .mockImplementationOnce(() => undefined);

    const { host, root } = await renderPage();

    expect(host.querySelector("[data-galaxy]")).toBeNull();
    expect(host.querySelector("[data-galaxy-loading]")).toBeTruthy();
    expect(goalGalaxyPropsMock).not.toHaveBeenCalled();
    await unmount(root);
  });

  it("does not mask unresolved galaxy live queries with empty-array defaults", async () => {
    mockedUseIsWideScreen.mockReturnValue(true);

    const { root } = await renderPage();

    expect(useLiveQueryMock.mock.calls).toHaveLength(6);
    expect(useLiveQueryMock.mock.calls.every((call) => call[2] === undefined)).toBe(true);
    await unmount(root);
  });

  it("passes the active session id to the galaxy canvas", async () => {
    useLiveQueryMock
      .mockImplementationOnce(() => [])
      .mockImplementationOnce(() => [])
      .mockImplementationOnce(() => [])
      .mockImplementationOnce(() => [])
      .mockImplementationOnce(() => [])
      .mockImplementationOnce(() => ({ id: "session-active" }));

    const { root } = await renderPage();

    expect(goalGalaxyPropsMock).toHaveBeenCalledWith(expect.objectContaining({ activeSessionId: "session-active" }));
    await unmount(root);
  });

  it("shows the list by default on narrow screens", async () => {
    mockedUseIsWideScreen.mockReturnValue(false);

    const { host, root } = await renderPage();

    expect(host.querySelector("[data-galaxy]")).toBeNull();
    expect(host.querySelector("[data-goals-list]")).toBeTruthy();
    await unmount(root);
  });

  it("lets users switch between galaxy and list views", async () => {
    mockedUseIsWideScreen.mockReturnValue(true);
    const { host, root } = await renderPage();

    await click(host.querySelector('button[aria-label="切换到目标列表"]'));
    expect(host.querySelector("[data-goals-list]")).toBeTruthy();

    await click(host.querySelector('button[aria-label="切换到目标星图"]'));
    expect(host.querySelector("[data-galaxy]")).toBeTruthy();
    await unmount(root);
  });

  it("窄屏也尊重已存的星图偏好", async () => {
    localStorage.setItem(STORAGE_KEYS.goalsViewMode, "galaxy");
    mockedUseIsWideScreen.mockReturnValue(false);

    const { host, root } = await renderPage();

    expect(host.querySelector("[data-galaxy]")).toBeTruthy();
    expect(host.querySelector("[data-goals-list]")).toBeNull();
    await unmount(root);
  });

  it("宽屏也尊重已存的列表偏好", async () => {
    localStorage.setItem(STORAGE_KEYS.goalsViewMode, "list");
    mockedUseIsWideScreen.mockReturnValue(true);

    const { host, root } = await renderPage();

    expect(host.querySelector("[data-goals-list]")).toBeTruthy();
    expect(host.querySelector("[data-galaxy]")).toBeNull();
    await unmount(root);
  });

  it("手选模式落 localStorage", async () => {
    mockedUseIsWideScreen.mockReturnValue(true);
    const { host, root } = await renderPage();

    await click(host.querySelector('button[aria-label="切换到目标列表"]'));

    expect(localStorage.getItem(STORAGE_KEYS.goalsViewMode)).toBe("list");
    await unmount(root);
  });

  it("宽窄翻转不覆盖已手选的模式", async () => {
    mockedUseIsWideScreen.mockReturnValue(true);
    const { host, root } = await renderPage();

    // 先切到列表把模式挪离初值，否则下一次点「星图」是同值 setState、React 直接 bailout，
    // 压根不重渲染、wide 也就没机会翻转，这条断言就成了怎样都通过。
    await click(host.querySelector('button[aria-label="切换到目标列表"]'));

    // 手选星图的同一轮里让 wide 翻成窄屏：手选值与窄屏默认相反。
    // 旧实现的 [wide] 重置 effect 会在这轮把模式吹回 list，新实现必须留在 galaxy。
    mockedUseIsWideScreen.mockReturnValue(false);
    await click(host.querySelector('button[aria-label="切换到目标星图"]'));

    expect(host.querySelector("[data-galaxy]")).toBeTruthy();
    expect(host.querySelector("[data-goals-list]")).toBeNull();
    await unmount(root);
  });

  it("从未手选时仍按宽窄给默认", async () => {
    mockedUseIsWideScreen.mockReturnValue(true);
    const { host, root } = await renderPage();

    expect(host.querySelector("[data-galaxy]")).toBeTruthy();
    expect(localStorage.getItem(STORAGE_KEYS.goalsViewMode)).toBeNull();
    await unmount(root);
  });
});
