import { Suspense, useState } from "react";
import { type Location, NavigationType, useLocation, useNavigationType } from "react-router";
import { useScrollRestore } from "../../hooks/useScrollRestore.ts";
import { layoutHidesBottomNav } from "../../lib/navigation/navRegistry.ts";
import { AppRoutes } from "./AppRoutes.tsx";
import { KeptLayerActiveContext } from "./keptLayerActive.ts";
import { MobileBottomNav } from "./MobileBottomNav.tsx";

const MAX_LAYERS = 2;

/**
 * 栈的一层。**React 身份**与**渲染用的 location** 是两件事，必须分开存：
 * replace 导航会生成新的 `location.key` 却不新增历史条目，此时要换内容（location）但不能换身份（key）——
 * 换了 key 等于告诉 React「这是新页面」，整棵树重挂，滚动位置与组件 state 全丢。
 */
export interface KeptLayer {
  /** React key。REPLACE 时刻意沿用旧值，其余情况等于 `location.key`。 */
  key: string;
  /** 这一层渲染用的 location。栈尾恒为当前 location。 */
  location: Location;
}

/**
 * 是不是「同一条历史条目的同一个地址」。
 * 只比 key 不够：审查探针构造过两条 location 共用一个 key 的反例，那时按 key 判等会认定
 * 当前页已经在栈尾而原样返回——当前页根本没进栈，渲染出的是上一页的内容。属防御性兜底。
 * 刻意不比 `state`：state 变了 react-router 会连带换 key，比 key 就够；而 state 的对象引用
 * 跨 POP 不保证稳定，比进来只会让保留层白白换一次 location 对象。
 */
function isSameEntry(a: Location, b: Location): boolean {
  return a.key === b.key && a.pathname === b.pathname && a.search === b.search && a.hash === b.hash;
}

/** 换掉栈尾渲染用的 location，但保住它的 React key——只换内容、不换身份，故不重挂。 */
function withTailLocation(stack: KeptLayer[], location: Location): KeptLayer[] {
  const tail = stack[stack.length - 1];
  if (!tail) return [{ key: location.key, location }];
  // 不变则原样返回：组件在渲染期同步纠正状态，这里每次都返回新数组就是无限渲染。
  if (isSameEntry(tail.location, location)) return stack;
  return [...stack.slice(0, -1), { key: tail.key, location }];
}

/**
 * 纯函数：新 location 到来时栈怎么变。导出供测试单独喂数据。
 *
 * **必须吃 navigationType**：replace 导航生成新 `location.key` 但**不新增历史条目**，
 * 只看 key 会把它当 push——同一页的新旧两份一起进栈，当前页被重挂、上一页被挤出去，
 * 而 `navigate(-1)` 落到的是更早那条历史（手势露出 A、松手却到 B）。
 */
export function nextStack(prev: KeptLayer[], location: Location, navigationType: NavigationType): KeptLayer[] {
  // REPLACE：历史条目被就地换掉，栈长度不变，只换栈尾的渲染内容。
  // 日记切日期、搜索改筛选、日记回顾切日期都走这条（setSearchParams(..., { replace: true })），是高频日常操作。
  if (navigationType === NavigationType.Replace) return withTailLocation(prev, location);

  // 注意查的是 `l.location.key`（历史条目身份）而不是 `l.key`（React 身份）：
  // 被 replace 过的那层两者已经不同，按 React key 查会找不到、把回退当成新页 append——
  // 回来的那页被重挂，栈序还倒过来。
  const last = prev[prev.length - 1];
  if (last?.location.key === location.key) return withTailLocation(prev, location);

  // 回到栈里已有的那条历史（navigate(-1)）：截断到它为止，复用其组件树。
  const existing = prev.findIndex((l) => l.location.key === location.key);
  if (existing >= 0) return withTailLocation(prev.slice(0, existing + 1), location);

  // POP 到栈**外**的条目（回退超出两层窗口、或前进）：我们并不知道当前页的「来处」是谁。
  // 此时留着旧栈尾当保留层，露出来的是历史上更靠**前方**的页，而 navigate(-1) 落到的是别处——
  // 与 replace 那个缺陷同一类的「露 A 落 B」。唯一诚实的状态是没有保留层：栈重置为当前这一层，
  // EdgeSwipeBack 因「无保留层」自动不启动。宁可手势少一次可用，也不能露错页面。
  if (navigationType === NavigationType.Pop) return [{ key: location.key, location }];

  const appended = [...prev, { key: location.key, location }];
  // 超限只从**头部**丢：剩余层的相对顺序不变，React 只做 removeChild、不移动已挂载节点。
  // 一旦让 React 移动某层，DOM 节点被搬走，其滚动容器 scrollTop 就可能被清掉——
  // 与误用 display:none 同一症状族。见 design §2.5.1-1。
  return appended.length > MAX_LAYERS ? appended.slice(appended.length - MAX_LAYERS) : appended;
}

interface KeptRouteStackProps {
  isWideScreen?: boolean;
  onMainScroll?: (event: React.UIEvent<HTMLElement>) => void;
}

/**
 * iOS 专用：钻进子页时上一页**不卸载**，留在栈里用 visibility 隐藏。
 * 边缘返回手势因此能露出活的上一页，返回后滚动位置与组件 state 天然还在。
 *
 * 四条不可违反的纪律（写错不报错、只在真机上表现为「位置偶尔丢」）：
 * 1. 栈只 append、只从头部移除，永不 reorder（见 nextStack）。
 * 2. 两层恒 absolute inset-0，切换只改 visibility——**绝不能用 display:none**，
 *    无 layout box 会让滚动容器 scrollTop 清零，整套机制的收益归零。
 * 3. 每层各自一个 Suspense：共用边界会让子页懒加载时整个栈一起挂起，
 *    保留层跟着消失、手势没有底层可露，还闪一帧白。
 * 4. React key 用层的身份（KeptLayer.key），不是 index、不是 pathname、也不是 location.key——
 *    replace 时 location.key 会变而身份不变，跟着变就等于每次切日期都重挂整页。
 * 5. 暗化遮罩渲染在**保留层内部**，别提到栈容器下（详见渲染处注释）：提出去就会盖在当前层之上，
 *    起手瞬间整屏一起变暗。
 * 6. 页面样式里**不得写死 `visibility: visible`**。visibility 是可继承属性，后代给绝对值就把这里的
 *    hidden 反向击穿，该元素连同自己的 z-index 一起浮到当前页之上（速记页日期条曾这样残留在时间轴页）。
 *    要「默认可见、可被某个类隐身」就写 `visibility: inherit`；闸在 indexCssTokens.test.ts。
 */
export function KeptRouteStack({ isWideScreen, onMainScroll }: KeptRouteStackProps) {
  const location = useLocation();
  // push / pop / replace 三种导航对栈的影响完全不同，只看 location 分不出来，必须一起读。
  // 二者同出 react-router 的 LocationContext（同一个 useMemo），故永远同帧一致。
  const navigationType = useNavigationType();
  const [stack, setStack] = useState<KeptLayer[]>(() => [{ key: location.key, location }]);

  // 渲染期同步纠正（React 官方的 "adjusting state during render" 模式）：
  // 放进 useEffect 会先渲染旧栈再补一帧，进子页时会闪一下旧内容。
  const computed = nextStack(stack, location, navigationType);
  if (computed !== stack) setStack(computed);

  return (
    <div className="relative flex min-w-0 flex-1 flex-col">
      {computed.map((layer, index) => {
        const loc = layer.location;
        const active = index === computed.length - 1;
        return (
          <div
            key={layer.key}
            data-kept-layer={active ? "active" : "kept"}
            className="absolute inset-0 flex flex-col"
            style={{ visibility: active ? "visible" : "hidden" }}
            aria-hidden={active ? undefined : "true"}
            inert={active ? undefined : true}
          >
            {/* visibility:hidden + inert 只挡住「看得见 / 摸得着」，挡不住往**全局**注册的东西：
                保留层的组件树还活着，它注册的 useBlocker 照样能拦住当前层的导航。故把「本层是否活跃」
                显式告诉子树，让这类钩子自己闭嘴（见 keptLayerActive.ts 与 useUnsavedChangesGuard）。 */}
            <KeptLayerActiveContext.Provider value={active}>
              <KeptLayerMain
                active={active}
                isWideScreen={isWideScreen}
                location={loc}
                onMainScroll={onMainScroll}
              />
              {/* 底栏在**层内**：返回手势中上一页的底栏跟着一起滑回来，才像 iOS 原生。
                代价是它的 NavLink 高亮读真实当前 location（在 <Routes location> 之外），
                手势期间保留层的高亮会短暂不准——已知取舍，见 design。 */}
              {!isWideScreen && !layoutHidesBottomNav(loc.pathname) && <MobileBottomNav />}
              {/* 暗化遮罩渲染在**保留层内部**，故天然夹在两层之间——iOS 原生只压暗下层。
                放在栈容器末尾（曾经的写法）会按 DOM 顺序盖在当前层**之上**：起手瞬间正在跟手滑出的
                当前页也被一起压暗，观感是整屏闪暗 25% 再变亮。
                也刻意不用 z-index 修：给当前层加 z-index 会让它成为层叠上下文，把页面内
                position:fixed 的整屏浮层封在里面（本仓大量浮层没走 portal），代价比问题本身大；
                而调 DOM 顺序会让 React 在栈推进时移动已挂载的层，可能清掉滚动容器的 scrollTop。
                放进保留层子树则一个 z-index 都不用加，且导航后随该层升为当前层自动移除。
                手势期间由 EdgeSwipeBack 直接改 opacity；静止时完全透明且不吃事件。 */}
              {!active && (
                <div
                  data-kept-overlay
                  className="pointer-events-none absolute inset-0 bg-backdrop"
                  style={{ opacity: 0 }}
                  aria-hidden="true"
                />
              )}
            </KeptLayerActiveContext.Provider>
          </div>
        );
      })}
    </div>
  );
}

/**
 * 层内滚动容器。单抽一个组件只为一件事：`useScrollRestore` 是 hook，不能在 `.map()` 里调用。
 *
 * 保留层（active=false）不记也不恢复位置，否则它会把当前页的位置覆盖掉。
 * 不变式 4「每层各自一个 Suspense」在这里原样保留——边界仍在层内，不是提到了栈容器上。
 */
function KeptLayerMain({
  active,
  isWideScreen,
  location,
  onMainScroll,
}: {
  active: boolean;
  // 与 KeptRouteStackProps 一致地可选：宽屏判据由调用方决定，这里不擅自收紧。
  isWideScreen?: boolean;
  location: Location;
  onMainScroll?: (event: React.UIEvent<HTMLElement>) => void;
}) {
  // 传本层的 pathname，不是全局当前 location——保留层渲染的是自己那一层。
  const { ref, onScroll } = useScrollRestore(active, location.pathname);

  return (
    <main
      ref={ref}
      className="min-h-0 flex-1 overflow-y-auto overscroll-y-none"
      onScroll={(event) => {
        // 两个消费方：底栏隐藏（仅活跃层、仅窄屏，与改动前的条件逐字一致）与滚动位置记录（仅活跃层）。
        if (active && !isWideScreen) onMainScroll?.(event);
        if (active) onScroll();
      }}
    >
      <Suspense fallback={null}>
        <AppRoutes location={location} />
      </Suspense>
    </main>
  );
}
