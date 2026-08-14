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
 * 只认 `postMessage(null)` 这一形态——那是调度器的调用签名（`schedulerCallShape.test.ts`
 * 直接读 `scheduler` 产物钉住它，React 升级改了形态会红）。不按形态过滤就会把页面里别的
 * MessageChannel 使用方（如 workbox）记进来，补拍补到无关端口上。
 */
let schedulerPort: MessagePort | null = null;

/** 打在已挂钩原型上的幂等标记。绑在对象而非模块变量，重复安装与测试隔离都靠它。 */
const TAP_FLAG = "__timedataSchedulerPortTap";

interface MessagePortScope {
  MessagePort?: typeof MessagePort;
}

/**
 * 在 `MessagePort.prototype.postMessage` 上挂钩，记录调度器用的端口。幂等，返回本次是否真的装上了。
 *
 * 开销是每次 `postMessage` 多一次 `=== null` 比较和一次赋值；不改变任何投递行为。
 * 安装时机只需早于死锁发生，`main.tsx` 模块体里调用即可（React 首次调度在那之后）。
 */
export function installSchedulerPortTap(scope: MessagePortScope = globalThis): boolean {
  const proto = scope.MessagePort?.prototype;
  if (!proto) return false;

  const flags = proto as unknown as Record<string, unknown>;
  if (flags[TAP_FLAG] === true) return false;

  const nativePostMessage = proto.postMessage;
  function tappedPostMessage(this: MessagePort, ...args: unknown[]): void {
    if (args[0] === null) schedulerPort = this;
    (nativePostMessage as unknown as (...a: unknown[]) => void).apply(this, args);
  }

  proto.postMessage = tappedPostMessage as unknown as MessagePort["postMessage"];
  flags[TAP_FLAG] = true;
  return true;
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

/** 仅供测试：忘掉记住的端口，免得用例之间互相串。 */
export function resetSchedulerPortTap(): void {
  schedulerPort = null;
}
