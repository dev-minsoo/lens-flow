import React, { useCallback, useEffect, useRef, useState } from "react";
import { observer } from "mobx-react";
import { autorun } from "mobx";
import ReactFlow, {
  Background,
  Controls,
  Edge,
  Handle,
  MarkerType,
  MiniMap,
  Node,
  Position,
  ReactFlowInstance,
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
const FIT_VIEW_PADDING = 0.38;

type KubeStoreLike = {
  items: unknown[];
  loadAll(): Promise<unknown>;
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
    ingress: "ing",
    service: "svc",
    deployment: "deploy",
    statefulset: "sts",
    daemonset: "ds",
    pod: "pod",
    configmap: "cm",
    secret: "secret",
    persistentvolumeclaim: "pvc",
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

function getStore(apiName: string): KubeStoreLike | undefined {
  const api = k8sApi[apiName];
  if (!api) return undefined;

  return apiManager.getStore(api as never) as KubeStoreLike | undefined;
}

type WorkloadStores = {
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
    persistentVolumeClaims: getStore("persistentVolumeClaimApi") ?? getStore("persistentVolumeClaimsApi"),
  };
}

function listStores(stores: WorkloadStores): KubeStoreLike[] {
  return Object.values(stores).filter((store): store is KubeStoreLike => Boolean(store));
}

function storeItems<T>(store: KubeStoreLike | undefined): T[] {
  return (store?.items ?? []) as T[];
}

function namespacesFromStores(stores: WorkloadStores): string[] {
  const namespaces = new Set<string>();

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

  return {
    nodes: graph.nodes.map(node => ({
      ...node,
      selectable: false,
      sourcePosition: toReactFlowPosition(node.sourcePosition),
      targetPosition: toReactFlowPosition(node.targetPosition),
    })) as Node<FlowNodeData>[],
    edges: graph.edges.map(edge => ({
      ...edge,
      markerEnd: edge.markerEnd
        ? { ...edge.markerEnd, type: MarkerType.ArrowClosed }
        : { type: MarkerType.ArrowClosed },
    })) as Edge[],
  };
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
  const [graphRevision, setGraphRevision] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const storesRef = useRef<WorkloadStores>({});
  const flowRef = useRef<ReactFlowInstance<FlowNodeData> | null>(null);
  const graphSignatureRef = useRef("");

  const fitGraph = useCallback(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        flowRef.current?.fitView({ padding: FIT_VIEW_PADDING, duration: 180 });
      });
    });
  }, []);

  const updateGraph = useCallback(() => {
    const stores = storesRef.current;
    const availableNamespaces = namespacesFromStores(stores);
    const selected = selectedNamespaces.filter(namespace => availableNamespaces.includes(namespace));
    const activeNamespaces = selected.length > 0 ? selected : availableNamespaces;

    onNamespacesChange(availableNamespaces);

    const { nodes: newNodes, edges: newEdges } = buildGraph(stores, activeNamespaces, direction, visibleKinds);
    const graphSignature = JSON.stringify({
      nodes: newNodes.map(node => ({
        id: node.id,
        type: node.type,
        x: Math.round(node.position.x),
        y: Math.round(node.position.y),
        sourcePosition: node.sourcePosition,
        targetPosition: node.targetPosition,
      })),
      edges: newEdges.map(edge => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
      })),
    });

    setNodes(newNodes);
    setEdges(newEdges);
    if (graphSignature !== graphSignatureRef.current) {
      graphSignatureRef.current = graphSignature;
      setGraphRevision(revision => revision + 1);
    }
  }, [direction, onNamespacesChange, selectedNamespaces, visibleKinds]);

  useEffect(() => {
    if (nodes.length > 0) fitGraph();
  }, [direction, fitGraph, graphRevision, nodes.length]);

  useEffect(() => {
    let isMounted = true;
    let disposer: (() => void) | undefined;
    let unsubscribers: Array<() => void> = [];

    const init = async () => {
      try {
        const resolvedStores = resolveStores();
        storesRef.current = resolvedStores;
        const stores = listStores(resolvedStores);

        if (!resolvedStores.ingresses || !resolvedStores.services || !resolvedStores.deployments) {
          setError("Required Kubernetes stores are not available.");
          setIsReady(true);
          return;
        }

        await Promise.all(stores.map(store => store.loadAll()));

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

  return (
    <div className="WorkloadFlow">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        nodeOrigin={NODE_ORIGIN}
        fitView
        fitViewOptions={{ padding: FIT_VIEW_PADDING }}
        minZoom={0.1}
        maxZoom={2}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={false}
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
