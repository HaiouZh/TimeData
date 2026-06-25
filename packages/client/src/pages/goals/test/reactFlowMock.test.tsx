// @vitest-environment jsdom
import type { ComponentType, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { click, doubleClick, renderDom, unmount } from "../../../test/domHarness.js";

interface FlowNode {
  id: string;
  type?: string;
  data: {
    node?: {
      kind?: string;
      title?: string;
    };
  };
}

interface FlowEdge {
  id: string;
  source: string;
  target: string;
}

interface FlowConnection {
  source: string;
  target: string;
}

interface FlowProps {
  nodes?: FlowNode[];
  edges?: FlowEdge[];
  children?: ReactNode;
  onNodeClick?: (event: ReactMouseEvent, node: FlowNode) => void;
  onNodeDoubleClick?: (event: ReactMouseEvent, node: FlowNode) => void;
  onEdgeClick?: (event: ReactMouseEvent, edge: FlowEdge) => void;
  onPaneClick?: (event: ReactMouseEvent) => void;
  onConnect?: (connection: FlowConnection) => void;
}

interface MockStoreState {
  transform: [number, number, number];
}

interface MockViewport {
  x: number;
  y: number;
  zoom: number;
}

interface MockModule {
  ReactFlow?: ComponentType<FlowProps>;
  ReactFlowProvider?: ComponentType<{ children?: ReactNode }>;
  Background?: ComponentType;
  Handle?: ComponentType<{ type?: string; position?: string }>;
  BaseEdge?: ComponentType<{ id?: string; path?: string }>;
  getBezierPath?: (params: { sourceX: number; sourceY: number; targetX: number; targetY: number }) => [
    string,
    number,
    number,
    number,
    number,
  ];
  useStore?: <StateSlice>(selector: (state: MockStoreState) => StateSlice) => StateSlice;
  useReactFlow?: () => {
    fitView: ReturnType<typeof vi.fn>;
    setViewport: ReturnType<typeof vi.fn>;
    getViewport: ReturnType<typeof vi.fn<() => MockViewport>>;
  };
  getReactFlowMock?: () => {
    fireMoveEnd: (viewport: MockViewport) => void;
  };
  Position?: Record<string, string>;
  MarkerType?: Record<string, string>;
}

async function loadMock(): Promise<MockModule> {
  return import("./reactFlowMock.js").catch(() => ({}));
}

describe("reactFlowMock", () => {
  it("导出 React Flow 测试 mock 需要的组件、hook 和常量", async () => {
    const mock = await loadMock();

    expect(mock.ReactFlow).toBeTypeOf("function");
    expect(mock.ReactFlowProvider).toBeTypeOf("function");
    expect(mock.Background).toBeTypeOf("function");
    expect(mock.Handle).toBeTypeOf("function");
    expect(mock.BaseEdge).toBeTypeOf("function");
    expect(mock.getBezierPath).toBeTypeOf("function");
    expect(mock.useStore).toBeTypeOf("function");
    expect(mock.useReactFlow).toBeTypeOf("function");
    expect(mock.Position).toMatchObject({ Left: "left", Right: "right", Top: "top", Bottom: "bottom" });
    expect(mock.MarkerType).toMatchObject({ Arrow: "arrow", ArrowClosed: "arrowclosed" });
  });

  it("ReactFlow 渲染节点、边、pane 和 connect 测试入口并转发回调", async () => {
    const mock = await loadMock();
    expect(mock.ReactFlow).toBeTypeOf("function");
    const ReactFlow = mock.ReactFlow as ComponentType<FlowProps>;
    const nodes: FlowNode[] = [
      { id: "task:t1", type: "task", data: { node: { kind: "task", title: "任务一" } } },
      { id: "task:t2", data: { node: { kind: "track", title: "任务二" } } },
    ];
    const edges: FlowEdge[] = [{ id: "edge:1", source: "task:t1", target: "task:t2" }];
    const onNodeClick = vi.fn<(event: ReactMouseEvent, node: FlowNode) => void>();
    const onNodeDoubleClick = vi.fn<(event: ReactMouseEvent, node: FlowNode) => void>();
    const onEdgeClick = vi.fn<(event: ReactMouseEvent, edge: FlowEdge) => void>();
    const onPaneClick = vi.fn<(event: ReactMouseEvent) => void>();
    const onConnect = vi.fn<(connection: FlowConnection) => void>();
    const { host, root } = await renderDom(
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onEdgeClick={onEdgeClick}
        onPaneClick={onPaneClick}
        onConnect={onConnect}
      />,
    );

    expect(host.querySelector("[data-rf='true']")).not.toBeNull();
    expect(host.querySelector("[data-node-id='task:t1']")?.getAttribute("data-node-kind")).toBe("task");
    expect(host.querySelector("[data-node-id='task:t1']")?.textContent).toBe("任务一");
    expect(host.querySelector("[data-node-id='task:t2']")?.getAttribute("data-node-kind")).toBe("track");
    expect(host.querySelector("[data-edge-id='edge:1']")).not.toBeNull();

    await click(host.querySelector("[data-node-id='task:t1']"));
    expect(onNodeClick).toHaveBeenCalledWith(expect.any(Object), nodes[0]);
    expect(onPaneClick).not.toHaveBeenCalled();

    await doubleClick(host.querySelector("[data-node-id='task:t2']"));
    expect(onNodeDoubleClick).toHaveBeenCalledWith(expect.any(Object), nodes[1]);
    expect(onPaneClick).not.toHaveBeenCalled();

    await click(host.querySelector("[data-edge-id='edge:1']"));
    expect(onEdgeClick).toHaveBeenCalledWith(expect.any(Object), edges[0]);
    expect(onPaneClick).not.toHaveBeenCalled();

    await click(host.querySelector("[data-rf-connect='true']"));
    expect(onConnect).toHaveBeenCalledWith({ source: "task:t1", target: "task:t2" });
    expect(onPaneClick).not.toHaveBeenCalled();

    await click(host.querySelector("[data-rf='true']"));
    expect(onPaneClick).toHaveBeenCalledTimes(1);
    await unmount(root);
  });

  it("hook mock 返回稳定 viewport helper 和 zoom=1 的 store selector", async () => {
    const mock = await loadMock();
    expect(mock.useStore).toBeTypeOf("function");
    expect(mock.useReactFlow).toBeTypeOf("function");

    expect(mock.useStore?.((state) => state.transform[2])).toBe(1);
    const first = mock.useReactFlow?.();
    const second = mock.useReactFlow?.();

    expect(first?.fitView).toBe(second?.fitView);
    expect(first?.setViewport).toBe(second?.setViewport);
    expect(first?.getViewport).toBe(second?.getViewport);
    expect(first?.getViewport()).toEqual({ x: 0, y: 0, zoom: 1 });
  });

  it("exposes a helper for driving onMoveEnd in canvas tests", async () => {
    const mock = await loadMock();
    expect(mock.ReactFlow).toBeTypeOf("function");
    expect(mock.getReactFlowMock).toBeTypeOf("function");
    const ReactFlow = mock.ReactFlow as ComponentType<FlowProps>;
    const onMoveEnd = vi.fn<(event: MouseEvent | TouchEvent | null, viewport: MockViewport) => void>();
    const { root } = await renderDom(<ReactFlow onMoveEnd={onMoveEnd} />);

    mock.getReactFlowMock?.().fireMoveEnd({ x: 1, y: 2, zoom: 0.8 });

    expect(onMoveEnd).toHaveBeenCalledWith(null, { x: 1, y: 2, zoom: 0.8 });
    await unmount(root);
  });
});
