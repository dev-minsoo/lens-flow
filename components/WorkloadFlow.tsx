import React, { CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { observer } from "mobx-react";
import { autorun } from "mobx";
import ReactFlow, {
  Background,
  Controls,
  Edge,
  EdgeMarker,
  EdgeProps,
  Handle,
  MarkerType,
  MiniMap,
  Node,
  Position,
  ReactFlowInstance,
  getSmoothStepPath,
} from "reactflow";
import "reactflow/dist/style.css";
import { Renderer } from "@k8slens/extensions";
import { buildWorkloadGraph } from "../graph/buildGraph";
import {
  FlowNodeData,
  GraphDirection,
  ResourceKind,
  WorkloadResources,
} from "../graph/types";
import "./WorkloadFlow.scss";

const { Spinner } = Renderer.Component;
const apiManager = Renderer.K8sApi.apiManager;
const k8sApi = Renderer.K8sApi as Record<string, unknown>;
const NODE_ORIGIN: [number, number] = [0.5, 0.5];
const FIT_VIEW_PADDING = 0.06;
const EDGE_LANE_GAP = 8;
const EDGE_HOVER_ACTIVATION_DELAY_MS = 100;
const EDGE_HOVER_CLEAR_DELAY_MS = 100;

type KubeStoreLike = {
  items: unknown[];
  loadAll(options?: { namespaces?: string[]; merge?: boolean }): Promise<unknown>;
  subscribe(): () => void;
};

type KubeObjectWithMetadata = {
  kind?: string;
  selfLink?: string;
  getName?: () => string;
  getNs?: () => string;
  metadata?: {
    name?: string;
    namespace?: string;
    selfLink?: string;
  };
};

const namespacedDetailPaths: Partial<Record<ResourceKind, string>> = {
  Ingress: "/apis/networking.k8s.io/v1/namespaces/:namespace/ingresses/:name",
  Service: "/api/v1/namespaces/:namespace/services/:name",
  Deployment: "/apis/apps/v1/namespaces/:namespace/deployments/:name",
  ReplicaSet: "/apis/apps/v1/namespaces/:namespace/replicasets/:name",
  StatefulSet: "/apis/apps/v1/namespaces/:namespace/statefulsets/:name",
  DaemonSet: "/apis/apps/v1/namespaces/:namespace/daemonsets/:name",
  Pod: "/api/v1/namespaces/:namespace/pods/:name",
  ConfigMap: "/api/v1/namespaces/:namespace/configmaps/:name",
  Secret: "/api/v1/namespaces/:namespace/secrets/:name",
  PersistentVolumeClaim: "/api/v1/namespaces/:namespace/persistentvolumeclaims/:name",
};

const CloudIcon = () => (
  <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const CloudNode = ({ data, sourcePosition }: { data: FlowNodeData; sourcePosition?: Position }) => (
  <div className="cloud-node">
    <Handle type="source" position={sourcePosition ?? Position.Right} className="workload-flow-handle" />
    <CloudIcon />
    <div className="cloud-label">{data.label}</div>
  </div>
);

const LoadBalancerNode = ({ data, sourcePosition, targetPosition }: { data: FlowNodeData; sourcePosition?: Position; targetPosition?: Position }) => (
  <div
    className={`lb-node workload-card workload-card-loadbalancer is-${data.health}`}
    title={data.extra}
  >
    <Handle type="target" position={targetPosition ?? Position.Left} className="workload-flow-handle" />
    <Handle type="source" position={sourcePosition ?? Position.Right} className="workload-flow-handle" />
    <div className="node-content">
      <div className="node-label" title={data.label}>{data.label}</div>
      <div className="node-meta">
        <span className="node-kind">Load Balancer</span>
        {data.namespace && <span className="node-namespace">{data.namespace}</span>}
      </div>
    </div>
    {data.extra && <div className="node-side" title={data.extra}>{data.extra}</div>}
  </div>
);

const CustomNode = ({ data, sourcePosition, targetPosition }: { data: FlowNodeData; sourcePosition?: Position; targetPosition?: Position }) => {
  const kindLabels: Record<string, string> = {
    ingress: "Ingress",
    service: "Service",
    deployment: "Deployment",
    replicaset: "ReplicaSet",
    statefulset: "StatefulSet",
    daemonset: "DaemonSet",
    pod: "Pod",
    configmap: "ConfigMap",
    secret: "Secret",
    persistentvolumeclaim: "PersistentVolumeClaim",
  };
  return (
    <div
      className={`custom-node nodrag workload-card workload-card-${data.type} is-${data.health}`}
      role="button"
      tabIndex={0}
      title={data.detail ?? data.extra}
      onClick={event => openResourceDetails(data, event)}
      onKeyDown={event => {
        if (event.key === "Enter" || event.key === " ") openResourceDetails(data, event);
      }}
    >
      <Handle type="target" position={targetPosition ?? Position.Left} className="workload-flow-handle" />
      <Handle type="source" position={sourcePosition ?? Position.Right} className="workload-flow-handle" />
      <div className="node-content">
        <div className="node-label" title={data.label}>{data.label}</div>
        <div className="node-meta">
          <span className="node-kind">{kindLabels[data.type] ?? data.kind}</span>
          {data.namespace && <span className="node-namespace">{data.namespace}</span>}
        </div>
      </div>
      {data.extra && <div className="node-side" title={data.extra}>{data.extra}</div>}
    </div>
  );
};

const nodeTypes = {
  custom: CustomNode,
  cloud: CloudNode,
  loadbalancer: LoadBalancerNode,
};

function edgeLaneOffset(lane: number | undefined): number {
  return (lane ?? 0) * EDGE_LANE_GAP;
}

function recolorMarkerEnd(markerEnd: EdgeMarker | string | undefined, color: string): EdgeMarker | string | undefined {
  if (!markerEnd || typeof markerEnd === "string") return markerEnd;

  return {
    ...markerEnd,
    color,
  };
}

const LaneEdge = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  data,
}: EdgeProps) => {
  const horizontal = sourcePosition === Position.Left || sourcePosition === Position.Right;
  const adjustedSourceX = horizontal ? sourceX : sourceX + edgeLaneOffset(data?.sourceLane);
  const adjustedSourceY = horizontal ? sourceY + edgeLaneOffset(data?.sourceLane) : sourceY;
  const adjustedTargetX = horizontal ? targetX : targetX + edgeLaneOffset(data?.targetLane);
  const adjustedTargetY = horizontal ? targetY + edgeLaneOffset(data?.targetLane) : targetY;
  const [path] = getSmoothStepPath({
    sourceX: adjustedSourceX,
    sourceY: adjustedSourceY,
    sourcePosition,
    targetX: adjustedTargetX,
    targetY: adjustedTargetY,
    targetPosition,
    borderRadius: 10,
    offset: 18,
  });
  const edgeState = typeof data?.edgeState === "string" ? data.edgeState : "idle";
  const edgeClassName = edgeState === "highlighted"
    ? "react-flow__edge-path is-highlighted"
    : "react-flow__edge-path";
  const edgeColor = typeof style?.stroke === "string" ? style.stroke : "#2a8af6";
  const resolvedStroke = edgeState === "highlighted" ? edgeColor : "rgba(148, 163, 184, 0.48)";
  const mergedStyle: CSSProperties = {
    ...style,
    opacity: edgeState === "dimmed" ? 0.18 : 1,
    stroke: resolvedStroke,
    strokeWidth: edgeState === "highlighted"
      ? Math.max(Number(style?.strokeWidth ?? 2.5) + 1, 3.5)
      : style?.strokeWidth,
    filter: edgeState === "highlighted"
      ? "drop-shadow(0 0 8px rgba(255,255,255,0.28))"
      : style?.filter,
    pointerEvents: "none",
  };

  return (
    <g>
      <path
        id={id}
        className={edgeClassName}
        d={path}
        markerEnd={markerEnd}
        style={mergedStyle}
        fill="none"
      />
      <path
        className="react-flow__edge-interaction workload-flow-edge-hitbox"
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={24}
        onMouseEnter={() => data?.onHoverStart?.()}
        onMouseMove={() => data?.onHoverStart?.()}
        onMouseLeave={() => data?.onHoverEnd?.()}
      />
    </g>
  );
};

const edgeTypes = {
  lane: LaneEdge,
};

function getStore(apiName: string): KubeStoreLike | undefined {
  const api = k8sApi[apiName];
  if (!api) return undefined;

  return apiManager.getStore(api as never) as KubeStoreLike | undefined;
}

type WorkloadStores = {
  namespaces?: KubeStoreLike;
  ingresses?: KubeStoreLike;
  services?: KubeStoreLike;
  deployments?: KubeStoreLike;
  pods?: KubeStoreLike;
  endpoints?: KubeStoreLike;
  statefulSets?: KubeStoreLike;
  daemonSets?: KubeStoreLike;
  replicaSets?: KubeStoreLike;
  configMaps?: KubeStoreLike;
  secrets?: KubeStoreLike;
  persistentVolumeClaims?: KubeStoreLike;
};

function resolveStores(): WorkloadStores {
  return {
    namespaces: getStore("namespaceApi") ?? getStore("namespacesApi"),
    ingresses: getStore("ingressApi"),
    services: getStore("serviceApi"),
    deployments: getStore("deploymentApi"),
    pods: getStore("podsApi") ?? getStore("podApi"),
    endpoints: getStore("endpointsApi") ?? getStore("endpointApi"),
    statefulSets: getStore("statefulSetApi") ?? getStore("statefulSetsApi"),
    daemonSets: getStore("daemonSetApi") ?? getStore("daemonSetsApi"),
    replicaSets: getStore("replicaSetApi") ?? getStore("replicaSetsApi"),
    configMaps: getStore("configMapApi") ?? getStore("configMapsApi"),
    secrets: getStore("secretApi") ?? getStore("secretsApi"),
    persistentVolumeClaims: getStore("pvcApi") ?? getStore("persistentVolumeClaimApi") ?? getStore("persistentVolumeClaimsApi"),
  };
}

function listStores(stores: WorkloadStores): KubeStoreLike[] {
  return Object.values(stores).filter((store): store is KubeStoreLike => Boolean(store));
}

function listNamespacedStores(stores: WorkloadStores): KubeStoreLike[] {
  return listStores({ ...stores, namespaces: undefined });
}

function storeItems<T>(store: KubeStoreLike | undefined): T[] {
  return (store?.items ?? []) as T[];
}

function namespacesFromStores(stores: WorkloadStores): string[] {
  const namespaces = new Set<string>();

  stores.namespaces?.items.forEach(item => {
    const getName = (item as { getName?: () => string }).getName;
    const name = typeof getName === "function"
      ? getName.call(item)
      : (item as { metadata?: { name?: string } }).metadata?.name;

    if (name) namespaces.add(name);
  });

  listStores(stores).forEach(store => {
    store.items.forEach(item => {
      const getNs = (item as { getNs?: () => string }).getNs;

      if (typeof getNs === "function") {
        const namespace = getNs.call(item);

        if (namespace) namespaces.add(namespace);
      }
    });
  });

  return [...namespaces].sort((left, right) => left.localeCompare(right));
}

function toReactFlowPosition(position: string | undefined): Position | undefined {
  switch (position) {
    case "top":
      return Position.Top;
    case "right":
      return Position.Right;
    case "bottom":
      return Position.Bottom;
    case "left":
      return Position.Left;
    default:
      return undefined;
  }
}

function normalizeKind(kind: string | undefined, fallback: ResourceKind): ResourceKind {
  switch (kind) {
    case "Ingress":
    case "Service":
    case "Deployment":
    case "ReplicaSet":
    case "StatefulSet":
    case "DaemonSet":
    case "Pod":
    case "ConfigMap":
    case "Secret":
    case "PersistentVolumeClaim":
      return kind;
    default:
      return fallback;
  }
}

function buildDetailsSelfLink(resource: KubeObjectWithMetadata | undefined, fallbackKind: ResourceKind): string | undefined {
  if (!resource) return undefined;

  const existing = resource.selfLink ?? resource.metadata?.selfLink;
  if (existing) return existing;

  const kind = normalizeKind(resource.kind, fallbackKind);
  const template = namespacedDetailPaths[kind];
  const namespace = resource.getNs?.() ?? resource.metadata?.namespace;
  const name = resource.getName?.() ?? resource.metadata?.name;

  if (!template || !namespace || !name) return undefined;

  return template
    .replace(":namespace", encodeURIComponent(namespace))
    .replace(":name", encodeURIComponent(name));
}

function openResourceDetails(data: FlowNodeData, event?: React.MouseEvent | React.KeyboardEvent): void {
  event?.stopPropagation();

  const resource = data.resource as KubeObjectWithMetadata | undefined;
  const selfLink = buildDetailsSelfLink(resource, data.detailKind ?? data.kind);

  if (selfLink) {
    Renderer.Navigation.showDetails(selfLink, false);
  }
}

function buildGraph(stores: WorkloadStores, namespaces: string[], direction: GraphDirection, visibleKinds: ResourceKind[]): { nodes: Node<FlowNodeData>[]; edges: Edge[] } {
  const resources: WorkloadResources = {
    namespaces,
    ingresses: storeItems(stores.ingresses),
    services: storeItems(stores.services),
    pods: storeItems(stores.pods),
    endpoints: storeItems(stores.endpoints),
    deployments: storeItems(stores.deployments),
    statefulSets: storeItems(stores.statefulSets),
    daemonSets: storeItems(stores.daemonSets),
    replicaSets: storeItems(stores.replicaSets),
    configMaps: storeItems(stores.configMaps),
    secrets: storeItems(stores.secrets),
    persistentVolumeClaims: storeItems(stores.persistentVolumeClaims),
  };

  const graph = buildWorkloadGraph(resources, { direction, visibleKinds });

  const nodes = graph.nodes.map(node => ({
      ...node,
      sourcePosition: toReactFlowPosition(node.sourcePosition),
      targetPosition: toReactFlowPosition(node.targetPosition),
    })) as Node<FlowNodeData>[];
  const nodesById = new Map(nodes.map(node => [node.id, node]));
  const edgeOrderingAxis = (nodeId: string): number => {
    const node = nodesById.get(nodeId);
    if (!node) return 0;

    return direction === "TB" ? node.position.x : node.position.y;
  };
  const laneOffsets = (count: number): number[] => Array.from(
    { length: count },
    (_, index) => index - (count - 1) / 2
  );
  const edges = graph.edges.map(edge => ({
      ...edge,
      type: "lane",
      markerEnd: edge.markerEnd
        ? { ...edge.markerEnd, type: MarkerType.ArrowClosed }
        : { type: MarkerType.ArrowClosed },
    })) as Edge[];

  const outgoingBySource = new Map<string, Edge[]>();
  const incomingByTarget = new Map<string, Edge[]>();

  edges.forEach(edge => {
    outgoingBySource.set(edge.source, [...(outgoingBySource.get(edge.source) ?? []), edge]);
    incomingByTarget.set(edge.target, [...(incomingByTarget.get(edge.target) ?? []), edge]);
  });

  outgoingBySource.forEach(sourceEdges => {
    const ordered = [...sourceEdges].sort((left, right) => edgeOrderingAxis(left.target) - edgeOrderingAxis(right.target));
    const lanes = laneOffsets(ordered.length);

    ordered.forEach((edge, index) => {
      edge.data = {
        ...edge.data,
        sourceLane: lanes[index],
        sourceCount: ordered.length,
      };
    });
  });

  incomingByTarget.forEach(targetEdges => {
    const ordered = [...targetEdges].sort((left, right) => edgeOrderingAxis(left.source) - edgeOrderingAxis(right.source));
    const lanes = laneOffsets(ordered.length);

    ordered.forEach((edge, index) => {
      edge.data = {
        ...edge.data,
        targetLane: lanes[index],
        targetCount: ordered.length,
      };
    });
  });

  return { nodes, edges };
}

interface WorkloadFlowProps {
  direction: GraphDirection;
  visibleKinds: ResourceKind[];
  selectedNamespaces: string[];
  showMiniMap: boolean;
  showControls: boolean;
  onNamespacesChange(namespaces: string[]): void;
}

export const WorkloadFlow = observer(({ direction, visibleKinds, selectedNamespaces, showMiniMap, showControls, onNamespacesChange }: WorkloadFlowProps) => {
  const [nodes, setNodes] = useState<Node<FlowNodeData>[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [graphRevision, setGraphRevision] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const storesRef = useRef<WorkloadStores>({});
  const flowRef = useRef<ReactFlowInstance<FlowNodeData> | null>(null);
  const fitSignatureRef = useRef("");
  const hoverTimerRef = useRef<number | null>(null);

  const clearHoverTimer = useCallback(() => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }, []);

  const fitGraph = useCallback(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        flowRef.current?.fitView({ padding: FIT_VIEW_PADDING, duration: 180 });
      });
    });
  }, []);

  const activateEdgeHover = useCallback((edgeId: string) => {
    clearHoverTimer();
    hoverTimerRef.current = window.setTimeout(() => {
      setHoveredEdgeId(current => current === edgeId ? current : edgeId);
      hoverTimerRef.current = null;
    }, EDGE_HOVER_ACTIVATION_DELAY_MS);
  }, [clearHoverTimer]);

  const clearEdgeHover = useCallback(() => {
    clearHoverTimer();
    hoverTimerRef.current = window.setTimeout(() => {
      setHoveredEdgeId(current => current === null ? current : null);
      hoverTimerRef.current = null;
    }, EDGE_HOVER_CLEAR_DELAY_MS);
  }, [clearHoverTimer]);

  const updateGraph = useCallback(() => {
    const stores = storesRef.current;
    const availableNamespaces = namespacesFromStores(stores);
    const selected = selectedNamespaces.filter(namespace => availableNamespaces.includes(namespace));
    const activeNamespaces = selected;

    onNamespacesChange(availableNamespaces);

    const { nodes: newNodes, edges: newEdges } = buildGraph(stores, activeNamespaces, direction, visibleKinds);
    const fitSignature = JSON.stringify({ direction, namespaces: activeNamespaces });

    setNodes(newNodes);
    setEdges(newEdges);
    if (fitSignature !== fitSignatureRef.current) {
      fitSignatureRef.current = fitSignature;
      setGraphRevision(revision => revision + 1);
    }
  }, [direction, onNamespacesChange, selectedNamespaces, visibleKinds]);

  useEffect(() => {
    if (nodes.length > 0) fitGraph();
  }, [fitGraph, graphRevision]);

  useEffect(() => () => {
    clearHoverTimer();
  }, [clearHoverTimer]);

  useEffect(() => {
    let isMounted = true;
    let disposer: (() => void) | undefined;
    let unsubscribers: Array<() => void> = [];

    const init = async () => {
      try {
        const resolvedStores = resolveStores();
        storesRef.current = resolvedStores;
        const stores = listStores(resolvedStores);
        const namespacedStores = listNamespacedStores(resolvedStores);

        if (!resolvedStores.ingresses || !resolvedStores.services || !resolvedStores.deployments) {
          setError("Required Kubernetes stores are not available.");
          setIsReady(true);
          return;
        }

        await resolvedStores.namespaces?.loadAll();

        const clusterNamespaces = namespacesFromStores({ namespaces: resolvedStores.namespaces });
        if (clusterNamespaces.length > 0) {
          await Promise.all(namespacedStores.map(store => store.loadAll({ namespaces: clusterNamespaces, merge: true })));
        } else {
          await Promise.all(namespacedStores.map(store => store.loadAll()));
        }

        unsubscribers = stores.map(store => store.subscribe());

        disposer = autorun(() => {
          stores.forEach(store => {
            void store.items.length;
          });

          if (isMounted) updateGraph();
        });

        if (isMounted) setIsReady(true);
      } catch (err) {
        if (!isMounted) return;
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        setIsReady(true);
      }
    };

    void init();

    return () => {
      isMounted = false;
      disposer?.();
      unsubscribers.forEach(unsubscribe => unsubscribe());
    };
  }, [updateGraph]);

  const hoveredNodeIds = useMemo(() => {
    if (!hoveredEdgeId) return new Set<string>();

    const hoveredEdge = edges.find(edge => edge.id === hoveredEdgeId);
    return hoveredEdge ? new Set([hoveredEdge.source, hoveredEdge.target]) : new Set<string>();
  }, [edges, hoveredEdgeId]);

  if (!isReady) {
    return <Spinner center />;
  }

  if (error) {
    return (
      <div className="WorkloadFlow">
        <div className="WorkloadFlowMessage">{error}</div>
      </div>
    );
  }

  if (nodes.length === 0) {
    return (
      <div className="WorkloadFlow">
        <div className="WorkloadFlowMessage">
          No workload flow data for selected namespaces.
        </div>
      </div>
    );
  }

  const renderedNodes = nodes.map(node => {
    if (!hoveredEdgeId) return node;

    const isHighlighted = hoveredNodeIds.has(node.id);
    return {
      ...node,
      className: isHighlighted ? "is-highlighted" : undefined,
    };
  });

  const renderedEdges = edges.map(edge => {
    if (!hoveredEdgeId) {
      const idleStroke = "rgba(148, 163, 184, 0.48)";
      return {
        ...edge,
        markerEnd: recolorMarkerEnd(edge.markerEnd as EdgeMarker | string | undefined, idleStroke),
        data: {
        ...edge.data,
        edgeState: "idle",
        onHoverStart: () => activateEdgeHover(edge.id),
        onHoverEnd: clearEdgeHover,
      },
    };
  }

    const highlighted = edge.id === hoveredEdgeId;
    const stroke = highlighted
      ? (typeof edge.style?.stroke === "string" ? edge.style.stroke : "#2a8af6")
      : "rgba(148, 163, 184, 0.48)";
    return {
      ...edge,
      markerEnd: recolorMarkerEnd(edge.markerEnd as EdgeMarker | string | undefined, stroke),
      data: {
        ...edge.data,
        edgeState: highlighted ? "highlighted" : "idle",
        onHoverStart: () => activateEdgeHover(edge.id),
        onHoverEnd: clearEdgeHover,
      },
    };
  });

  return (
    <div className="WorkloadFlow">
      <ReactFlow
        nodes={renderedNodes}
        edges={renderedEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodeOrigin={NODE_ORIGIN}
        fitView
        fitViewOptions={{ padding: FIT_VIEW_PADDING }}
        minZoom={0.1}
        maxZoom={2}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={false}
        onNodeMouseEnter={clearEdgeHover}
        onPaneMouseLeave={clearEdgeHover}
        onMoveStart={clearEdgeHover}
        onInit={instance => {
          flowRef.current = instance;
          fitGraph();
        }}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="var(--borderColor, #333)" gap={20} size={1} />
        {showMiniMap && <MiniMap position="bottom-left" pannable zoomable />}
        {showControls && <Controls className="WorkloadFlowControls" position="bottom-right" />}
      </ReactFlow>
    </div>
  );
});
