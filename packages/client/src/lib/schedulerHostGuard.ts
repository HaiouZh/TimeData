/**
 * React 调度器解卡：记住调度器排队用的那个端口，死锁时给它补发一拍。
 *
 * 调度器（`scheduler` 包）在浏览器里靠一条 `MessageChannel` 给自己排队干活——
 * `port2.postMessage(null)` 发出、`port1.onmessage` 收到后才开工。它内部有个
 * 「消息循环已在跑」的开关，**只有那条消息真的送达并处理完才复位**；而排队入口对该开关
 * 有守卫，是 true 就不再发新消息。
 *
 * iOS 的 WKWebView 在 App 被挂起时会把在途消息直接丢掉。消息一丢，开关永久停在 true，
 * 此后**所有走调度器的更新全部停摆**：路由导航（react-router 把导航 setState 包进
 * `startTransition`）、Dexie liveQuery 回流都在此列；而点击里直接改 state 走的是微任务
 * 通道，照常生效。现场表现就是「弹层点得开、底栏 tab 点不动、数据写进去了但画面不刷」。
 *
 * 解法是补一拍：`performWorkUntilDeadline` 只要被调用一次，就会把积压干完并在无更多工作时
 * 把开关复位，整套调度随之复活。补发是安全的——该函数首行就是「开关没开就什么都不做」，
 * 任务队列本身也幂等，多进入一次至多空转。
 *
 * **为什么钩在原型上而不是包装 `MessageChannel`**：包装构造器只对**之后**新建的 channel 有效，
 * 而 `scheduler` 在自己被求值时（模块顶层）就把 channel 建好了。生产构建里 React 被拆进独立
 * chunk 且被入口 chunk 静态 import，按 ESM 语义它必然先求值——任何写在应用侧模块体里的
 * 构造器包装都赶不上，且不会有任何报错。钩原型则与时机无关：`postMessage` 是每次排队都要走的
 * 原型方法，只要在**死锁发生前**装上即可。
 */

/**
 * 最近一次用于调度排队的端口。
 *
 * 只认 `postMessage(null)` 这一形态——那是调度器的调用签名（本文件测试直接读 `scheduler` 产物钉住它，
 * React 升级改了形态会红）。不按形态过滤就会把页面里别的 MessageChannel 使用方（如 workbox）记进来，补拍补到无关端口上。
 */
let schedulerPort: MessagePort | null = null;

/** 与调度器端口配对的 port1（其 onmessage 即调度器的处理函数）。未配对为 null。 */
let pairedPort: MessagePort | null = null;
/** 调度器的原处理函数。直驱调它而不是包装函数——包装函数会刷新送达时间，甲的判据就失效了。 */
let schedulerHandler: ((this: MessagePort, event: MessageEvent) => unknown) | null = null;
/** 已包过的 port1 → 原处理函数。再次配对到同一个 port1 时不能把包装函数当原处理函数记下。 */
let originalHandlers = new WeakMap<object, (this: MessagePort, event: MessageEvent) => unknown>();

let lastPostedAt: number | null = null;
let lastDeliveredAt: number | null = null;

function defaultClock(): number {
  return performance.now();
}
let clock: () => number = defaultClock;

/** 打在已挂钩原型上的幂等标记。绑在对象而非模块变量，重复安装与测试隔离都靠它。 */
const TAP_FLAG = "__timedataSchedulerPortTap";

interface BootNamespace {
  /** `index.html` 内联钩子 `td-boot-channel-tap` 写入：port2 → port1。 */
  channelPairs?: WeakMap<object, MessagePort>;
}

interface MessagePortScope {
  MessagePort?: typeof MessagePort;
  __timedataBoot?: BootNamespace;
}

export interface TapOptions {
  /** 送达记账的时钟，默认 `performance.now`。注入点只为测试。 */
  now?: () => number;
}

function pairSchedulerChannel(port2: MessagePort, scope: MessagePortScope): void {
  try {
    const port1 = scope.__timedataBoot?.channelPairs?.get(port2);
    if (!port1) {
      pairedPort = null;
      schedulerHandler = null;
      return;
    }
    const known = originalHandlers.get(port1);
    if (known) {
      pairedPort = port1;
      schedulerHandler = known;
      return;
    }
    const original = port1.onmessage;
    if (typeof original !== "function") return;
    port1.onmessage = function deliveryStamp(this: MessagePort, event: MessageEvent): unknown {
      if (pairedPort === this) lastDeliveredAt = clock();
      return original.call(this, event);
    };
    originalHandlers.set(port1, original);
    pairedPort = port1;
    schedulerHandler = original;
  } catch {
    // 配对失败只丢诊断数据（paired 记 false），不影响补拍与投递
  }
}

/**
 * 在 `MessagePort.prototype.postMessage` 上挂钩，记录调度器用的端口与排队时间；若 `index.html` 的内联钩子
 * 已配对到它的 port1，就包一层 port1.onmessage 记送达时间。幂等，返回本次是否真的装上了。
 *
 * 开销是每次 `postMessage` 多一次 `=== null` 比较；以 null 排队时再多一次取时，每次投递多一次取时。
 * 安装时机只需早于死锁发生，`main.tsx` 模块体里调用即可（React 首次调度在那之后）。
 */
export function installSchedulerPortTap(
  scope: MessagePortScope = globalThis as MessagePortScope,
  options: TapOptions = {},
): boolean {
  const proto = scope.MessagePort?.prototype;
  if (!proto) return false;

  const flags = proto as unknown as Record<string, unknown>;
  if (flags[TAP_FLAG] === true) return false;
  clock = options.now ?? defaultClock;

  const nativePostMessage = proto.postMessage;
  function tappedPostMessage(this: MessagePort, ...args: unknown[]): void {
    if (args[0] === null) {
      if (schedulerPort !== this) {
        schedulerPort = this;
        pairSchedulerChannel(this, scope);
      }
      lastPostedAt = clock();
    }
    (nativePostMessage as unknown as (...a: unknown[]) => void).apply(this, args);
  }

  proto.postMessage = tappedPostMessage as unknown as MessagePort["postMessage"];
  flags[TAP_FLAG] = true;
  return true;
}

/**
 * 判定时是否记到了调度器端口——只查不发。
 * `kickScheduler()` 的单一 boolean 分不清「没端口」与「投递抛错」，观测口径要把两者拆开（前身 design §2.1 hadPort）。
 */
export function hasSchedulerPort(): boolean {
  return schedulerPort !== null;
}

export interface SchedulerDeliveryState {
  /** 是否配对到了调度器的 port1 与原处理函数。 */
  paired: boolean;
  /** 最近一次以 null 排队的时刻（performance.now 时基）。 */
  lastPostedAt: number | null;
  /** 最近一次处理函数经信道被调用的时刻。直驱不算。 */
  lastDeliveredAt: number | null;
}

export function schedulerDeliveryState(): SchedulerDeliveryState {
  return { paired: pairedPort !== null && schedulerHandler !== null, lastPostedAt, lastDeliveredAt };
}

/** `since` 之后（含）信道是否投递过。 */
export function deliveredSince(state: SchedulerDeliveryState, since: number): boolean {
  return state.lastDeliveredAt !== null && state.lastDeliveredAt >= since;
}

/** 「最后一次排队之后再没投递」已持续的毫秒；投递不早于排队为 0；未配对或从未排队为 null。 */
export function pendingMessageMs(state: SchedulerDeliveryState, now: number): number | null {
  if (!state.paired || state.lastPostedAt === null) return null;
  if (state.lastDeliveredAt !== null && state.lastDeliveredAt >= state.lastPostedAt) return 0;
  return Math.max(0, Math.round(now - state.lastPostedAt));
}

/**
 * 给调度器补发一拍。返回是否真的补出去了（没记到端口、或投递抛错都算没补成）。
 *
 * 只在**确认停摆后**调用（见 `components/SchedulerWatchdog.tsx`）：调度器没死时这一拍是纯空转，
 * 但也没必要平白多跑。
 */
export function kickScheduler(): boolean {
  const port = schedulerPort;
  if (!port) return false;
  try {
    port.postMessage(null);
    return true;
  } catch {
    return false;
  }
}

/**
 * 绕过信道直接调一次调度器的处理函数（排进宏任务）。返回是否排上了（未配对为 false）。
 *
 * 安全性同补拍：处理函数首行判「消息循环开关没开就什么都不做」，任务队列幂等；在宏任务里调不存在重入；
 * 迟到的原消息再来至多空转。调的是**原处理函数**，所以不会刷新 `lastDeliveredAt`。
 */
export function driveSchedulerDirectly(
  schedule: (task: () => void) => void = (task) => {
    setTimeout(task, 0);
  },
): boolean {
  const port = pairedPort;
  const handler = schedulerHandler;
  if (!port || !handler) return false;
  schedule(() => {
    try {
      handler.call(port, { data: null } as MessageEvent);
    } catch {
      // 直驱失败等价于没救成，由宽限结束时的 recovered 体现
    }
  });
  return true;
}

/** 仅供测试：忘掉记住的端口与送达状态，免得用例之间互相串。 */
export function resetSchedulerPortTap(): void {
  schedulerPort = null;
  pairedPort = null;
  schedulerHandler = null;
  originalHandlers = new WeakMap();
  lastPostedAt = null;
  lastDeliveredAt = null;
  clock = defaultClock;
}
