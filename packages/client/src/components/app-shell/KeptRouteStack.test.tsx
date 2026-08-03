// @vitest-environment jsdom
import { createElement, useState } from "react";
import { type Location, MemoryRouter, NavigationType, useNavigate } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { click, renderDom, unmount } from "../../test/domHarness.js";
import { useIsLayerActive } from "./keptLayerActive.js";

// 本文件刻意**不** mock @capacitor/core：平台闸的唯一实现点在 App.tsx（`getPlatform() === "ios"`），
// 组件通篇没有 Capacitor 引用。这里曾有一条「非 iOS 平台不渲染栈」的用例，mock 的 getPlatform
// 没有被任何代码读过，断言与「初始只有一层」逐字相同——名字骗人的绿用例。已移到 App.keptStack.test.tsx，
// 在真正做判断的那一层建闸（把 App.tsx 判据写反，那边 4 条全红）。

// 用极简路由表替掉真实 AppRoutes：本用例要验的是栈行为，不是页面内容。
const mountCounts: Record<string, number> = {};
// 受控挂起：路径进了这个集合，该层就 throw 一个**永不 resolve** 的 promise——等价于真实 AppRoutes
// 里 lazy() 的 chunk 还没到。刻意永不 resolve：本仓禁真实定时等待，用例只看「挂起那一刻」的 DOM。
const suspendPaths = new Set<string>();
const neverSettles = new Promise<void>(() => {});
vi.mock("./AppRoutes.tsx", () => ({
  AppRoutes: ({ location }: { location?: { pathname: string } }) => {
    const path = location?.pathname ?? "/";
    if (suspendPaths.has(path)) throw neverSettles;
    // 计数写在 useState 初始化器里：它只在**挂载**那一次跑。写在函数体里数的是渲染次数——
    // 栈每次推进都会让保留层重渲染一次（元素对象是新的，React 不会 bail out），
    // 那样连正确实现都恒红，闸就成了噪声。
    // mountedPath 记下「这棵树当初是为哪一页挂的」：key 写错（如 key={index}）时 React 会把
    // 上一页的树留在原位改渲染本页，DOM/state 其实已经串了——它与当前 path 不符即暴露。
    const [mountedPath] = useState(() => {
      mountCounts[path] = (mountCounts[path] ?? 0) + 1;
      return path;
    });
    // data-layer-active：页面子树读到的「本层是否活跃」。保留层必须读到 false——
    // 它是 useUnsavedChangesGuard 之类「注册到全局」的钩子唯一能知道自己已经不可见的途径。
    return createElement("div", {
      "data-page": path,
      "data-mounted-path": mountedPath,
      "data-layer-active": String(useIsLayerActive()),
    });
  },
}));

// 底栏同样替成桩：真件要 BottomNavProvider + 设置/db，与「栈行为」无关。
// 桩保留一个可查询的标记，好钉住「底栏在层内、不在栈外」这条布局契约。
vi.mock("./MobileBottomNav.tsx", () => ({
  MobileBottomNav: () => createElement("nav", { "data-bottom-nav": "" }),
}));

import { type KeptLayer, KeptRouteStack, nextStack } from "./KeptRouteStack.tsx";

/** 三个按钮各跳一处，用 domHarness 的 click（已包 act）逐次推进。 */
function Nav() {
  const navigate = useNavigate();
  return createElement(
    "div",
    null,
    createElement("button", {
      type: "button",
      "data-testid": "to-data",
      onClick: () => navigate("/settings/data"),
    }),
    createElement("button", {
      type: "button",
      "data-testid": "to-cat",
      onClick: () => navigate("/settings/categories/c1"),
    }),
    createElement("button", { type: "button", "data-testid": "go-back", onClick: () => navigate(-1) }),
  );
}

/**
 * 日记页切日期 / 搜索页改筛选那一类导航：只换 search、走 `{ replace: true }`。
 * 仓库里 iOS 会走到的 replace 导航有十余处（DiaryPage、SearchPage、DiaryReviewPage、EntryPage…），
 * 是高频日常操作，故按真实用法建桩。
 */
function ReplaceNav() {
  const navigate = useNavigate();
  return createElement(
    "div",
    null,
    createElement("button", { type: "button", "data-testid": "to-diary", onClick: () => navigate("/diary") }),
    createElement("button", {
      type: "button",
      "data-testid": "diary-date",
      onClick: () => navigate("/diary?date=2026-01-02", { replace: true }),
    }),
    createElement("button", {
      type: "button",
      "data-testid": "diary-date2",
      onClick: () => navigate("/diary?date=2026-01-03", { replace: true }),
    }),
    createElement("button", { type: "button", "data-testid": "replace-back", onClick: () => navigate(-1) }),
  );
}

async function renderReplaceCase() {
  return renderDom(
    createElement(
      MemoryRouter,
      { initialEntries: ["/"] },
      createElement(KeptRouteStack, {}),
      createElement(ReplaceNav, null),
    ),
  );
}

function loc(pathname: string, key: string, search = ""): Location {
  return { pathname, search, hash: "", state: null, key };
}

/** 栈元素：React 身份（key）与渲染用的 location 是两件事，REPLACE 时只换后者。 */
function layer(pathname: string, key: string, search = ""): KeptLayer {
  return { key, location: loc(pathname, key, search) };
}

beforeEach(() => {
  for (const k of Object.keys(mountCounts)) delete mountCounts[k];
  suspendPaths.clear();
});

describe("nextStack", () => {
  it("同一条历史不重复入栈", () => {
    const a = layer("/todo", "k1");
    const prev = [a];
    expect(nextStack(prev, loc("/todo", "k1"), NavigationType.Push)).toBe(prev);
  });

  it("超过两层时从头部丢，剩余顺序不变", () => {
    const a = layer("/todo", "k1");
    const b = layer("/settings/data", "k2");
    const c = loc("/settings/categories/c1", "k3");
    const result = nextStack([a, b], c, NavigationType.Push);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(b);
    expect(result[1].location).toBe(c);
  });

  it("回到栈里已有的 key 时截断到那一层（复用而非新建）", () => {
    const a = layer("/todo", "k1");
    const b = layer("/settings/data", "k2");
    const result = nextStack([a, b], loc("/todo", "k1"), NavigationType.Pop);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(a);
  });
});

// react-router 的 replace 导航会**生成新的 location.key**，却**不新增历史条目**（换掉当前那条）。
// 只看 key 就分不清它与 push：会把同一页的新旧两份都塞进栈——当前页重挂、上一页被挤出去，
// 而 navigate(-1) 落到的却是更早那条历史（露出 A、松手到 B）。故 nextStack 必须吃 navigationType。
describe("nextStack REPLACE", () => {
  it("REPLACE 只换渲染用的 location，栈尾的 React key 原样不动", () => {
    const a = layer("/", "k1");
    const b = layer("/diary", "k2");
    const replaced = loc("/diary", "k3", "?date=2026-01-02");

    const result = nextStack([a, b], replaced, NavigationType.Replace);

    expect(result).toHaveLength(2);
    // 身份不变是这条修复的核心：换了 React key 就等于告诉 React「这是新页面」，整棵树重挂，
    // 滚动位置与组件 state 全丢——而切日期/改筛选是高频日常操作。
    expect(result[1].key).toBe("k2");
    // 但渲染的必须是新地址，否则页面停在旧日期上。
    expect(result[1].location).toBe(replaced);
  });

  it("REPLACE 不把上一层挤出栈", () => {
    const a = layer("/", "k1");
    const b = layer("/diary", "k2");

    const result = nextStack([a, b], loc("/diary", "k3", "?date=2026-01-02"), NavigationType.Replace);

    expect(result).toHaveLength(2);
    // 第 0 层还得是 /：replace 不新增历史条目，navigate(-1) 落点仍是 /，
    // 保留层与落点必须是同一页，否则手势会露出 A 却落到 B。
    expect(result[0]).toBe(a);
    expect(result[0].location.pathname).toBe("/");
  });

  it("连续 REPLACE 仍沿用最初进入该页时的 React key", () => {
    const a = layer("/", "k1");
    const b = layer("/diary", "k2");

    const once = nextStack([a, b], loc("/diary", "k3", "?date=2026-01-02"), NavigationType.Replace);
    const twice = nextStack(once, loc("/diary", "k4", "?date=2026-01-03"), NavigationType.Replace);

    expect(twice).toHaveLength(2);
    expect(twice[1].key).toBe("k2");
    expect(twice[1].location.search).toBe("?date=2026-01-03");
  });

  it("栈为空时 REPLACE 退化为入栈", () => {
    const l = loc("/diary", "k1");
    expect(nextStack([], l, NavigationType.Replace)).toEqual([{ key: "k1", location: l }]);
  });

  it("REPLACE 过的那层，之后回退时按 location.key 找得回来（不是按 React key）", () => {
    // REPLACE 之后该层的 React key 与其 location.key 已经不同：查栈只能按 location.key（历史条目身份）。
    // 按 React key 查会找不到、当成新页 append——回来的那页被重挂，栈序还倒过来了。
    const a = layer("/", "k1");
    const b = layer("/diary", "k2");
    const replaced = loc("/diary", "k3", "?date=2026-01-02");
    const afterReplace = nextStack([a, b], replaced, NavigationType.Replace);
    const afterPush = nextStack(afterReplace, loc("/settings/data", "k4"), NavigationType.Push);

    const afterBack = nextStack(afterPush, replaced, NavigationType.Pop);

    expect(afterBack).toHaveLength(1);
    expect(afterBack[0].key).toBe("k2");
    expect(afterBack[0].location).toBe(replaced);
  });

  it("同 key 但 search / hash 不同，仍算换了地址（否则日记切日期会停在旧那天）", () => {
    // isSameEntry 里比 search 与 hash 的那两个子句正是为这种逃逸场景存在的：只比 key + pathname 的话，
    // `/diary?date=A` 与 `?date=B` 会被判成同一条而原样返回，栈尾还渲染着旧日期。
    // 常规 replace 会连带换 key、比 key 就够；这里压的是 key 没换的那一支（history.state 丢 key 时 key 恒为 "default"）。
    const dateA = layer("/diary", "default", "?date=2026-01-01");
    const dateB = loc("/diary", "default", "?date=2026-01-02");
    expect(nextStack([dateA], dateB, NavigationType.Replace)[0].location).toBe(dateB);

    const noHash = { ...loc("/diary", "default"), hash: "" };
    const withHash = { ...loc("/diary", "default"), hash: "#note-3" };
    expect(nextStack([{ key: "default", location: noHash }], withHash, NavigationType.Replace)[0].location).toBe(
      withHash,
    );
  });

  it("同一个 key 撞上不同地址时，栈尾仍是当前 location（不变式 1 兜底）", () => {
    // 探针实测的反例：两条 location 共用一个 key（history.state 丢 key 的极端场景）时，
    // 只比 key 会认为「已经是栈尾了」而原样返回——当前页根本不在栈里，渲染的是上一页的内容。
    const a = layer("/a", "default");
    const b = loc("/b", "default");

    const result = nextStack([a], b, NavigationType.Push);

    expect(result[result.length - 1].location).toBe(b);
    expect(result[result.length - 1].key).toBe("default");
  });
});

describe("nextStack POP 到栈外", () => {
  it("POP 到栈外的历史条目时丢弃保留层，只剩当前这一层", () => {
    // A→B→C（栈 [B,C]）→ 回 B（栈截断成 [B]）→ 再回 A：A 已不在栈里。
    // 此时若把 B 留作保留层，露出来的是历史上**更靠前方**的页，而 navigate(-1) 落到的是 A 之前那条——
    // 又一次「露 A 落 B」。不知道来处是谁时，唯一诚实的状态就是没有保留层。
    const b = layer("/settings/data", "k2");
    const c = layer("/settings/categories/c1", "k3");
    const a = loc("/todo", "k1");

    const result = nextStack([b, c], a, NavigationType.Pop);

    expect(result).toHaveLength(1);
    expect(result[0].location).toBe(a);
  });

  it("POP 到栈**内**的那条仍是截断复用，不受影响", () => {
    const b = layer("/settings/data", "k2");
    const c = layer("/settings/categories/c1", "k3");

    const result = nextStack([b, c], loc("/settings/data", "k2"), NavigationType.Pop);

    expect(result).toHaveLength(1);
    expect(result[0]).toBe(b);
  });
});

describe("nextStack 不变式 fuzz", () => {
  it("随机 push/pop/replace 序列下：当前 location 恒为栈尾、保留层恒为历史前一条、React key 不重复、栈长不超 2、幂等", () => {
    // 固定种子的线性同余，跑得快又可复现；失败时 violations 里带着现场。
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const paths = ["/", "/diary", "/todo", "/settings/data", "/settings/categories/c1"];
    const violations: string[] = [];

    for (let trial = 0; trial < 500; trial += 1) {
      // 模拟真实浏览器历史：entries 是历史栈，idx 是当前位置。push 截断前向条目、
      // replace 就地换掉 entries[idx]（不移动 idx）、pop 只挪 idx。
      let history: Location[] = [loc("/", "default")];
      let idx = 0;
      let keyN = 0;
      let stack: KeptLayer[] = [{ key: history[0].key, location: history[0] }];
      let navigationType: NavigationType = NavigationType.Pop;

      for (let step = 0; step < 12; step += 1) {
        const r = rnd();
        if (r < 0.45) {
          const l = loc(paths[Math.floor(rnd() * paths.length)], `k${keyN++}`);
          history = [...history.slice(0, idx + 1), l];
          idx = history.length - 1;
          navigationType = NavigationType.Push;
        } else if (r < 0.7 && idx > 0) {
          idx -= 1;
          navigationType = NavigationType.Pop;
        } else if (r < 0.85) {
          const l = loc(paths[Math.floor(rnd() * paths.length)], `k${keyN++}`);
          history = [...history.slice(0, idx), l, ...history.slice(idx + 1)];
          navigationType = NavigationType.Replace;
        } else if (idx < history.length - 1) {
          idx += 1;
          navigationType = NavigationType.Pop;
        }
        // 落到最后一支且没得前进时，location 与 navigationType 都不变——正好顺带压一遍
        // 「同一条 location 再算一次不该动栈」（组件在渲染期同步纠正，不幂等就是无限渲染）。

        const cur = history[idx];
        stack = nextStack(stack, cur, navigationType);
        const where = `trial=${trial} step=${step} type=${navigationType}`;
        const keys = stack.map((l) => l.key);
        if (new Set(keys).size !== keys.length) violations.push(`重复 React key ${JSON.stringify(keys)} @${where}`);
        if (stack[stack.length - 1]?.location?.key !== cur.key) {
          violations.push(`当前 location 不在栈尾 stack=${JSON.stringify(keys)} cur=${cur.key} @${where}`);
        }
        if (stack.length > 2) violations.push(`栈长 ${stack.length} 超限 @${where}`);
        if (stack.length === 2 && stack[0].location.key !== history[idx - 1]?.key) {
          // 保留层就是手势要露出、松手要落到的那一页，它必须恰好是历史上当前条目的前一条。
          // 露出的是别的页（哪怕只是前进方向的页）就等于「露 A 落 B」。
          violations.push(`保留层不是历史前一条 kept=${stack[0].location.key} 应为=${history[idx - 1]?.key} @${where}`);
        }
        if (nextStack(stack, cur, navigationType) !== stack) violations.push(`不幂等 @${where}`);
      }
    }

    expect(violations.slice(0, 5)).toEqual([]);
  });
});

describe("KeptRouteStack", () => {
  it("初始只有一层，且是 active", async () => {
    const { host, root } = await renderDom(
      createElement(MemoryRouter, { initialEntries: ["/todo"] }, createElement(KeptRouteStack, {})),
    );
    expect(host.querySelectorAll("[data-kept-layer]")).toHaveLength(1);
    expect(host.querySelector('[data-kept-layer="active"]')).not.toBeNull();
    await unmount(root);
  });

  it("进子页后保留上一层，且上一层用 visibility 隐藏、不是 display:none", async () => {
    const { host, root } = await renderDom(
      createElement(
        MemoryRouter,
        { initialEntries: ["/todo"] },
        createElement(KeptRouteStack, {}),
        createElement(Nav, null),
      ),
    );
    await click(host.querySelector('[data-testid="to-data"]'));

    const kept = host.querySelector('[data-kept-layer="kept"]') as HTMLElement;
    expect(kept).not.toBeNull();
    expect(kept.style.visibility).toBe("hidden");
    expect(kept.style.display).not.toBe("none");
    expect(kept.querySelector('[data-page="/todo"]')).not.toBeNull();
    expect(host.querySelectorAll("[data-kept-layer]")).toHaveLength(2);
    // 底栏在层内而非栈外：返回手势里上一页的底栏要跟着一起滑回来（已知取舍见组件注释）。
    expect(kept.querySelector("[data-bottom-nav]")).not.toBeNull();
    await unmount(root);
  });

  it("保留层的子树读到「本层不活跃」，当前层读到活跃", async () => {
    // 这条钉的是「未保存就别走」那类**全局注册型**钩子的关门开关：visibility:hidden + inert
    // 只挡看得见摸得着的东西，挡不住已注册的 useBlocker。少了这个 Provider，脏着的日记页切走后
    // 会在速记页凭空弹「放弃未保存的修改？」，选「继续编辑」还把用户钉在那儿。
    const { host, root } = await renderDom(
      createElement(
        MemoryRouter,
        { initialEntries: ["/todo"] },
        createElement(KeptRouteStack, {}),
        createElement(Nav, null),
      ),
    );
    expect(host.querySelector('[data-page="/todo"]')?.getAttribute("data-layer-active")).toBe("true");

    await click(host.querySelector('[data-testid="to-data"]'));

    expect(host.querySelector('[data-page="/todo"]')?.getAttribute("data-layer-active")).toBe("false");
    expect(host.querySelector('[data-page="/settings/data"]')?.getAttribute("data-layer-active")).toBe("true");
    await unmount(root);
  });

  it("每层各自一个 Suspense：子页懒加载还没到时，保留层仍留在 DOM 里", async () => {
    // 纪律条 3。共用一个边界的话，子页 lazy chunk 未到就会让**整个栈**一起挂起：
    // 保留层跟着从 DOM 消失，手势没有活底层可露，还闪一帧白。
    // useTransitions={false} 让导航走同步 setState：默认的 startTransition 语义下 React 会
    // 「先按住旧界面不动」，共用边界与分层边界在 DOM 上一时看不出差别，闸就测不出东西了。
    const { host, root } = await renderDom(
      createElement(
        MemoryRouter,
        { initialEntries: ["/todo"], useTransitions: false },
        createElement(KeptRouteStack, {}),
        createElement(Nav, null),
      ),
    );
    suspendPaths.add("/settings/data");

    await click(host.querySelector('[data-testid="to-data"]'));

    expect(host.querySelector('[data-kept-layer="kept"]')).not.toBeNull();
    expect(host.querySelector('[data-page="/todo"]')).not.toBeNull();
    // 挂起的是**当前层自己**：它的 fallback 是 null，故这一层没有内容。
    expect(host.querySelector('[data-page="/settings/data"]')).toBeNull();
    await unmount(root);
  });

  it("最多留两层，超出从头部丢且剩余层不重新挂载", async () => {
    const { host, root } = await renderDom(
      createElement(
        MemoryRouter,
        { initialEntries: ["/todo"] },
        createElement(KeptRouteStack, {}),
        createElement(Nav, null),
      ),
    );
    await click(host.querySelector('[data-testid="to-data"]'));
    expect(mountCounts["/settings/data"]).toBe(1);

    await click(host.querySelector('[data-testid="to-cat"]'));

    expect(host.querySelectorAll("[data-kept-layer]")).toHaveLength(2);
    // /todo 那层被丢弃，/settings/data 从 active 变 kept——**不能**因此重新挂载。
    // 这条是「页面不关」是否真的成立的核心闸：涨到 2 就说明 React 重建了那棵树，位置与 state 全丢。
    expect(mountCounts["/settings/data"]).toBe(1);
    const kept = host.querySelector('[data-kept-layer="kept"]') as HTMLElement;
    const keptPage = kept.querySelector('[data-page="/settings/data"]');
    expect(keptPage).not.toBeNull();
    // 且必须是**当初为 /settings/data 挂的那棵树**，不是被 React 挪来改渲染的 /todo 那棵。
    // key 用 index 而非 location.key 时这里会读到 "/todo"：DOM 复用了，滚动位置与 state 已经串了。
    expect(keptPage?.getAttribute("data-mounted-path")).toBe("/settings/data");
    await unmount(root);
  });

  it("回退时保留层升为 active，且仍不重新挂载", async () => {
    const { host, root } = await renderDom(
      createElement(
        MemoryRouter,
        { initialEntries: ["/todo"] },
        createElement(KeptRouteStack, {}),
        createElement(Nav, null),
      ),
    );
    await click(host.querySelector('[data-testid="to-data"]'));
    await click(host.querySelector('[data-testid="go-back"]'));

    expect(host.querySelectorAll("[data-kept-layer]")).toHaveLength(1);
    expect(mountCounts["/todo"]).toBe(1);
    const active = host.querySelector('[data-kept-layer="active"]') as HTMLElement;
    expect(active.querySelector('[data-page="/todo"]')).not.toBeNull();
    await unmount(root);
  });

  it("切日期（replace）不把当前页重新挂载", async () => {
    const { host, root } = await renderReplaceCase();
    await click(host.querySelector('[data-testid="to-diary"]'));
    expect(mountCounts["/diary"]).toBe(1);

    await click(host.querySelector('[data-testid="diary-date"]'));
    await click(host.querySelector('[data-testid="diary-date2"]'));

    // 本方案的全部价值就是「页面不卸载、滚动位置与 state 不丢」。replace 换的是同一条历史条目，
    // 页面必须原地接着活——涨到 2 就说明每切一次日期都把整页重挂一遍，比不做这套机制还糟。
    expect(mountCounts["/diary"]).toBe(1);
    const active = host.querySelector('[data-kept-layer="active"]') as HTMLElement;
    // 且渲染的确实是新地址那一版（沿用 key 不等于沿用内容）。
    expect(active.querySelector('[data-page="/diary"]')).not.toBeNull();
    await unmount(root);
  });

  it("切日期（replace）不把上一页挤出栈，返回仍落回上一页", async () => {
    const { host, root } = await renderReplaceCase();
    await click(host.querySelector('[data-testid="to-diary"]'));
    await click(host.querySelector('[data-testid="diary-date"]'));

    expect(host.querySelectorAll("[data-kept-layer]")).toHaveLength(2);
    const kept = host.querySelector('[data-kept-layer="kept"]') as HTMLElement;
    // replace 不新增历史条目，保留层必须还是 /；变成「同一页的旧副本」时手势会露出 A、松手落到 B。
    expect(kept.querySelector('[data-page="/"]')).not.toBeNull();
    expect(kept.querySelector('[data-page="/diary"]')).toBeNull();

    await click(host.querySelector('[data-testid="replace-back"]'));

    // navigate(-1) 的真实落点是 /：保留层与落点必须是同一页，这正是手势松手后要接住的那一层。
    expect(host.querySelectorAll("[data-kept-layer]")).toHaveLength(1);
    const active = host.querySelector('[data-kept-layer="active"]') as HTMLElement;
    expect(active.querySelector('[data-page="/"]')).not.toBeNull();
    expect(mountCounts["/"]).toBe(1);
    await unmount(root);
  });

  it("回退到栈外的历史条目时不留保留层，手势因此不会露出前进方向的页", async () => {
    const { host, root } = await renderDom(
      createElement(
        MemoryRouter,
        { initialEntries: ["/todo"] },
        createElement(KeptRouteStack, {}),
        createElement(Nav, null),
      ),
    );
    await click(host.querySelector('[data-testid="to-data"]'));
    // 栈满两层，/todo 已被挤出窗口。
    await click(host.querySelector('[data-testid="to-cat"]'));
    // 回 /settings/data：它在栈里，截断复用（这条既有行为不受影响）。
    await click(host.querySelector('[data-testid="go-back"]'));
    // 再回 /todo：已不在栈里。留着 /settings/data 当保留层的话，露出来的是**前进方向**的页，
    // 而 navigate(-1) 落到的是 /todo 之前那条——正是本批要消灭的「露 A 落 B」。
    await click(host.querySelector('[data-testid="go-back"]'));

    expect(host.querySelectorAll("[data-kept-layer]")).toHaveLength(1);
    // 没有 kept 层 → EdgeSwipeBack 的启动条件之一不成立，手势自动哑火，用户走左上角返回。
    // 宁可手势少一次可用，也不能露错页面。
    expect(host.querySelector('[data-kept-layer="kept"]')).toBeNull();
    const active = host.querySelector('[data-kept-layer="active"]') as HTMLElement;
    expect(active.querySelector('[data-page="/todo"]')).not.toBeNull();
    await unmount(root);
  });
});
