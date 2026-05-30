// @vitest-environment jsdom
import { act, createElement } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { CategoryCompositionBars, type CompositionParent } from "./InsightCharts.tsx";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("recharts", () => ({
  PieChart: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
  Pie: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
  Cell: () => createElement("span"),
  Tooltip: () => createElement("span"),
  ResponsiveContainer: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
}));

const sampleParents: CompositionParent[] = [
  {
    id: "work",
    name: "工作",
    totalHours: 3,
    sharePct: 60,
    color: "#3b82f6",
    children: [
      { id: "coding", name: "编码", min: 120, color: "#60a5fa" },
      { id: "meeting", name: "会议", min: 60, color: "#93c5fd" },
    ],
  },
];

describe("CategoryCompositionBars", () => {
  it("展示父分类汇总，点击后展开子分类明细", async () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    await act(async () => {
      root.render(createElement(CategoryCompositionBars, { parents: sampleParents }));
    });

    expect(host.textContent).toContain("工作");
    expect(host.textContent).toContain("3.0h · 60%");
    expect(host.textContent).not.toContain("编码");

    const header = host.querySelector('button[aria-expanded="false"]') as HTMLButtonElement | null;
    await act(async () => {
      header?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(host.textContent).toContain("编码");
    expect(host.textContent).toContain("2.0h");

    await act(async () => {
      root.unmount();
    });
  });
});
