// 内联 style.zIndex 用；与 index.css 的 --z-* 同步（单一事实源在 CSS，本文件是镜像）。
// 守一致性：lib/zLayers.test.ts 比对每个键值与 index.css 的 --z-* 阶梯。
export const Z = { sticky: 20, dropdown: 30, backdrop: 40, modal: 50, top: 70 } as const;
