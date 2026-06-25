// @vitest-environment jsdom
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { click, renderDom, unmount } from "../../test/domHarness.js";

vi.mock("dexie-react-hooks", () => ({ useLiveQuery: (query: () => unknown, _deps?: unknown[], defaultResult?: unknown) => defaultResult ?? [] }));
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
vi.mock("./goalPageData.js", () => ({ listAllTasksForGoals: vi.fn(() => []) }));
vi.mock("./GoalGalaxyCanvas.js", () => ({
  GoalGalaxyCanvas: () => <div data-galaxy>星图画布</div>,
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
  mockedUseIsWideScreen.mockReturnValue(true);
});

describe("GoalsPage", () => {
  it("shows the galaxy by default on wide screens", async () => {
    mockedUseIsWideScreen.mockReturnValue(true);

    const { host, root } = await renderPage();

    expect(host.querySelector("[data-galaxy]")).toBeTruthy();
    expect(host.querySelector("[data-goals-list]")).toBeNull();
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
});
