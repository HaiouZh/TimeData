import type { ReactElement, SVGProps } from "react";

// @phosphor-icons/react 的测试替身。真库是个巨型 barrel（全量图标），在 vitest 里冷加载实测
// 11.94s，而全仓有 112 个测试文件可达它——isolate:true 下每文件重付一次，是 import 耗时的最大单点。
// 本替身只提供项目实际用到的 62 个具名图标，行为上保留 Icon.tsx 依赖的契约：
// 渲染 <svg>、透传 aria-label / role / aria-hidden / className，吞掉 phosphor 专有的
// size / weight / color / mirrored（它们不是合法 DOM 属性，透传会触发 React 警告）。
// 由 vitest.config.ts 的 resolve.alias 挂载，只作用于测试，不影响 vite build。
// 新增图标后若测试报 "No X export"，把名字补进本文件末尾的清单即可。

export type IconWeight = "thin" | "light" | "regular" | "bold" | "fill" | "duotone";

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "ref"> {
  size?: number | string;
  weight?: IconWeight;
  color?: string;
  mirrored?: boolean;
}

export type Icon = (props: IconProps) => ReactElement;

function glyph(name: string): Icon {
  function Glyph({ size = 16, weight: _weight, color: _color, mirrored: _mirrored, ...rest }: IconProps) {
    return <svg data-icon={name} width={size} height={size} {...rest} />;
  }
  Glyph.displayName = `Stub(${name})`;
  return Glyph;
}

export const Alarm = glyph("Alarm");
export const ArrowCounterClockwise = glyph("ArrowCounterClockwise");
export const ArrowDown = glyph("ArrowDown");
export const ArrowLeft = glyph("ArrowLeft");
export const ArrowRight = glyph("ArrowRight");
export const ArrowSquareOut = glyph("ArrowSquareOut");
export const ArrowUp = glyph("ArrowUp");
export const ArrowsClockwise = glyph("ArrowsClockwise");
export const ArrowsInSimple = glyph("ArrowsInSimple");
export const ArrowsOutSimple = glyph("ArrowsOutSimple");
export const BookOpen = glyph("BookOpen");
export const CalendarBlank = glyph("CalendarBlank");
export const Cards = glyph("Cards");
export const CaretDown = glyph("CaretDown");
export const CaretLeft = glyph("CaretLeft");
export const CaretRight = glyph("CaretRight");
export const ChartBar = glyph("ChartBar");
export const ChartLine = glyph("ChartLine");
export const Check = glyph("Check");
export const CheckCircle = glyph("CheckCircle");
export const Clock = glyph("Clock");
export const ClockCounterClockwise = glyph("ClockCounterClockwise");
export const Cloud = glyph("Cloud");
export const CornersOut = glyph("CornersOut");
export const Crosshair = glyph("Crosshair");
export const Database = glyph("Database");
export const Desktop = glyph("Desktop");
export const DeviceMobile = glyph("DeviceMobile");
export const DotOutline = glyph("DotOutline");
export const DotsSixVertical = glyph("DotsSixVertical");
export const DotsThree = glyph("DotsThree");
export const Folder = glyph("Folder");
export const GearSix = glyph("GearSix");
export const GitBranch = glyph("GitBranch");
export const HandGrabbing = glyph("HandGrabbing");
export const HardDrives = glyph("HardDrives");
export const LinkSimple = glyph("LinkSimple");
export const ListChecks = glyph("ListChecks");
export const Lock = glyph("Lock");
export const MagnifyingGlass = glyph("MagnifyingGlass");
export const Minus = glyph("Minus");
export const Moon = glyph("Moon");
export const NotePencil = glyph("NotePencil");
export const PencilSimple = glyph("PencilSimple");
export const Planet = glyph("Planet");
export const Plus = glyph("Plus");
export const PushPin = glyph("PushPin");
export const Repeat = glyph("Repeat");
export const SidebarSimple = glyph("SidebarSimple");
export const SignOut = glyph("SignOut");
export const Signpost = glyph("Signpost");
export const Sparkle = glyph("Sparkle");
export const SquaresFour = glyph("SquaresFour");
export const Steps = glyph("Steps");
export const Sun = glyph("Sun");
export const Tag = glyph("Tag");
export const Target = glyph("Target");
export const Timer = glyph("Timer");
export const Trash = glyph("Trash");
export const Tray = glyph("Tray");
export const WarningCircle = glyph("WarningCircle");
export const X = glyph("X");
