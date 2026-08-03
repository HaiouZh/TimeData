import { createContext, useContext } from "react";

/**
 * 「本层是不是用户当前正看着的那一层」。
 *
 * 只有 iOS 的 `KeptRouteStack` 会给出 `false`：保留层在屏幕上完全看不见（visibility:hidden +
 * inert），但它的组件树**还活着**——state 还在、effect 还在跑、往全局注册过的东西还在册。
 * 凡是「注册到全局、且注册后不再自查可见性」的钩子，都必须读这面旗子把自己关掉，
 * 否则一个用户已经离开的页面会替当前页做主（首例：useUnsavedChangesGuard 的 useBlocker
 * 会用隐藏日记页的脏态，去拦速记页的导航，凭空弹出「放弃未保存的修改？」）。
 *
 * **缺省必须是 `true`。** 非 iOS 平台压根不渲染 `KeptRouteStack`，子树拿不到任何 Provider，
 * 只能吃这个缺省值；缺省写成 `false` 会把桌面 / 安卓 / Web 的守卫一起静默关掉——
 * 那是比原缺陷更严重的功能倒退（真的会丢用户没保存的字）。
 */
export const KeptLayerActiveContext = createContext(true);

/** 读「本层是否活跃」。无 Provider（非 iOS 渲染路径）时恒为 true，见上面的缺省约定。 */
export function useIsLayerActive(): boolean {
  return useContext(KeptLayerActiveContext);
}
