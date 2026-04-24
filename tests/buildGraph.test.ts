import test from "node:test";
import assert from "node:assert/strict";
import { buildWorkloadGraph } from "../graph/buildGraph";
import {
  ConfigMapLike,
  IngressLike,
  PersistentVolumeClaimLike,
  PodLike,
  ReplicaSetLike,
  SecretLike,
  ServiceLike,
  WorkloadLike,
  WorkloadResources,
} from "../graph/types";

function kube<T extends object>(kind: string, namespace: string, name: string, extra: Partial<T>): T & {
  getId(): string;
  getName(): string;
  getNs(): string;
  metadata: {
    name: string;
    namespace: string;
    labels?: Record<string, string>;
    ownerReferences?: Array<{ kind?: string; name?: string }>;
  };
} {
  const metadata = {
    name,
    namespace,
    ...(extra as { metadata?: object }).metadata,
  };

  return {
    ...extra,
    metadata,
    getId: () => `${namespace}-${kind}-${name}`,
    getName: () => name,
    getNs: () => namespace,
  } as T & {
    getId(): string;
    getName(): string;
    getNs(): string;
    metadata: {
      name: string;
      namespace: string;
      labels?: Record<string, string>;
      ownerReferences?: Array<{ kind?: string; name?: string }>;
    };
  };
}

const baseResources: WorkloadResources = {
  namespaces: ["default"],
  ingresses: [],
  services: [],
};

test("builds ingress to service to deployment through pod owner chain", () => {
  const ingress = kube<IngressLike>("Ingress", "default", "web", {
    spec: {
      defaultBackend: { service: { name: "web" } },
      rules: [
        {
          host: "app.example.test",
          http: {
            paths: [
              { path: "/", backend: { service: { name: "web" } } },
              { path: "/again", backend: { service: { name: "web" } } },
            ],
          },
        },
      ],
    },
    status: { loadBalancer: { ingress: [{ hostname: "lb.example.test" }] } },
  });

  const service = kube<ServiceLike>("Service", "default", "web", {
    spec: {
      type: "ClusterIP",
      selector: { app: "web" },
      ports: [{ port: 80 }],
    },
  });

  const deployment = kube<WorkloadLike>("Deployment", "default", "web", {
    spec: {
      replicas: 2,
      template: { metadata: { labels: { app: "web" } } },
    },
    status: { readyReplicas: 2, replicas: 2 },
  });

  const replicaSet = kube<ReplicaSetLike>("ReplicaSet", "default", "web-abc", {
    metadata: { ownerReferences: [{ kind: "Deployment", name: "web" }] },
  });

  const pod = kube<PodLike>("Pod", "default", "web-abc-1", {
    metadata: {
      labels: { app: "web" },
      ownerReferences: [{ kind: "ReplicaSet", name: "web-abc" }],
    },
    status: { phase: "Running", conditions: [{ type: "Ready", status: "True" }] },
  });

  const graph = buildWorkloadGraph({
    ...baseResources,
    ingresses: [ingress],
    services: [service],
    deployments: [deployment],
    replicaSets: [replicaSet],
    pods: [pod],
  });

  const ids = graph.nodes.map(node => node.id);
  assert.ok(ids.includes("Ingress:default:web"));
  assert.ok(ids.includes("Service:default:web"));
  assert.ok(ids.includes("Deployment:default:web"));
  assert.ok(ids.includes("lb:default:web"));

  assert.equal(
    graph.edges.filter(edge => edge.source === "Ingress:default:web" && edge.target === "Service:default:web").length,
    3
  );
  assert.ok(graph.edges.some(edge => edge.source === "Service:default:web" && edge.target === "Deployment:default:web"));
});

test("shows external load balancer services without ingresses", () => {
  const service = kube<ServiceLike>("Service", "default", "api", {
    spec: {
      type: "LoadBalancer",
      selector: { app: "api" },
      ports: [{ port: 443 }],
    },
    status: { loadBalancer: { ingress: [{ ip: "10.0.0.10" }] } },
  });

  const deployment = kube<WorkloadLike>("Deployment", "default", "api", {
    spec: {
      replicas: 1,
      template: { metadata: { labels: { app: "api" } } },
    },
    status: { readyReplicas: 1, replicas: 1 },
  });

  const graph = buildWorkloadGraph({
    ...baseResources,
    services: [service],
    deployments: [deployment],
  });

  assert.ok(graph.nodes.some(node => node.id === "internet"));
  assert.ok(graph.nodes.some(node => node.id === "service-entry:default:api"));
  assert.ok(graph.edges.some(edge => edge.source === "service-entry:default:api" && edge.target === "Service:default:api"));
  assert.ok(graph.edges.some(edge => edge.source === "Service:default:api" && edge.target === "Deployment:default:api"));
});

test("falls back to pod nodes when no owning workload is known", () => {
  const service = kube<ServiceLike>("Service", "default", "standalone", {
    spec: {
      type: "ClusterIP",
      selector: { run: "standalone" },
      ports: [{ port: 8080 }],
    },
  });

  const pod = kube<PodLike>("Pod", "default", "standalone-1", {
    metadata: { labels: { run: "standalone" } },
    status: { phase: "Running", conditions: [{ type: "Ready", status: "True" }] },
  });

  const graph = buildWorkloadGraph({
    ...baseResources,
    services: [service],
    pods: [pod],
  });

  assert.ok(graph.nodes.some(node => node.id === "Pod:default:standalone-1"));
  assert.ok(graph.edges.some(edge => edge.source === "Service:default:standalone" && edge.target === "Pod:default:standalone-1"));
});

test("connects workloads to referenced config maps secrets and persistent volume claims", () => {
  const deployment = kube<WorkloadLike>("Deployment", "default", "api", {
    spec: {
      replicas: 1,
      template: {
        metadata: { labels: { app: "api" } },
        spec: {
          containers: [
            {
              envFrom: [
                { configMapRef: { name: "api-config" } },
                { secretRef: { name: "api-secret" } },
              ],
              env: [
                { valueFrom: { configMapKeyRef: { name: "feature-flags" } } },
                { valueFrom: { secretKeyRef: { name: "api-token" } } },
              ],
            },
          ],
          volumes: [
            { persistentVolumeClaim: { claimName: "api-data" } },
            { configMap: { name: "api-config" } },
            { secret: { secretName: "api-secret" } },
          ],
        },
      },
    },
    status: { readyReplicas: 1, replicas: 1 },
  });

  const graph = buildWorkloadGraph({
    ...baseResources,
    deployments: [deployment],
    configMaps: [
      kube<ConfigMapLike>("ConfigMap", "default", "api-config", { data: { A: "1" } }),
      kube<ConfigMapLike>("ConfigMap", "default", "feature-flags", { data: { enabled: "true" } }),
    ],
    secrets: [
      kube<SecretLike>("Secret", "default", "api-secret", { type: "Opaque", data: { password: "x" } }),
      kube<SecretLike>("Secret", "default", "api-token", { type: "Opaque", data: { token: "x" } }),
    ],
    persistentVolumeClaims: [
      kube<PersistentVolumeClaimLike>("PersistentVolumeClaim", "default", "api-data", {
        status: { phase: "Bound", capacity: { storage: "10Gi" } },
      }),
    ],
  });

  assert.ok(graph.nodes.some(node => node.id === "ConfigMap:default:api-config"));
  assert.ok(graph.nodes.some(node => node.id === "ConfigMap:default:feature-flags"));
  assert.ok(graph.nodes.some(node => node.id === "Secret:default:api-secret"));
  assert.ok(graph.nodes.some(node => node.id === "Secret:default:api-token"));
  assert.ok(graph.nodes.some(node => node.id === "PersistentVolumeClaim:default:api-data"));
  assert.ok(graph.edges.some(edge => edge.source === "Deployment:default:api" && edge.target === "ConfigMap:default:api-config"));
  assert.ok(graph.edges.some(edge => edge.source === "Deployment:default:api" && edge.target === "Secret:default:api-secret"));
  assert.ok(graph.edges.some(edge => edge.source === "Deployment:default:api" && edge.target === "PersistentVolumeClaim:default:api-data"));
});

test("supports top to bottom layout and visible resource filtering", () => {
  const deployment = kube<WorkloadLike>("Deployment", "default", "api", {
    spec: {
      replicas: 1,
      template: {
        metadata: { labels: { app: "api" } },
        spec: {
          containers: [{ envFrom: [{ secretRef: { name: "api-secret" } }] }],
        },
      },
    },
    status: { readyReplicas: 1, replicas: 1 },
  });

  const graph = buildWorkloadGraph(
    {
      ...baseResources,
      deployments: [deployment],
      secrets: [
        kube<SecretLike>("Secret", "default", "api-secret", { type: "Opaque" }),
      ],
    },
    {
      direction: "TB",
      visibleKinds: ["Deployment", "Secret"],
    }
  );

  const deploymentNode = graph.nodes.find(node => node.id === "Deployment:default:api");
  const secretNode = graph.nodes.find(node => node.id === "Secret:default:api-secret");

  assert.ok(deploymentNode);
  assert.ok(secretNode);
  assert.equal(deploymentNode.sourcePosition, "bottom");
  assert.equal(secretNode.targetPosition, "top");
  assert.ok(secretNode.position.y > deploymentNode.position.y);
  assert.deepEqual(graph.nodes.map(node => node.data.kind).sort(), ["Deployment", "Secret"]);
});
