export type ResourceKind =
  | "Internet"
  | "LoadBalancer"
  | "Ingress"
  | "Service"
  | "Deployment"
  | "StatefulSet"
  | "DaemonSet"
  | "Pod"
  | "Unknown";

export type ResourceHealth = "healthy" | "warning" | "error" | "pending" | "unknown";

export interface OwnerReferenceLike {
  kind?: string;
  name?: string;
}

export interface KubeObjectLike {
  getId(): string;
  getName(): string;
  getNs(): string;
  selfLink?: string;
  metadata?: {
    name?: string;
    namespace?: string;
    labels?: Record<string, string>;
    ownerReferences?: OwnerReferenceLike[];
  };
}

export interface NamespaceLike {
  getName(): string;
}

export interface IngressLike extends KubeObjectLike {
  spec?: {
    defaultBackend?: unknown;
    rules?: Array<{
      host?: string;
      http?: {
        paths?: Array<{
          path?: string;
          backend?: unknown;
        }>;
      };
    }>;
  };
  status?: {
    loadBalancer?: {
      ingress?: Array<{
        ip?: string;
        hostname?: string;
      }>;
    };
  };
}

export interface ServiceLike extends KubeObjectLike {
  spec?: {
    selector?: Record<string, string>;
    type?: string;
    clusterIP?: string;
    ports?: Array<{
      port?: number;
      targetPort?: number | string;
      nodePort?: number;
      protocol?: string;
    }>;
  };
  status?: {
    loadBalancer?: {
      ingress?: Array<{
        ip?: string;
        hostname?: string;
      }>;
    };
  };
}

export interface PodLike extends KubeObjectLike {
  spec?: {
    nodeName?: string;
  };
  status?: {
    phase?: string;
    conditions?: Array<{
      type?: string;
      status?: string;
    }>;
    containerStatuses?: Array<{
      ready?: boolean;
    }>;
  };
}

export interface WorkloadLike extends KubeObjectLike {
  kind?: ResourceKind;
  spec?: {
    replicas?: number;
    selector?: {
      matchLabels?: Record<string, string>;
    };
    template?: {
      metadata?: {
        labels?: Record<string, string>;
      };
    };
  };
  status?: {
    readyReplicas?: number;
    availableReplicas?: number;
    numberReady?: number;
    replicas?: number;
    currentNumberScheduled?: number;
    desiredNumberScheduled?: number;
  };
}

export interface ReplicaSetLike extends WorkloadLike {
  metadata?: WorkloadLike["metadata"] & {
    ownerReferences?: OwnerReferenceLike[];
  };
}

export interface EndpointLike extends KubeObjectLike {
  subsets?: Array<{
    addresses?: Array<{
      ip?: string;
      targetRef?: {
        kind?: string;
        name?: string;
        namespace?: string;
      };
    }>;
  }>;
}

export interface WorkloadResources {
  namespaces: string[];
  ingresses: IngressLike[];
  services: ServiceLike[];
  pods?: PodLike[];
  endpoints?: EndpointLike[];
  deployments?: WorkloadLike[];
  statefulSets?: WorkloadLike[];
  daemonSets?: WorkloadLike[];
  replicaSets?: ReplicaSetLike[];
}

export interface FlowNodeData {
  label: string;
  type: string;
  kind: ResourceKind;
  namespace?: string;
  extra?: string;
  detail?: string;
  health: ResourceHealth;
  resource?: KubeObjectLike;
}

export interface FlowNode {
  id: string;
  type: "custom" | "cloud" | "loadbalancer";
  data: FlowNodeData;
  position: {
    x: number;
    y: number;
  };
  sourcePosition?: string;
  targetPosition?: string;
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  type: "smoothstep";
  animated?: boolean;
  label?: string;
  data?: {
    label?: string;
  };
  style?: {
    stroke: string;
    strokeWidth: number;
    strokeDasharray?: string;
  };
  markerEnd?: {
    type: string;
    color: string;
    width: number;
    height: number;
  };
}

export interface WorkloadGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
}
