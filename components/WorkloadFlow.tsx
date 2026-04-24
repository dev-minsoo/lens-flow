import React, { useCallback, useEffect, useMemo, useState } from "react";
import { observer } from "mobx-react";
import { autorun } from "mobx";
import ReactFlow, {
  Background,
  Controls,
  Edge,
  MarkerType,
  MiniMap,
  Node,
  Position,
} from "reactflow";
import "reactflow/dist/style.css";
import { Renderer } from "@k8slens/extensions";
import { buildWorkloadGraph } from "../graph/buildGraph";
import {
  FlowNodeData,
  NamespaceLike,
  WorkloadResources,
} from "../graph/types";
import "./WorkloadFlow.scss";

const { Spinner } = Renderer.Component;
const apiManager = Renderer.K8sApi.apiManager;
const k8sApi = Renderer.K8sApi as Record<string, unknown>;

type KubeStoreLike = {
  items: unknown[];
  loadAll(): Promise<unknown>;
  subscribe(): () => void;
};

type NamespaceStoreLike = KubeStoreLike & {
  areAllSelectedImplicitly?: boolean;
  contextNamespaces?: string[];
};

const CloudIcon = () => (
  <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const CloudNode = ({ data }: { data: FlowNodeData }) => (
  <div className="cloud-node">
    <CloudIcon />
    <div className="cloud-label">{data.label}</div>
  </div>
);

const LoadBalancerNode = ({ data }: { data: FlowNodeData }) => (
  <div className={`lb-node is-${data.health}`} title={data.extra}>
    <div className="lb-content">
      <div className="lb-label">{data.label}</div>
      {data.extra && <div className="lb-ip">{data.extra}</div>}
    </div>
  </div>
);

const CustomNode = ({ data }: { data: FlowNodeData }) => {
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
    <div className={`custom-node custom-node-${data.type} is-${data.health}`} title={data.detail ?? data.extra}>
      <div className="node-content">
        <div className="node-label" title={data.label}>{data.label}</div>
        <div className="node-meta">
          <span className="node-kind">{kindLabels[data.type] ?? data.kind}</span>
          {data.namespace && <span className="node-namespace">{data.namespace}</span>}
          {data.extra && <span className="node-extra">{data.extra}</span>}
        </div>
      </div>
      <div className="node-status" aria-label={data.health}>
        <span className="status-icon" />
      </div>
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

const namespaceStore = getStore("namespacesApi") as NamespaceStoreLike | undefined;
const ingressStore = getStore("ingressApi");
const serviceStore = getStore("serviceApi");
const deploymentStore = getStore("deploymentApi");
const podStore = getStore("podsApi") ?? getStore("podApi");
const endpointsStore = getStore("endpointsApi") ?? getStore("endpointApi");
const statefulSetStore = getStore("statefulSetApi") ?? getStore("statefulSetsApi");
const daemonSetStore = getStore("daemonSetApi") ?? getStore("daemonSetsApi");
const replicaSetStore = getStore("replicaSetApi") ?? getStore("replicaSetsApi");

function getSelectedNamespaces(): string[] {
  if (!namespaceStore) return [];

  if (namespaceStore.areAllSelectedImplicitly) {
    const namespaces = namespaceStore.items as NamespaceLike[];
    return namespaces.map(ns => ns.getName());
  }

  return namespaceStore.contextNamespaces ?? [];
}

function storeItems<T>(store: KubeStoreLike | undefined): T[] {
  return (store?.items ?? []) as T[];
}

function buildGraph(): { nodes: Node<FlowNodeData>[]; edges: Edge[] } {
  const resources: WorkloadResources = {
    namespaces: getSelectedNamespaces(),
    ingresses: storeItems(ingressStore),
    services: storeItems(serviceStore),
    pods: storeItems(podStore),
    endpoints: storeItems(endpointsStore),
    deployments: storeItems(deploymentStore),
    statefulSets: storeItems(statefulSetStore),
    daemonSets: storeItems(daemonSetStore),
    replicaSets: storeItems(replicaSetStore),
  };

  const graph = buildWorkloadGraph(resources);

  return {
    nodes: graph.nodes.map(node => ({
      ...node,
      sourcePosition: node.sourcePosition === "right" ? Position.Right : undefined,
      targetPosition: node.targetPosition === "left" ? Position.Left : undefined,
    })) as Node<FlowNodeData>[],
    edges: graph.edges.map(edge => ({
      ...edge,
      markerEnd: edge.markerEnd
        ? { ...edge.markerEnd, type: MarkerType.ArrowClosed }
        : { type: MarkerType.ArrowClosed },
    })) as Edge[],
  };
}

export const WorkloadFlow = observer(() => {
  const [nodes, setNodes] = useState<Node<FlowNodeData>[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stores = useMemo(
    () => [
      namespaceStore,
      ingressStore,
      serviceStore,
      deploymentStore,
      podStore,
      endpointsStore,
      statefulSetStore,
      daemonSetStore,
      replicaSetStore,
    ].filter((store): store is KubeStoreLike => Boolean(store)),
    []
  );

  const updateGraph = useCallback(() => {
    const { nodes: newNodes, edges: newEdges } = buildGraph();
    setNodes(newNodes);
    setEdges(newEdges);
  }, []);

  const showResourceDetails = useCallback((_: React.MouseEvent, node: Node<FlowNodeData>) => {
    const selfLink = node.data.resource?.selfLink;
    if (selfLink) {
      Renderer.Navigation.showDetails(selfLink);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    let disposer: (() => void) | undefined;
    let unsubscribers: Array<() => void> = [];

    const init = async () => {
      try {
        if (!namespaceStore || !ingressStore || !serviceStore || !deploymentStore) {
          setError("Required Kubernetes stores are not available.");
          setIsReady(true);
          return;
        }

        await Promise.all(stores.map(store => store.loadAll()));

        unsubscribers = stores.map(store => store.subscribe());

        disposer = autorun(() => {
          void namespaceStore.contextNamespaces;
          void namespaceStore.areAllSelectedImplicitly;
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
  }, [stores, updateGraph]);

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
        fitView
        fitViewOptions={{ padding: 0.25 }}
        minZoom={0.1}
        maxZoom={2}
        nodesDraggable={false}
        nodesConnectable={false}
        onNodeDoubleClick={showResourceDetails}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="var(--borderColor, #333)" gap={20} size={1} />
        <MiniMap position="bottom-left" pannable zoomable />
        <Controls position="bottom-right" />
      </ReactFlow>
    </div>
  );
});
