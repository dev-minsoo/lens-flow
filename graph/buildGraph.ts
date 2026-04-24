import {
  ConfigMapLike,
  EndpointLike,
  FlowEdge,
  FlowNode,
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
  WorkloadLike,
  WorkloadResources,
} from "./types";

const EDGE_COLORS: Record<string, string> = {
  internet: "#64748b",
  ingress: "#8b5cf6",
  service: "#0ea5e9",
  workload: "#10b981",
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
  Deployment: 4,
  StatefulSet: 4,
  DaemonSet: 4,
  Pod: 5,
  ConfigMap: 5,
  Secret: 5,
  PersistentVolumeClaim: 5,
  Unknown: 6,
};

const NODE_WIDTH = 220;
const RANK_GAP = 280;
const ROW_GAP = 130;

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

function servicePortSummary(service: ServiceLike): string | undefined {
  const ports = service.spec?.ports ?? [];
  if (ports.length === 0) return service.spec?.type;

  const formatted = ports
    .slice(0, 2)
    .map(port => {
      const exposed = port.nodePort ?? port.port;
      return exposed ? String(exposed) : undefined;
    })
    .filter(Boolean)
    .join(", ");

  const suffix = ports.length > 2 ? ` +${ports.length - 2}` : "";
  return formatted ? `${service.spec?.type ?? "Service"} ${formatted}${suffix}` : service.spec?.type;
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
    return `${ready}/${desired}`;
  }

  const total = workload.status?.replicas ?? workload.spec?.replicas ?? 0;
  const ready = workload.status?.readyReplicas ?? workload.status?.availableReplicas ?? 0;
  return `${ready}/${total}`;
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
  if (pods.length === 0) return "warning";
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
    type: "smoothstep",
    animated: true,
    label,
    data: { label },
    style: {
      stroke: color,
      strokeWidth: 2.25,
      strokeDasharray: "7 7",
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
    return deployment ? objectKey(deployment.kind, pod.getNs(), deployment.name) : objectKey("Unknown", pod.getNs(), owner.name);
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

function layout(nodes: FlowNode[], edges: FlowEdge[]): FlowNode[] {
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  edges.forEach(edge => {
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  });

  const byRank = new Map<number, FlowNode[]>();
  nodes.forEach(node => {
    const rank = KIND_RANK[node.data.kind] ?? KIND_RANK.Unknown;
    byRank.set(rank, [...(byRank.get(rank) ?? []), node]);
  });

  return nodes.map(node => {
    const rank = KIND_RANK[node.data.kind] ?? KIND_RANK.Unknown;
    const rankNodes = byRank.get(rank) ?? [];
    const ordered = [...rankNodes].sort((a, b) => {
      const diff = (incoming.get(b.id) ?? 0) - (incoming.get(a.id) ?? 0);
      if (diff !== 0) return diff;
      return a.data.label.localeCompare(b.data.label);
    });
    const index = ordered.findIndex(item => item.id === node.id);
    const offset = -((ordered.length - 1) * ROW_GAP) / 2;

    return {
      ...node,
      position: {
        x: rank * RANK_GAP,
        y: offset + index * ROW_GAP,
      },
    };
  });
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
      extra: `${dataKeys} keys`,
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
      extra: secret.type ?? `${dataKeys} keys`,
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
      extra: pvc.status?.capacity?.storage ?? pvc.spec?.resources?.requests?.storage ?? phase,
      health: phase === "Bound" ? "healthy" : phase === "Pending" ? "pending" : "unknown",
      resource: pvc,
    },
    sourcePosition: "right",
    targetPosition: "left",
  });
}

export function buildWorkloadGraph(resources: WorkloadResources): WorkloadGraph {
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
  const pvcIndex = buildResourceIndex("PersistentVolumeClaim", (resources.persistentVolumeClaims ?? []).filter(item => namespaces.has(item.getNs())));
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

  const addLoadBalancerNode = (id: string, label: string, address: string | undefined, health: ResourceHealth, resource?: KubeObjectLike) => {
    addInternetNode();
    addNode(nodes, {
      id,
      type: "loadbalancer",
      data: {
        label,
        type: "loadbalancer",
        kind: "LoadBalancer",
        extra: address ?? "...",
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
        extra: servicePortSummary(service),
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
      addEdge(edges, workloadId, configMapId, "config", "config");
    });

    refs.secrets.forEach(name => {
      const secret = secretIndex.get(objectKey("Secret", workload.getNs(), name));
      if (!secret) return;
      const secretId = resourceKey("Secret", secret);
      addSecretNode(nodes, secret);
      addEdge(edges, workloadId, secretId, "secret", "secret");
    });

    refs.persistentVolumeClaims.forEach(name => {
      const pvc = pvcIndex.get(objectKey("PersistentVolumeClaim", workload.getNs(), name));
      if (!pvc) return;
      const pvcId = resourceKey("PersistentVolumeClaim", pvc);
      addPersistentVolumeClaimNode(nodes, pvc);
      addEdge(edges, workloadId, pvcId, "storage", "volume");
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
      addEdge(edges, serviceId, workloadId, "workload");
    });

    if (workloads.length === 0) {
      servicePods.slice(0, 12).forEach(pod => {
        const podId = resourceKey("Pod", pod);
        addNode(nodes, {
          id: podId,
          type: "custom",
          data: {
            label: pod.getName(),
            type: "pod",
            kind: "Pod",
            namespace: pod.getNs(),
            extra: pod.status?.phase,
            health: podHealth(pod),
            resource: pod,
          },
          sourcePosition: "right",
          targetPosition: "left",
        });
        addEdge(edges, serviceId, podId, "pod");
      });
    }
  };

  ingresses.forEach(ingress => {
    const lbId = `lb:${ingress.getNs()}:${ingress.getName()}`;
    const ingressId = resourceKey("Ingress", ingress);
    const address = getIngressAddress(ingress);

    addLoadBalancerNode(lbId, address ? "Ingress LB" : "Pending LB", address, ingressHealth(ingress), ingress);
    addNode(nodes, {
      id: ingressId,
      type: "custom",
      data: {
        label: ingress.getName(),
        type: "ingress",
        kind: "Ingress",
        namespace: ingress.getNs(),
        extra: ingress.spec?.rules?.map(rule => rule.host).filter(Boolean).slice(0, 2).join(", "),
        detail: ingress.spec?.rules?.map(rule => rule.host).filter(Boolean).join(", "),
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
      addEdge(edges, ingressId, serviceId, "service", backend.label);
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
      addLoadBalancerNode(lbId, label, address, service.spec?.type === "NodePort" ? "healthy" : address ? "healthy" : "pending", service);
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
    });

  const laidOutNodes = layout(Array.from(nodes.values()), Array.from(edges.values())).map(node => ({
    ...node,
    position: {
      x: node.position.x - NODE_WIDTH,
      y: node.position.y + 300,
    },
  }));

  return {
    nodes: laidOutNodes,
    edges: Array.from(edges.values()),
  };
}
