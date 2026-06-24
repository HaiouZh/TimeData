import type { ComponentPropsWithoutRef, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { vi } from "vitest";

export interface MockReactFlowNode {
  id: string;
  type?: string;
  data?: Record<string, unknown> & {
    node?: unknown;
  };
}

export interface MockReactFlowEdge {
  id: string;
  source?: string;
  target?: string;
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
  nodeOrigin?: [number, number];
  proOptions?: { hideAttribution?: boolean };
  nodesDraggable?: boolean;
  onNodeClick?: (event: ReactMouseEvent<HTMLButtonElement>, node: MockReactFlowNode) => void;
  onEdgeClick?: (event: ReactMouseEvent<HTMLButtonElement>, edge: MockReactFlowEdge) => void;
  onPaneClick?: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onConnect?: (connection: MockConnection) => void;
  onMoveEnd?: (event: MouseEvent | TouchEvent | null, viewport: MockViewport) => void;
}

export interface MockStoreState {
  transform: [number, number, number];
}

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

const fitView = vi.fn<(_options?: unknown) => Promise<boolean>>(() => Promise.resolve(true));
const setViewport = vi.fn<(viewport: MockViewport) => Promise<boolean>>(() => Promise.resolve(true));
const getViewport = vi.fn<() => MockViewport>(() => DEFAULT_VIEWPORT);
const reactFlowInstance = { fitView, setViewport, getViewport };

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

export function ReactFlow({
  nodes = [],
  edges = [],
  children,
  onNodeClick,
  onEdgeClick,
  onPaneClick,
  onConnect,
  nodeOrigin,
  proOptions,
  nodesDraggable,
  ...props
}: MockReactFlowProps) {
  return (
    <div
      {...props}
      data-rf="true"
      data-node-origin={nodeOrigin ? nodeOrigin.join(",") : ""}
      data-hide-attribution={proOptions?.hideAttribution ? "true" : "false"}
      data-nodes-draggable={nodesDraggable ? "true" : "false"}
      onClick={onPaneClick}
    >
      <div data-rf-nodes="true">
        {nodes.map((node) => (
          <button
            key={node.id}
            type="button"
            data-node-id={node.id}
            data-node-kind={nodeKind(node)}
            onClick={(event) => {
              event.stopPropagation();
              onNodeClick?.(event, node);
            }}
          >
            {nodeTitle(node)}
          </button>
        ))}
      </div>

      <div data-rf-edges="true">
        {edges.map((edge) => (
          <button
            key={edge.id}
            type="button"
            data-edge-id={edge.id}
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
          onConnect?.(DEFAULT_CONNECTION);
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
  ...props
}: ComponentPropsWithoutRef<"div"> & { type?: string; position?: string }) {
  return <div {...props} data-rf-handle="true" data-handle-type={type} data-handle-position={position} />;
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

  return [`M${sourceX},${sourceY} C${labelX},${sourceY} ${labelX},${targetY} ${targetX},${targetY}`, labelX, labelY, offsetX, offsetY];
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

export function resetReactFlowMock() {
  fitView.mockClear();
  setViewport.mockClear();
  getViewport.mockClear();
}

export function getReactFlowMock() {
  return reactFlowInstance;
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
