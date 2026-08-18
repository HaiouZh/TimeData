import { useCallback, useEffect, useRef } from "react";
import {
  canRestoreScroll,
  isRestoreExpired,
  readScrollTop,
  writeScrollTop,
} from "../lib/recovery/scrollRestore.ts";
import { useAppHideFlush } from "./useAppHideFlush.ts";

/** 滚动中的落盘节流。切后台那一下才是主写入点（进程是在后台被杀的），这里只兜前台被杀。 */
const SCROLL_WRITE_THROTTLE_MS = 500;

/**
 * 一次页面加载只恢复一次。
 *
 * 恢复的语义是「页面从零重建后回到原位」，不是「每次进这一页都跳回上次的位置」——
 * 主动导航到新页本就该从顶部开始。而 iOS 的保留式页面栈里，返回手势让保留层升为活跃时
 * 它的 DOM 滚动位置**本来就还活着**（那正是页面栈的价值），此时再按存档恢复只会把活的位置
 * 覆盖成更旧的存档值。两种情况都靠这一个模块级开关挡住。
 */
let restoredThisLoad = false;

/**
 * 记住并恢复滚动容器的位置，专治 iOS 回收 WKWebView 渲染进程后的整页重载。
 *
 * `pathname` **必须由调用方传入**，不能在这里 `useLocation()`：iOS 保留式页面栈的每一层
 * 渲染的是自己那一层的 location，而 `useLocation()` 给的是全局当前 location——保留层会因此
 * 把自己的滚动位置写到当前页的键下。
 *
 * `active` 用于同一套页面栈：保留层不写，否则它会覆盖掉当前页的记录。
 */
export function useScrollRestore(active: boolean, pathname: string) {
  const ref = useRef<HTMLElement | null>(null);
  const lastWriteRef = useRef(0);
  // 切后台的回调只注册一次，读 ref 拿最新值，避免每次导航重挂监听。
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
  const activeRef = useRef(active);
  activeRef.current = active;

  const flush = useCallback(() => {
    const el = ref.current;
    if (!el || !activeRef.current) return;
    writeScrollTop(pathnameRef.current, el.scrollTop);
  }, []);

  useAppHideFlush(flush);

  const onScroll = useCallback(() => {
    const now = Date.now();
    if (now - lastWriteRef.current < SCROLL_WRITE_THROTTLE_MS) return;
    lastWriteRef.current = now;
    flush();
  }, [flush]);

  useEffect(() => {
    // 依赖恒空、值全走 ref：恢复只认「本次页面加载的首个活跃滚动容器」这一个时机，
    // 挂载之后 active / pathname 再怎么变都不该重新触发（理由见 restoredThisLoad 的注释）。
    if (!activeRef.current || restoredThisLoad) return;
    restoredThisLoad = true;

    const target = readScrollTop(pathnameRef.current);
    if (target === null || target === 0) return;

    const startedAt = Date.now();
    let frame = 0;
    // 列表数据是异步到的，恢复瞬间内容高度往往不够。每帧试一次，够了就滚、超时就放弃。
    const tryRestore = () => {
      const node = ref.current;
      if (!node) return;
      if (canRestoreScroll(target, node.scrollHeight, node.clientHeight)) {
        node.scrollTop = target;
        return;
      }
      if (isRestoreExpired(startedAt, Date.now())) return;
      frame = requestAnimationFrame(tryRestore);
    };
    frame = requestAnimationFrame(tryRestore);
    return () => cancelAnimationFrame(frame);
  }, []);

  return { ref, onScroll };
}
