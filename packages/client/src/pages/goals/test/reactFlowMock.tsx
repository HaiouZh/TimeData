import type { ComponentPropsWithoutRef, ComponentType, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { vi } from "vitest";

export interface MockReactFlowNode {
  id: string;
  type?: string;
  position?: { x: number; y: number };
  measured?: { width?: number; height?: number };
  draggable?: boolean;
  selected?: boolean;
  data?: Record<string, unknown> & {
    node?: unknown;
  };
}

export interface MockReactFlowEdge {
  id: string;
  type?: string;
  source?: string;
  sourceHandle?: string | null;
  style?: Record<string, unknown>;
  target?: string;
  targetHandle?: string | null;
  data?: Record<string, unknown>;
}

export interface MockConnection {
  source: string;
  target: string;
}

type FlowRootProps = Omit<ComponentPropsWithoutRef<"div">, "children" | "onClick">;

export interface MockReactFlowProps extends FlowRootProps {
  nodes?: MockReactFlowNode[];
  edges?: MockReactFlowEdge[];
  children?: ReactNode;
  nodeTypes?: Record<
    string,
    ComponentType<{ data: MockReactFlowNode["data"]; selected?: boolean; isConnectable?: boolean }>
  >;
  edgeTypes?: Record<string, ComponentType<Record<string, unknown>>>;
  nodeOrigin?: [number, number];
  proOptions?: { hideAttribution?: boolean };
  nodesDraggable?: boolean;
  nodesConnectable?: boolean;
  elementsSelectable?: boolean;
  onNodesChange?: (changes: MockNodeChange[]) => void;
  onNodeClick?: (event: ReactMouseEvent<HTMLButtonElement>, node: MockReactFlowNode) => void;
  onNodeDoubleClick?: (event: ReactMouseEvent<HTMLButtonElement>, node: MockReactFlowNode) => void;
  onNodeDrag?: (event: ReactMouseEvent<HTMLButtonElement>, node: MockReactFlowNode) => void;
  onNodeDragStop?: (event: ReactMouseEvent<HTMLButtonElement>, node: MockReactFlowNode) => void;
  onEdgeClick?: (event: ReactMouseEvent<HTMLButtonElement>, edge: MockReactFlowEdge) => void;
  onPaneClick?: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onConnect?: (connection: MockConnection) => void;
  onMoveEnd?: (event: MouseEvent | TouchEvent | null, viewport: MockViewport) => void;
}

export interface MockStoreState {
  transform: [number, number, number];
}

export type MockNodeChange =
  | { id: string; type: "position"; position?: { x: number; y: number } }
  | { id: string; type: "select"; selected: boolean }
  | { id: string; type: "remove" };

export interface MockViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface MockBezierPathParams {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
}

const DEFAULT_CONNECTION: MockConnection = { source: "task:t1", target: "task:t2" };
const STORE_STATE: MockStoreState = { transform: [0, 0, 1] };
const DEFAULT_VIEWPORT: MockViewport = { x: 0, y: 0, zoom: 1 };

const renderedNodes: MockReactFlowNode[][] = [];
const fitViewRenderedNodeCounts: number[] = [];
const fitView = vi.fn<(_options?: unknown) => Promise<boolean>>(() => {
  fitViewRenderedNodeCounts.push(renderedNodes[renderedNodes.length - 1]?.length ?? 0);
  return Promise.resolve(true);
});
const setViewport = vi.fn<(viewport: MockViewport) => Promise<boolean>>(() => Promise.resolve(true));
const getViewport = vi.fn<() => MockViewport>(() => DEFAULT_VIEWPORT);
const screenToFlowPosition = vi.fn<(position: { x: number; y: number }) => { x: number; y: number }>((position) => ({
  x: position.x,
  y: position.y,
}));
let latestOnMoveEnd: MockReactFlowProps["onMoveEnd"] | undefined;
let latestOnNodesChange: MockReactFlowProps["onNodesChange"] | undefined;
let nextConnection: MockConnection | null = null;
const getNode = vi.fn<(id: string) => (MockReactFlowNode & { measured?: { width?: number; height?: number } }) | undefined>(
  (id) => {
    const node = renderedNodes[renderedNodes.length - 1]?.find((item) => item.id === id);
    if (!node) return undefined;
    const measured = node.measured ?? (node.type === "goal-star" ? { width: 80, height: 60 } : { width: 180, height: 56 });
    return { ...node, measured };
  },
);
const reactFlowInstance = { fitView, setViewport, getViewport, screenToFlowPosition, getNode };

function readNodePayload(node: MockReactFlowNode): { kind?: string; title?: string } {
  const payload = node.data?.node;
  if (typeof payload !== "object" || payload === null) return {};

  const record = payload as Record<string, unknown>;
  return {
    kind: typeof record.kind === "string" ? record.kind : undefined,
    title: typeof record.title === "string" ? record.title : undefined,
  };
}

function nodeKind(node: MockReactFlowNode): string {
  return readNodePayload(node).kind ?? node.type ?? "";
}

function nodeTitle(node: MockReactFlowNode): string {
  return readNodePayload(node).title ?? node.id;
}

function nodePosition(node: MockReactFlowNode): { x: number; y: number } {
  return node.position ?? { x: 0, y: 0 };
}

function nextDragNode(node: MockReactFlowNode): MockReactFlowNode {
  const position = nodePosition(node);
  return { ...node, position: { x: position.x + 10, y: position.y + 20 } };
}

function canDragNode(node: MockReactFlowNode, nodesDraggable?: boolean): boolean {
  return nodesDraggable === true && node.draggable !== false;
}

export function ReactFlow({
  nodes = [],
  edges = [],
  children,
  onNodesChange,
  onNodeClick,
  onNodeDoubleClick,
  onNodeDrag,
  onNodeDragStop,
  onEdgeClick,
  onPaneClick,
  onConnect,
  onMoveEnd,
  nodeTypes,
  edgeTypes,
  nodeOrigin,
  proOptions,
  nodesDraggable,
  nodesConnectable,
  elementsSelectable: _elementsSelectable,
  ...props
}: MockReactFlowProps) {
  renderedNodes.push(nodes);
  latestOnMoveEnd = onMoveEnd;
  latestOnNodesChange = onNodesChange;

  return (
    <div
      {...props}
      data-rf="true"
      data-node-origin={nodeOrigin ? nodeOrigin.join(",") : ""}
      data-edge-types={edgeTypes ? Object.keys(edgeTypes).join(",") : ""}
      data-hide-attribution={proOptions?.hideAttribution ? "true" : "false"}
      data-nodes-draggable={nodesDraggable ? "true" : "false"}
      onClick={onPaneClick}
    >
      <div data-rf-nodes="true">
        {nodes.map((node) => (
          <span key={node.id} data-node-wrap-id={node.id}>
            <button
              type="button"
              data-node-id={node.id}
              data-node-kind={nodeKind(node)}
              data-node-x={String(nodePosition(node).x)}
              data-node-y={String(nodePosition(node).y)}
              data-node-draggable={canDragNode(node, nodesDraggable) ? "true" : "false"}
              onClick={(event) => {
                event.stopPropagation();
                onNodeClick?.(event, node);
              }}
              onDoubleClick={(event) => {
                event.stopPropagation();
                onNodeDoubleClick?.(event, node);
              }}
            >
              {nodeTitle(node)}
            </button>
            {node.type && nodeTypes?.[node.type] ? (
              <span data-node-render-id={node.id}>
                {(() => {
                  const NodeComponent = nodeTypes[node.type];
                  return (
                    <NodeComponent
                      data={node.data}
                      selected={node.selected === true}
                      isConnectable={nodesConnectable === true}
                    />
                  );
                })()}
              </span>
            ) : null}
            <button
              type="button"
              data-rf-drag-node-id={node.id}
              onClick={(event) => {
                event.stopPropagation();
                if (canDragNode(node, nodesDraggable)) {
                  const nextNode = nextDragNode(node);
                  onNodesChange?.([{ id: node.id, type: "position", position: nextNode.position }]);
                  onNodeDrag?.(event, nextNode);
                }
              }}
            >
              drag {node.id}
            </button>
            <button
              type="button"
              data-rf-drag-stop-node-id={node.id}
              onClick={(event) => {
                event.stopPropagation();
                if (canDragNode(node, nodesDraggable)) {
                  const nextNode = nextDragNode(node);
                  onNodesChange?.([{ id: node.id, type: "position", position: nextNode.position }]);
                  onNodeDragStop?.(event, nextNode);
                }
              }}
            >
              drag stop {node.id}
            </button>
          </span>
        ))}
      </div>

      <div data-rf-edges="true">
        {edges.map((edge) => (
          <button
            key={edge.id}
            type="button"
            data-edge-id={edge.id}
            data-edge-type={edge.type ?? ""}
            data-edge-style-opacity={String(edge.style?.opacity ?? "")}
            data-edge-source-handle={edge.sourceHandle ?? ""}
            data-edge-target-handle={edge.targetHandle ?? ""}
            onClick={(event) => {
              event.stopPropagation();
              onEdgeClick?.(event, edge);
            }}
          >
            {edge.id}
          </button>
        ))}
      </div>

      <button
        type="button"
        data-rf-connect="true"
        onClick={(event) => {
          event.stopPropagation();
          onConnect?.(nextConnection ?? DEFAULT_CONNECTION);
        }}
      >
        connect
      </button>

      {children}
    </div>
  );
}

export function ReactFlowProvider({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}

export function Background(props: ComponentPropsWithoutRef<"div">) {
  return <div {...props} data-rf-background="true" />;
}

export function Handle({
  type,
  position,
  isConnectable,
  ...props
}: Omit<ComponentPropsWithoutRef<"div">, "children"> & { type?: string; position?: string; isConnectable?: boolean }) {
  return (
    <div
      {...props}
      data-rf-handle="true"
      data-handle-type={type}
      data-handle-position={position}
      data-handle-connectable={isConnectable ? "true" : "false"}
    />
  );
}

export function BaseEdge({
  id,
  path = "",
  label,
  ...props
}: Omit<ComponentPropsWithoutRef<"path">, "d"> & { id?: string; path?: string; label?: ReactNode }) {
  return (
    <g data-rf-base-edge="true" data-edge-id={id}>
      <path {...props} d={path} />
      {label}
    </g>
  );
}

export function getBezierPath({
  sourceX,
  sourceY,
  targetX,
  targetY,
}: MockBezierPathParams): [string, number, number, number, number] {
  const labelX = (sourceX + targetX) / 2;
  const labelY = (sourceY + targetY) / 2;
  const offsetX = Math.abs(targetX - sourceX) / 2;
  const offsetY = Math.abs(targetY - sourceY) / 2;

  return [
    `M${sourceX},${sourceY} C${labelX},${sourceY} ${labelX},${targetY} ${targetX},${targetY}`,
    labelX,
    labelY,
    offsetX,
    offsetY,
  ];
}

export function useStore<StateSlice>(selector: (state: MockStoreState) => StateSlice): StateSlice {
  return selector(STORE_STATE);
}

export function useReactFlow() {
  return reactFlowInstance;
}

export function useNodesInitialized() {
  return true;
}

export function applyNodeChanges(changes: MockNodeChange[], nodes: MockReactFlowNode[]): MockReactFlowNode[] {
  return changes.reduce((current, change) => {
    if (change.type === "remove") return current.filter((node) => node.id !== change.id);
    return current.map((node) => {
      if (node.id !== change.id) return node;
      if (change.type === "position" && change.position) return { ...node, position: change.position };
      if (change.type === "select") return { ...node, selected: change.selected };
      return node;
    });
  }, nodes);
}

export function resetReactFlowMock() {
  fitView.mockClear();
  setViewport.mockClear();
  getViewport.mockClear();
  screenToFlowPosition.mockClear();
  getNode.mockClear();
  renderedNodes.length = 0;
  fitViewRenderedNodeCounts.length = 0;
  latestOnMoveEnd = undefined;
  latestOnNodesChange = undefined;
  nextConnection = null;
}

export function getReactFlowMock() {
  return {
    ...reactFlowInstance,
    renderedNodes,
    fitViewRenderedNodeCounts,
    fireMoveEnd: (viewport: MockViewport) => latestOnMoveEnd?.(null, viewport),
    fireNodesChange: (changes: MockNodeChange[]) => latestOnNodesChange?.(changes),
    setNextConnection: (connection: MockConnection | null) => {
      nextConnection = connection;
    },
  };
}

export const Position = {
  Left: "left",
  Top: "top",
  Right: "right",
  Bottom: "bottom",
} as const;

export const MarkerType = {
  Arrow: "arrow",
  ArrowClosed: "arrowclosed",
} as const;

export default ReactFlow;
