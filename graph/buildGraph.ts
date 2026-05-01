import dagre from "dagre";
import {
  ConfigMapLike,
  EndpointLike,
  FlowEdge,
  FlowNode,
  GraphDirection,
  IngressLike,
  KubeObjectLike,
  PodLike,
  PersistentVolumeClaimLike,
  ReplicaSetLike,
  ResourceHealth,
  ResourceKind,
  SecretLike,
  ServiceLike,
  WorkloadGraph,
  WorkloadGraphOptions,
  WorkloadLike,
  WorkloadResources,
} from "./types";

const EDGE_COLORS: Record<string, string> = {
  internet: "#64748b",
  ingress: "#8b5cf6",
  service: "#0ea5e9",
  workload: "#10b981",
  replicaset: "#22c55e",
  pod: "#f59e0b",
  config: "#64748b",
  secret: "#ec4899",
  storage: "#06b6d4",
};

const KIND_RANK: Record<ResourceKind, number> = {
  Internet: 0,
  LoadBalancer: 1,
  Ingress: 2,
  Service: 3,
  ConfigMap: 3.5,
  Secret: 3.5,
  PersistentVolumeClaim: 3.5,
  Deployment: 4,
  StatefulSet: 4,
  DaemonSet: 4,
  ReplicaSet: 5,
  Pod: 6,
  Unknown: 7,
};

const NODE_WIDTH = 220;
const NODE_HEIGHT = 88;
const CLOUD_WIDTH = 112;
const CLOUD_HEIGHT = 44;
const RANK_GAP = 72;
const ROW_GAP = 20;

interface WorkloadEntry {
  kind: ResourceKind;
  workload: WorkloadLike;
}

interface BackendRefV1 {
  service?: {
    name?: string;
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getBackendServiceName(ref: unknown): string | undefined {
  if (!isObject(ref)) return undefined;
  if (typeof ref.serviceName === "string") {
    return ref.serviceName;
  }

  const service = (ref as BackendRefV1).service;
  return isObject(service) && typeof service.name === "string" ? service.name : undefined;
}

function objectKey(kind: ResourceKind, namespace: string | undefined, name: string): string {
  return `${kind}:${namespace ?? "_cluster"}:${name}`;
}

function resourceKey(kind: ResourceKind, resource: KubeObjectLike): string {
  return objectKey(kind, resource.getNs(), resource.getName());
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function hasLabels(labels: Record<string, string> | undefined, selector: Record<string, string>): boolean {
  const keys = Object.keys(selector);
  return keys.length > 0 && keys.every(key => labels?.[key] === selector[key]);
}

function getIngressAddress(ingress: IngressLike): string | undefined {
  const lbIngress = ingress.status?.loadBalancer?.ingress?.[0];
  return lbIngress?.ip || lbIngress?.hostname;
}

function getServiceAddress(service: ServiceLike): string | undefined {
  const lbIngress = service.status?.loadBalancer?.ingress?.[0];
  return lbIngress?.ip || lbIngress?.hostname;
}

function labelValue(label: string, value: string | undefined): string | undefined {
  return value ? `${label} ${value}` : undefined;
}

function servicePortSummary(service: ServiceLike): string | undefined {
  const ports = service.spec?.ports ?? [];
  if (ports.length === 0) return labelValue("Type", service.spec?.type);

  const formatted = ports
    .slice(0, 2)
    .map(port => {
      const exposed = port.nodePort ?? port.port;
      return exposed ? String(exposed) : undefined;
    })
    .filter(Boolean)
    .join(", ");

  const suffix = ports.length > 2 ? ` +${ports.length - 2}` : "";
  return formatted ? `Port ${formatted}${suffix}` : labelValue("Type", service.spec?.type);
}

function serviceSummary(service: ServiceLike, pods: PodLike[]): string | undefined {
  const type = service.spec?.type;
  const portSummary = servicePortSummary(service);
  if (type && portSummary && !portSummary.startsWith(`Type ${type}`)) {
    return `${type} · ${portSummary}`;
  }

  return portSummary ?? labelValue("Type", type);
}

function serviceDetail(service: ServiceLike, pods: PodLike[]): string | undefined {
  const parts = [
    labelValue("Type", service.spec?.type),
    servicePortSummary(service),
    pods.length > 0 ? `Backends ${pods.length}` : undefined,
    service.spec?.clusterIP ? `ClusterIP ${service.spec.clusterIP}` : undefined,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" · ") : undefined;
}

function workloadHealth(workload: WorkloadLike, kind: ResourceKind): ResourceHealth {
  if (kind === "DaemonSet") {
    const desired = workload.status?.desiredNumberScheduled ?? workload.status?.currentNumberScheduled ?? 0;
    const ready = workload.status?.numberReady ?? 0;
    if (desired === 0) return "unknown";
    return ready >= desired ? "healthy" : ready > 0 ? "warning" : "error";
  }

  const total = workload.status?.replicas ?? workload.spec?.replicas ?? 0;
  const ready = workload.status?.readyReplicas ?? workload.status?.availableReplicas ?? 0;
  if (total === 0) return "unknown";
  return ready >= total ? "healthy" : ready > 0 ? "warning" : "error";
}

function workloadReplicaSummary(workload: WorkloadLike, kind: ResourceKind): string {
  if (kind === "DaemonSet") {
    const desired = workload.status?.desiredNumberScheduled ?? workload.status?.currentNumberScheduled ?? 0;
    const ready = workload.status?.numberReady ?? 0;
    return `Ready ${ready}/${desired}`;
  }

  const total = workload.status?.replicas ?? workload.spec?.replicas ?? 0;
  const ready = workload.status?.readyReplicas ?? workload.status?.availableReplicas ?? 0;
  return `Ready ${ready}/${total}`;
}

function replicaSetSummary(replicaSet: ReplicaSetLike): string {
  const revision = replicaSet.metadata?.annotations?.["deployment.kubernetes.io/revision"];
  const ready = workloadReplicaSummary(replicaSet, "ReplicaSet");

  return revision ? `Rev ${revision} · ${ready}` : ready;
}

function podSummary(pod: PodLike): string | undefined {
  const phase = pod.status?.phase;
  const statuses = pod.status?.containerStatuses ?? [];

  if (statuses.length > 0) {
    const ready = statuses.filter(status => status.ready).length;

    if (phase && phase !== "Running" && phase !== "Succeeded") {
      return `${phase} · ${ready}/${statuses.length}`;
    }

    return `Ready ${ready}/${statuses.length}`;
  }

  return labelValue("Phase", phase);
}

function podDetail(pod: PodLike): string | undefined {
  const parts = [
    podSummary(pod),
    pod.spec?.nodeName ? `Node ${pod.spec.nodeName}` : undefined,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" · ") : undefined;
}

function ingressSummary(ingress: IngressLike): string | undefined {
  const hosts = (ingress.spec?.rules ?? []).map(rule => rule.host).filter(Boolean) as string[];
  const visibleHosts = unique(hosts).slice(0, 2);
  if (visibleHosts.length === 0) return undefined;

  const summary = visibleHosts.join(", ");
  const extraCount = unique(hosts).length - visibleHosts.length;
  return extraCount > 0 ? `Host ${summary} +${extraCount}` : `Host ${summary}`;
}

function ingressDetail(ingress: IngressLike): string | undefined {
  const hosts = unique((ingress.spec?.rules ?? []).map(rule => rule.host).filter(Boolean) as string[]);
  const parts = [
    hosts.length > 0 ? `Hosts ${hosts.join(", ")}` : undefined,
    ingressBackends(ingress).length > 0 ? `Services ${ingressBackends(ingress).length}` : undefined,
    getIngressAddress(ingress) ? `Address ${getIngressAddress(ingress)}` : undefined,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" · ") : undefined;
}

function replicaSetRevision(replicaSet: ReplicaSetLike): number {
  const revision = replicaSet.metadata?.annotations?.["deployment.kubernetes.io/revision"];
  const parsed = revision ? Number.parseInt(revision, 10) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : -1;
}

function podHealth(pod: PodLike): ResourceHealth {
  if (pod.status?.phase === "Pending") return "pending";
  if (pod.status?.phase === "Failed") return "error";
  if (pod.status?.phase === "Succeeded") return "healthy";

  const readyCondition = pod.status?.conditions?.find(condition => condition.type === "Ready");
  if (readyCondition?.status === "True") return "healthy";

  const statuses = pod.status?.containerStatuses ?? [];
  if (statuses.length > 0 && statuses.some(status => status.ready)) return "warning";
  return "unknown";
}

function serviceHealth(service: ServiceLike, pods: PodLike[]): ResourceHealth {
  if (service.spec?.type === "LoadBalancer" && !getServiceAddress(service)) return "pending";
  if (pods.length === 0) return "healthy";
  return pods.some(pod => podHealth(pod) === "healthy") ? "healthy" : "warning";
}

function ingressHealth(ingress: IngressLike): ResourceHealth {
  return getIngressAddress(ingress) ? "healthy" : "pending";
}

function addNode(nodes: Map<string, FlowNode>, node: Omit<FlowNode, "position">): void {
  if (nodes.has(node.id)) return;
  nodes.set(node.id, {
    ...node,
    position: { x: 0, y: 0 },
  });
}

function addEdge(edges: Map<string, FlowEdge>, source: string, target: string, colorKey: keyof typeof EDGE_COLORS, label?: string): void {
  if (source === target) return;

  const id = `${source}->${target}${label ? `:${label}` : ""}`;
  if (edges.has(id)) return;

  const color = EDGE_COLORS[colorKey];
  edges.set(id, {
    id,
    source,
    target,
    type: "step",
    className: "workload-flow-edge",
    zIndex: 20,
    style: {
      stroke: color,
      strokeWidth: 2.5,
      strokeDasharray: "8 8",
    },
    markerEnd: {
      type: "arrowclosed",
      color,
      width: 15,
      height: 15,
    },
  });
}

function buildServiceIndex(services: ServiceLike[]): Map<string, ServiceLike> {
  return new Map(services.map(service => [resourceKey("Service", service), service]));
}

function buildWorkloadIndex(resources: WorkloadResources): Map<string, WorkloadEntry> {
  const workloads = [
    ...(resources.deployments ?? []).map(workload => ({ workload, kind: "Deployment" as ResourceKind })),
    ...(resources.statefulSets ?? []).map(workload => ({ workload, kind: "StatefulSet" as ResourceKind })),
    ...(resources.daemonSets ?? []).map(workload => ({ workload, kind: "DaemonSet" as ResourceKind })),
  ];

  return new Map(workloads.map(entry => [resourceKey(entry.kind, entry.workload), entry]));
}

function buildReplicaSetOwnerIndex(replicaSets: ReplicaSetLike[] = []): Map<string, { kind: ResourceKind; name: string }> {
  const owners = new Map<string, { kind: ResourceKind; name: string }>();

  replicaSets.forEach(replicaSet => {
    const owner = replicaSet.metadata?.ownerReferences?.find(ref => ref.kind === "Deployment" && ref.name);
    if (!owner?.name) return;
    owners.set(resourceKey("Unknown", replicaSet), { kind: "Deployment", name: owner.name });
  });

  return owners;
}

function buildResourceIndex<T extends KubeObjectLike>(kind: ResourceKind, resources: T[] = []): Map<string, T> {
  return new Map(resources.map(resource => [resourceKey(kind, resource), resource]));
}

function podOwnerKey(pod: PodLike, replicaSetOwners: Map<string, { kind: ResourceKind; name: string }>): string | undefined {
  const owner = pod.metadata?.ownerReferences?.[0];
  if (!owner?.kind || !owner.name) return undefined;

  if (owner.kind === "ReplicaSet") {
    const deployment = replicaSetOwners.get(objectKey("Unknown", pod.getNs(), owner.name));
    return deployment ? objectKey(deployment.kind, pod.getNs(), deployment.name) : objectKey("ReplicaSet", pod.getNs(), owner.name);
  }

  if (owner.kind === "Deployment" || owner.kind === "StatefulSet" || owner.kind === "DaemonSet") {
    return objectKey(owner.kind as ResourceKind, pod.getNs(), owner.name);
  }

  return undefined;
}

function podsForService(service: ServiceLike, pods: PodLike[], endpoints: EndpointLike[]): PodLike[] {
  const endpoint = endpoints.find(item => item.getNs() === service.getNs() && item.getName() === service.getName());
  const endpointPodNames = endpoint?.subsets
    ?.flatMap(subset => subset.addresses ?? [])
    .map(address => address.targetRef?.kind === "Pod" ? address.targetRef.name : undefined)
    .filter((name): name is string => Boolean(name));

  if (endpointPodNames && endpointPodNames.length > 0) {
    return pods.filter(pod => pod.getNs() === service.getNs() && endpointPodNames.includes(pod.getName()));
  }

  const selector = service.spec?.selector ?? {};
  return pods.filter(pod => pod.getNs() === service.getNs() && hasLabels(pod.metadata?.labels, selector));
}

function workloadsForService(service: ServiceLike, workloads: Map<string, WorkloadEntry>, pods: PodLike[], replicaSetOwners: Map<string, { kind: ResourceKind; name: string }>): WorkloadEntry[] {
  const podOwners = pods
    .map(pod => podOwnerKey(pod, replicaSetOwners))
    .filter((key): key is string => Boolean(key))
    .map(key => workloads.get(key))
    .filter((entry): entry is WorkloadEntry => Boolean(entry));

  if (podOwners.length > 0) return unique(podOwners);

  const selector = service.spec?.selector ?? {};
  return Array.from(workloads.values()).filter(({ workload }) => {
    if (workload.getNs() !== service.getNs()) return false;
    const labels = workload.spec?.template?.metadata?.labels ?? workload.spec?.selector?.matchLabels;
    return hasLabels(labels, selector);
  });
}

function ingressBackends(ingress: IngressLike): Array<{ serviceName: string; label?: string }> {
  const backends: Array<{ serviceName: string; label?: string }> = [];
  const defaultService = getBackendServiceName(ingress.spec?.defaultBackend);
  if (defaultService) backends.push({ serviceName: defaultService, label: "default" });

  ingress.spec?.rules?.forEach(rule => {
    rule.http?.paths?.forEach(path => {
      const serviceName = getBackendServiceName(path.backend);
      if (!serviceName) return;
      const labelParts = [rule.host, path.path].filter(Boolean);
      backends.push({ serviceName, label: labelParts.join(" ") || undefined });
    });
  });

  return backends;
}

function collectWorkloadRefs(workload: WorkloadLike): {
  configMaps: string[];
  secrets: string[];
  persistentVolumeClaims: string[];
} {
  const configMaps = new Set<string>();
  const secrets = new Set<string>();
  const persistentVolumeClaims = new Set<string>();
  const podSpec = workload.spec?.template?.spec;

  podSpec?.volumes?.forEach(volume => {
    if (volume.configMap?.name) configMaps.add(volume.configMap.name);
    if (volume.secret?.secretName) secrets.add(volume.secret.secretName);
    if (volume.persistentVolumeClaim?.claimName) {
      persistentVolumeClaims.add(volume.persistentVolumeClaim.claimName);
    }
  });

  const containers = [
    ...(podSpec?.initContainers ?? []),
    ...(podSpec?.containers ?? []),
  ];

  containers.forEach(container => {
    container.envFrom?.forEach(source => {
      if (source.configMapRef?.name) configMaps.add(source.configMapRef.name);
      if (source.secretRef?.name) secrets.add(source.secretRef.name);
    });

    container.env?.forEach(env => {
      if (env.valueFrom?.configMapKeyRef?.name) {
        configMaps.add(env.valueFrom.configMapKeyRef.name);
      }

      if (env.valueFrom?.secretKeyRef?.name) {
        secrets.add(env.valueFrom.secretKeyRef.name);
      }
    });
  });

  return {
    configMaps: Array.from(configMaps),
    secrets: Array.from(secrets),
    persistentVolumeClaims: Array.from(persistentVolumeClaims),
  };
}

function isPodOwnedByWorkload(pod: PodLike, entry: WorkloadEntry, replicaSetOwners: Map<string, { kind: ResourceKind; name: string }>): boolean {
  return podOwnerKey(pod, replicaSetOwners) === objectKey(entry.kind, entry.workload.getNs(), entry.workload.getName());
}

function pvcBelongsToStatefulSet(pvc: PersistentVolumeClaimLike, statefulSet: WorkloadLike): boolean {
  const claimNames = statefulSet.spec?.volumeClaimTemplates
    ?.map(template => template.metadata?.name)
    .filter((name): name is string => Boolean(name)) ?? [];

  return claimNames.some(name => pvc.getName().startsWith(`${name}-${statefulSet.getName()}-`));
}

function connectionPositions(direction: GraphDirection): Pick<FlowNode, "sourcePosition" | "targetPosition"> {
  return direction === "TB"
    ? { sourcePosition: "bottom", targetPosition: "top" }
    : { sourcePosition: "right", targetPosition: "left" };
}

function nodeDimensions(node: FlowNode): { width: number; height: number } {
  return node.type === "cloud"
    ? { width: CLOUD_WIDTH, height: CLOUD_HEIGHT }
    : { width: NODE_WIDTH, height: NODE_HEIGHT };
}

function layout(nodes: FlowNode[], edges: FlowEdge[], direction: GraphDirection): FlowNode[] {
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({
    rankdir: direction,
    ranksep: RANK_GAP,
    nodesep: ROW_GAP,
    edgesep: 8,
    ranker: "tight-tree",
    marginx: 0,
    marginy: 0,
  });
  graph.setDefaultEdgeLabel(() => ({}));

  nodes.forEach(node => {
    graph.setNode(node.id, {
      width: node.type === "cloud" ? CLOUD_WIDTH : NODE_WIDTH,
      height: node.type === "cloud" ? CLOUD_HEIGHT : NODE_HEIGHT,
      rank: KIND_RANK[node.data.kind] ?? KIND_RANK.Unknown,
    });
  });

  edges.forEach(edge => {
    graph.setEdge(edge.source, edge.target, {
      weight: edge.source.startsWith("Service:") ? 3 : 1,
      minlen: 1,
    });
  });

  dagre.layout(graph);

  const laidOut = nodes.map(node => {
    const layoutNode = graph.node(node.id);
    return {
      ...node,
      ...connectionPositions(direction),
      position: {
        x: layoutNode.x,
        y: layoutNode.y,
      },
    };
  });

  return resolveNodeCollisions(
    repositionDisconnectedComponents(repositionReplicaSets(laidOut, direction), edges, direction),
    direction
  );
}

function repositionReplicaSets(nodes: FlowNode[], direction: GraphDirection): FlowNode[] {
  const adjusted = nodes.map(node => ({ ...node, position: { ...node.position } }));
  const deploymentById = new Map(adjusted
    .filter(node => node.data.kind === "Deployment")
    .map(node => [node.id, node]));
  const replicaSetsByDeployment = new Map<string, FlowNode[]>();

  adjusted
    .filter(node => node.data.kind === "ReplicaSet")
    .forEach(node => {
      const resource = node.data.resource as ReplicaSetLike | undefined;
      const owner = resource?.metadata?.ownerReferences?.find(ref => ref.kind === "Deployment" && ref.name);
      if (!owner) return;

      const deploymentId = objectKey("Deployment", resource?.getNs(), owner.name);
      replicaSetsByDeployment.set(deploymentId, [...(replicaSetsByDeployment.get(deploymentId) ?? []), node]);
    });

  replicaSetsByDeployment.forEach((replicaSets, deploymentId) => {
    const deployment = deploymentById.get(deploymentId);
    if (!deployment || replicaSets.length < 2) return;

    const ordered = [...replicaSets].sort((left, right) => {
      const leftRevision = replicaSetRevision(left.data.resource as ReplicaSetLike);
      const rightRevision = replicaSetRevision(right.data.resource as ReplicaSetLike);
      if (leftRevision !== rightRevision) {
        return direction === "TB"
          ? leftRevision - rightRevision
          : rightRevision - leftRevision;
      }
      return left.data.label.localeCompare(right.data.label);
    });

    const gap = direction === "TB" ? NODE_WIDTH + 24 : NODE_HEIGHT + 16;
    const start = -((ordered.length - 1) * gap) / 2;

    ordered.forEach((node, index) => {
      if (direction === "TB") {
        node.position.x = deployment.position.x + start + index * gap;
      } else {
        node.position.y = deployment.position.y + start + index * gap;
      }
    });
  });

  return adjusted;
}

function repositionDisconnectedComponents(nodes: FlowNode[], edges: FlowEdge[], direction: GraphDirection): FlowNode[] {
  const adjusted = nodes.map(node => ({ ...node, position: { ...node.position } }));
  const nodesById = new Map(adjusted.map(node => [node.id, node]));
  const internetId = "internet";
  const loadBalancerNodes = adjusted.filter(node => node.data.kind === "LoadBalancer");
  const ingressNodes = adjusted.filter(node => node.data.kind === "Ingress");
  const anchorNodes = loadBalancerNodes.length > 0 ? loadBalancerNodes : ingressNodes;
  const anchor = anchorNodes.length > 0
    ? Math.min(...anchorNodes.map(node => direction === "TB" ? node.position.y : node.position.x))
    : null;

  if (anchor === null || !nodesById.has(internetId)) {
    return adjusted;
  }

  const directed = new Map<string, string[]>();
  const undirected = new Map<string, string[]>();
  const link = (map: Map<string, string[]>, from: string, to: string) => {
    map.set(from, [...(map.get(from) ?? []), to]);
  };

  edges.forEach(edge => {
    link(directed, edge.source, edge.target);
    link(undirected, edge.source, edge.target);
    link(undirected, edge.target, edge.source);
  });

  const reachableFromInternet = new Set<string>();
  const stack = [internetId];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (reachableFromInternet.has(current)) continue;
    reachableFromInternet.add(current);
    (directed.get(current) ?? []).forEach(next => {
      if (!reachableFromInternet.has(next)) stack.push(next);
    });
  }

  const visited = new Set<string>();

  adjusted.forEach(node => {
    if (visited.has(node.id) || reachableFromInternet.has(node.id)) return;

    const component: FlowNode[] = [];
    const componentStack = [node.id];

    while (componentStack.length > 0) {
      const current = componentStack.pop()!;
      if (visited.has(current) || reachableFromInternet.has(current)) continue;
      visited.add(current);

      const currentNode = nodesById.get(current);
      if (currentNode) component.push(currentNode);

      (undirected.get(current) ?? []).forEach(next => {
        if (!visited.has(next) && !reachableFromInternet.has(next)) componentStack.push(next);
      });
    }

    if (component.length === 0) return;

    const componentAnchor = Math.min(...component.map(item => direction === "TB" ? item.position.y : item.position.x));
    if (componentAnchor >= anchor) return;

    const delta = anchor - componentAnchor;
    component.forEach(item => {
      if (direction === "TB") {
        item.position.y += delta;
      } else {
        item.position.x += delta;
      }
    });
  });

  return adjusted;
}

function resolveNodeCollisions(nodes: FlowNode[], direction: GraphDirection): FlowNode[] {
  const adjusted = nodes.map(node => ({ ...node, position: { ...node.position } }));
  const padding = 18;
  const maxPasses = 12;

  for (let pass = 0; pass < maxPasses; pass += 1) {
    let moved = false;

    const ordered = [...adjusted].sort((left, right) => (
      direction === "TB"
        ? left.position.x - right.position.x || left.position.y - right.position.y
        : left.position.y - right.position.y || left.position.x - right.position.x
    ));

    for (let i = 0; i < ordered.length; i += 1) {
      for (let j = i + 1; j < ordered.length; j += 1) {
        const first = ordered[i];
        const second = ordered[j];
        const firstSize = nodeDimensions(first);
        const secondSize = nodeDimensions(second);
        const overlapX = (firstSize.width + secondSize.width) / 2 + padding - Math.abs(first.position.x - second.position.x);
        const overlapY = (firstSize.height + secondSize.height) / 2 + padding - Math.abs(first.position.y - second.position.y);

        if (overlapX <= 0 || overlapY <= 0) continue;

        if (direction === "TB") {
          second.position.x += overlapX;
        } else {
          second.position.y += overlapY;
        }

        moved = true;
      }
    }

    if (!moved) break;
  }

  return adjusted;
}

function addWorkloadNode(nodes: Map<string, FlowNode>, entry: WorkloadEntry): void {
  const { workload, kind } = entry;
  addNode(nodes, {
    id: resourceKey(kind, workload),
    type: "custom",
    data: {
      label: workload.getName(),
      type: kind.toLowerCase(),
      kind,
      namespace: workload.getNs(),
      extra: workloadReplicaSummary(workload, kind),
      health: workloadHealth(workload, kind),
      resource: workload,
    },
    sourcePosition: "right",
    targetPosition: "left",
  });
}

function addReplicaSetNode(nodes: Map<string, FlowNode>, replicaSet: ReplicaSetLike): void {
  addNode(nodes, {
    id: resourceKey("ReplicaSet", replicaSet),
    type: "custom",
    data: {
      label: replicaSet.getName(),
      type: "replicaset",
      kind: "ReplicaSet",
      namespace: replicaSet.getNs(),
      extra: replicaSetSummary(replicaSet),
      health: workloadHealth(replicaSet, "ReplicaSet"),
      resource: replicaSet,
    },
    sourcePosition: "right",
    targetPosition: "left",
  });
}

function addConfigMapNode(nodes: Map<string, FlowNode>, configMap: ConfigMapLike): void {
  const dataKeys = Object.keys(configMap.data ?? {}).length;
  addNode(nodes, {
    id: resourceKey("ConfigMap", configMap),
    type: "custom",
    data: {
      label: configMap.getName(),
      type: "configmap",
      kind: "ConfigMap",
      namespace: configMap.getNs(),
      extra: `Keys ${dataKeys}`,
      health: "unknown",
      resource: configMap,
    },
    sourcePosition: "right",
    targetPosition: "left",
  });
}

function addSecretNode(nodes: Map<string, FlowNode>, secret: SecretLike): void {
  const dataKeys = Object.keys(secret.data ?? {}).length;
  addNode(nodes, {
    id: resourceKey("Secret", secret),
    type: "custom",
    data: {
      label: secret.getName(),
      type: "secret",
      kind: "Secret",
      namespace: secret.getNs(),
      extra: secret.type ? `Type ${secret.type}` : `Keys ${dataKeys}`,
      health: "unknown",
      resource: secret,
    },
    sourcePosition: "right",
    targetPosition: "left",
  });
}

function addPersistentVolumeClaimNode(nodes: Map<string, FlowNode>, pvc: PersistentVolumeClaimLike): void {
  const phase = pvc.status?.phase ?? "Unknown";
  addNode(nodes, {
    id: resourceKey("PersistentVolumeClaim", pvc),
    type: "custom",
    data: {
      label: pvc.getName(),
      type: "persistentvolumeclaim",
      kind: "PersistentVolumeClaim",
      namespace: pvc.getNs(),
      extra: pvc.status?.capacity?.storage || pvc.spec?.resources?.requests?.storage
        ? `Storage ${pvc.status?.capacity?.storage ?? pvc.spec?.resources?.requests?.storage}`
        : `Phase ${phase}`,
      health: phase === "Bound" ? "healthy" : phase === "Pending" ? "pending" : "unknown",
      resource: pvc,
    },
    sourcePosition: "right",
    targetPosition: "left",
  });
}

function addPodNode(nodes: Map<string, FlowNode>, pod: PodLike): void {
  addNode(nodes, {
    id: resourceKey("Pod", pod),
    type: "custom",
    data: {
      label: pod.getName(),
      type: "pod",
      kind: "Pod",
      namespace: pod.getNs(),
      extra: podSummary(pod),
      detail: podDetail(pod),
      health: podHealth(pod),
      resource: pod,
    },
    sourcePosition: "right",
    targetPosition: "left",
  });
}

function filterVisibleKinds(graph: WorkloadGraph, visibleKinds: ResourceKind[] | undefined): WorkloadGraph {
  if (!visibleKinds) return graph;

  const visible = new Set(visibleKinds);
  const nodes = graph.nodes.filter(node => visible.has(node.data.kind));
  const nodeIds = new Set(nodes.map(node => node.id));
  const hiddenNodeIds = new Set(graph.nodes.filter(node => !nodeIds.has(node.id)).map(node => node.id));
  const edgesBySource = new Map<string, FlowEdge[]>();
  const edges = new Map<string, FlowEdge>();

  graph.edges.forEach(edge => {
    edgesBySource.set(edge.source, [...(edgesBySource.get(edge.source) ?? []), edge]);
  });

  const addVisibleEdge = (edge: FlowEdge, source = edge.source, target = edge.target) => {
    if (source === target || !nodeIds.has(source) || !nodeIds.has(target)) return;

    const id = edge.source === source && edge.target === target
      ? edge.id
      : `${source}->${target}:bridge`;

    if (edges.has(id)) return;
    edges.set(id, {
      ...edge,
      id,
      source,
      target,
    });
  };

  const connectThroughHidden = (source: string, current: string, templateEdge: FlowEdge, visited: Set<string>) => {
    if (visited.has(current)) return;
    visited.add(current);

    if (nodeIds.has(current)) {
      addVisibleEdge(templateEdge, source, current);
      return;
    }

    if (!hiddenNodeIds.has(current)) return;

    (edgesBySource.get(current) ?? []).forEach(edge => {
      connectThroughHidden(source, edge.target, edge, new Set(visited));
    });
  };

  graph.edges.forEach(edge => {
    if (!nodeIds.has(edge.source)) return;
    if (nodeIds.has(edge.target)) {
      addVisibleEdge(edge);
      return;
    }

    connectThroughHidden(edge.source, edge.target, edge, new Set());
  });

  return { nodes, edges: Array.from(edges.values()) };
}

export function buildWorkloadGraph(resources: WorkloadResources, options: WorkloadGraphOptions = {}): WorkloadGraph {
  const direction = options.direction ?? "LR";
  const nodes = new Map<string, FlowNode>();
  const edges = new Map<string, FlowEdge>();
  const namespaces = new Set(resources.namespaces);
  const pods = (resources.pods ?? []).filter(pod => namespaces.has(pod.getNs()));
  const services = resources.services.filter(service => namespaces.has(service.getNs()));
  const ingresses = resources.ingresses.filter(ingress => namespaces.has(ingress.getNs()));
  const endpoints = (resources.endpoints ?? []).filter(endpoint => namespaces.has(endpoint.getNs()));
  const serviceIndex = buildServiceIndex(services);
  const workloadIndex = buildWorkloadIndex(resources);
  const replicaSetOwners = buildReplicaSetOwnerIndex(resources.replicaSets);
  const configMapIndex = buildResourceIndex("ConfigMap", (resources.configMaps ?? []).filter(item => namespaces.has(item.getNs())));
  const secretIndex = buildResourceIndex("Secret", (resources.secrets ?? []).filter(item => namespaces.has(item.getNs())));
  const pvcs = (resources.persistentVolumeClaims ?? []).filter(item => namespaces.has(item.getNs()));
  const pvcIndex = buildResourceIndex("PersistentVolumeClaim", pvcs);
  const replicaSets = (resources.replicaSets ?? []).filter(replicaSet => namespaces.has(replicaSet.getNs()));
  const serviceIdsSeen = new Set<string>();
  const workloadIdsSeen = new Set<string>();

  const internetId = "internet";

  const addInternetNode = () => {
    addNode(nodes, {
      id: internetId,
      type: "cloud",
      data: {
        label: "Internet",
        type: "internet",
        kind: "Internet",
        health: "unknown",
      },
      sourcePosition: "right",
    });
  };

  const addLoadBalancerNode = (id: string, label: string, address: string | undefined, health: ResourceHealth, detailKind: ResourceKind, resource?: KubeObjectLike) => {
    addInternetNode();
    const extra = address
      ? (label === address ? undefined : address.startsWith("Port ") ? address : `Address ${address}`)
      : "Address pending";

    addNode(nodes, {
      id,
      type: "loadbalancer",
      data: {
        label,
        type: "loadbalancer",
        kind: "LoadBalancer",
        detailKind,
        namespace: resource?.getNs(),
        extra,
        health,
        resource,
      },
      sourcePosition: "right",
      targetPosition: "left",
    });
    addEdge(edges, internetId, id, "internet");
  };

  const addServiceNode = (service: ServiceLike, servicePods: PodLike[]) => {
    const serviceId = resourceKey("Service", service);
    serviceIdsSeen.add(serviceId);
    addNode(nodes, {
      id: serviceId,
      type: "custom",
      data: {
        label: service.getName(),
        type: "service",
        kind: "Service",
        namespace: service.getNs(),
        extra: serviceSummary(service, servicePods),
        detail: serviceDetail(service, servicePods),
        health: serviceHealth(service, servicePods),
        resource: service,
      },
      sourcePosition: "right",
      targetPosition: "left",
    });
    return serviceId;
  };

  const connectWorkloadReferences = (entry: WorkloadEntry) => {
    const { workload, kind } = entry;
    const workloadId = resourceKey(kind, workload);
    const refs = collectWorkloadRefs(workload);

    refs.configMaps.forEach(name => {
      const configMap = configMapIndex.get(objectKey("ConfigMap", workload.getNs(), name));
      if (!configMap) return;
      const configMapId = resourceKey("ConfigMap", configMap);
      addConfigMapNode(nodes, configMap);
      addEdge(edges, configMapId, workloadId, "config", "config");
    });

    refs.secrets.forEach(name => {
      const secret = secretIndex.get(objectKey("Secret", workload.getNs(), name));
      if (!secret) return;
      const secretId = resourceKey("Secret", secret);
      addSecretNode(nodes, secret);
      addEdge(edges, secretId, workloadId, "secret", "secret");
    });

    refs.persistentVolumeClaims.forEach(name => {
      const pvc = pvcIndex.get(objectKey("PersistentVolumeClaim", workload.getNs(), name));
      if (!pvc) return;
      const pvcId = resourceKey("PersistentVolumeClaim", pvc);
      addPersistentVolumeClaimNode(nodes, pvc);
      addEdge(edges, pvcId, workloadId, "storage", "volume");
    });

    if (kind === "StatefulSet") {
      pvcs
        .filter(pvc => pvc.getNs() === workload.getNs() && pvcBelongsToStatefulSet(pvc, workload))
        .forEach(pvc => {
          addPersistentVolumeClaimNode(nodes, pvc);
          addEdge(edges, resourceKey("PersistentVolumeClaim", pvc), workloadId, "storage", "volume");
        });
    }
  };

  const connectOwnedPods = (entry: WorkloadEntry) => {
    const workloadId = resourceKey(entry.kind, entry.workload);

    pods
      .filter(pod => isPodOwnedByWorkload(pod, entry, replicaSetOwners))
      .slice(0, 12)
      .forEach(pod => {
        addPodNode(nodes, pod);
        addEdge(edges, workloadId, resourceKey("Pod", pod), "pod");
      });
  };

  const connectServiceToBackends = (service: ServiceLike) => {
    const servicePods = podsForService(service, pods, endpoints);
    const serviceId = addServiceNode(service, servicePods);
    const workloads = workloadsForService(service, workloadIndex, servicePods, replicaSetOwners);

    workloads.forEach(entry => {
      const { workload, kind } = entry;
      const workloadId = resourceKey(kind, workload);
      workloadIdsSeen.add(workloadId);
      addWorkloadNode(nodes, entry);
      connectWorkloadReferences(entry);
      if (kind === "StatefulSet" || kind === "DaemonSet") connectOwnedPods(entry);
      addEdge(edges, serviceId, workloadId, "workload");
    });

    if (workloads.length === 0) {
      servicePods.slice(0, 12).forEach(pod => {
        addPodNode(nodes, pod);
        addEdge(edges, serviceId, resourceKey("Pod", pod), "pod");
      });
    }
  };

  ingresses.forEach(ingress => {
    const lbId = `lb:${ingress.getNs()}:${ingress.getName()}`;
    const ingressId = resourceKey("Ingress", ingress);
    const address = getIngressAddress(ingress);

    addLoadBalancerNode(lbId, address ? "Ingress LB" : "Pending LB", address, ingressHealth(ingress), "Ingress", ingress);
    addNode(nodes, {
      id: ingressId,
      type: "custom",
      data: {
        label: ingress.getName(),
        type: "ingress",
        kind: "Ingress",
        namespace: ingress.getNs(),
        extra: ingressSummary(ingress),
        detail: ingressDetail(ingress),
        health: ingressHealth(ingress),
        resource: ingress,
      },
      sourcePosition: "right",
      targetPosition: "left",
    });
    addEdge(edges, lbId, ingressId, "ingress");

    ingressBackends(ingress).forEach(backend => {
      const service = serviceIndex.get(objectKey("Service", ingress.getNs(), backend.serviceName));
      if (!service) return;
      const servicePods = podsForService(service, pods, endpoints);
      const serviceId = addServiceNode(service, servicePods);
      addEdge(edges, ingressId, serviceId, "service");
      connectServiceToBackends(service);
    });
  });

  services.forEach(service => {
    if (serviceIdsSeen.has(resourceKey("Service", service))) return;

    const address = getServiceAddress(service);
    const isExternal = service.spec?.type === "LoadBalancer" || service.spec?.type === "NodePort";
    if (isExternal) {
      const lbId = `service-entry:${service.getNs()}:${service.getName()}`;
      const label = service.spec?.type === "NodePort" ? "NodePort" : address ? "Service LB" : "Pending LB";
      addLoadBalancerNode(lbId, label, service.spec?.type === "NodePort" ? servicePortSummary(service) : address, service.spec?.type === "NodePort" ? "healthy" : address ? "healthy" : "pending", "Service", service);
      addEdge(edges, lbId, resourceKey("Service", service), "service");
    }

    if (isExternal || Object.keys(service.spec?.selector ?? {}).length > 0) {
      connectServiceToBackends(service);
    }
  });

  Array.from(workloadIndex.values())
    .filter(({ workload }) => namespaces.has(workload.getNs()))
    .forEach(entry => {
      const { workload, kind } = entry;
      const workloadId = resourceKey(kind, workload);
      if (workloadIdsSeen.has(workloadId)) return;
      addWorkloadNode(nodes, entry);
      connectWorkloadReferences(entry);
      if (kind === "StatefulSet" || kind === "DaemonSet") connectOwnedPods(entry);
    });

  replicaSets.forEach(replicaSet => {
    addReplicaSetNode(nodes, replicaSet);

    const owner = replicaSet.metadata?.ownerReferences?.find(ref => ref.kind === "Deployment" && ref.name);
    if (owner?.name) {
      const ownerId = objectKey("Deployment", replicaSet.getNs(), owner.name);
      if (nodes.has(ownerId)) {
        addEdge(edges, ownerId, resourceKey("ReplicaSet", replicaSet), "replicaset");
      }
    }

    pods
      .filter(pod => pod.metadata?.ownerReferences?.some(ref => ref.kind === "ReplicaSet" && ref.name === replicaSet.getName()))
      .slice(0, 12)
      .forEach(pod => {
        addPodNode(nodes, pod);
        addEdge(edges, resourceKey("ReplicaSet", replicaSet), resourceKey("Pod", pod), "pod");
      });
  });

  Array.from(configMapIndex.values()).forEach(configMap => addConfigMapNode(nodes, configMap));
  Array.from(secretIndex.values()).forEach(secret => addSecretNode(nodes, secret));
  Array.from(pvcIndex.values()).forEach(pvc => addPersistentVolumeClaimNode(nodes, pvc));

  const filteredGraph = filterVisibleKinds({
    nodes: Array.from(nodes.values()),
    edges: Array.from(edges.values()),
  }, options.visibleKinds);

  const laidOutNodes = layout(filteredGraph.nodes, filteredGraph.edges, direction).map(node => ({
    ...node,
    position: {
      x: node.position.x + (direction === "TB" ? 320 : -NODE_WIDTH + 150),
      y: node.position.y + (direction === "TB" ? 28 : 120),
    },
  }));

  return {
    nodes: laidOutNodes,
    edges: filteredGraph.edges,
  };
}
