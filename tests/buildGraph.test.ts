import test from "node:test";
import assert from "node:assert/strict";
import { buildWorkloadGraph } from "../graph/buildGraph";
import {
  clusterPreferenceKeys,
  parseWorkloadFlowPageSettings,
  storedNamespaceForCluster,
} from "../components/workloadFlowPageSettings";
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
    1
  );
  assert.ok(graph.edges.every(edge => edge.source !== "Ingress:default:web" || !edge.label));
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
  assert.equal(graph.nodes.find(node => node.id === "Service:default:api")?.data.health, "healthy");
  assert.ok(graph.edges.some(edge => edge.source === "service-entry:default:api" && edge.target === "Service:default:api"));
  assert.ok(graph.edges.some(edge => edge.source === "Service:default:api" && edge.target === "Deployment:default:api"));
});

test("connects a single service to multiple matching workloads", () => {
  const service = kube<ServiceLike>("Service", "default", "shared-api", {
    spec: {
      type: "ClusterIP",
      selector: { app: "shared-api" },
      ports: [{ port: 80 }],
    },
  });

  const deploymentA = kube<WorkloadLike>("Deployment", "default", "shared-api-a", {
    spec: {
      replicas: 1,
      template: { metadata: { labels: { app: "shared-api" } } },
    },
    status: { readyReplicas: 1, replicas: 1 },
  });

  const deploymentB = kube<WorkloadLike>("Deployment", "default", "shared-api-b", {
    spec: {
      replicas: 1,
      template: { metadata: { labels: { app: "shared-api" } } },
    },
    status: { readyReplicas: 1, replicas: 1 },
  });

  const graph = buildWorkloadGraph({
    ...baseResources,
    services: [service],
    deployments: [deploymentA, deploymentB],
  });

  assert.ok(graph.edges.some(edge => edge.source === "Service:default:shared-api" && edge.target === "Deployment:default:shared-api-a"));
  assert.ok(graph.edges.some(edge => edge.source === "Service:default:shared-api" && edge.target === "Deployment:default:shared-api-b"));

  const nodeA = graph.nodes.find(node => node.id === "Deployment:default:shared-api-a");
  const nodeB = graph.nodes.find(node => node.id === "Deployment:default:shared-api-b");

  assert.ok(nodeA);
  assert.ok(nodeB);
  assert.notEqual(nodeA.position.y, nodeB.position.y);
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
  assert.ok(graph.edges.some(edge => edge.source === "ConfigMap:default:api-config" && edge.target === "Deployment:default:api"));
  assert.ok(graph.edges.some(edge => edge.source === "Secret:default:api-secret" && edge.target === "Deployment:default:api"));
  assert.ok(graph.edges.some(edge => edge.source === "PersistentVolumeClaim:default:api-data" && edge.target === "Deployment:default:api"));
  assert.ok(graph.edges.every(edge => edge.label === undefined));

  const deploymentNode = graph.nodes.find(node => node.id === "Deployment:default:api");
  const configNode = graph.nodes.find(node => node.id === "ConfigMap:default:api-config");
  const secretNode = graph.nodes.find(node => node.id === "Secret:default:api-secret");

  assert.ok(deploymentNode);
  assert.ok(configNode);
  assert.ok(secretNode);
  assert.ok(configNode.position.x < deploymentNode.position.x);
  assert.ok(secretNode.position.x < deploymentNode.position.x);
});

test("shows standalone config maps secrets and persistent volume claims in selected namespaces", () => {
  const graph = buildWorkloadGraph({
    ...baseResources,
    configMaps: [
      kube<ConfigMapLike>("ConfigMap", "default", "standalone-config", { data: { A: "1" } }),
      kube<ConfigMapLike>("ConfigMap", "other", "hidden-config", { data: { A: "1" } }),
    ],
    secrets: [
      kube<SecretLike>("Secret", "default", "standalone-secret", { type: "Opaque" }),
    ],
    persistentVolumeClaims: [
      kube<PersistentVolumeClaimLike>("PersistentVolumeClaim", "default", "standalone-data", {
        status: { phase: "Bound", capacity: { storage: "1Gi" } },
      }),
    ],
  });

  assert.ok(graph.nodes.some(node => node.id === "ConfigMap:default:standalone-config"));
  assert.ok(graph.nodes.some(node => node.id === "Secret:default:standalone-secret"));
  assert.ok(graph.nodes.some(node => node.id === "PersistentVolumeClaim:default:standalone-data"));
  assert.ok(!graph.nodes.some(node => node.id === "ConfigMap:other:hidden-config"));
});

test("connects deployments to replica sets and owned pods", () => {
  const deployment = kube<WorkloadLike>("Deployment", "default", "web", {
    spec: {
      replicas: 1,
      template: { metadata: { labels: { app: "web" } } },
    },
    status: { readyReplicas: 1, replicas: 1 },
  });
  const replicaSet = kube<ReplicaSetLike>("ReplicaSet", "default", "web-abc", {
    metadata: {
      annotations: { "deployment.kubernetes.io/revision": "7" },
      ownerReferences: [{ kind: "Deployment", name: "web" }],
    },
    status: { readyReplicas: 1, replicas: 1 },
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
    deployments: [deployment],
    replicaSets: [replicaSet],
    pods: [pod],
  });

  assert.ok(graph.nodes.some(node => node.id === "ReplicaSet:default:web-abc"));
  assert.ok(graph.nodes.some(node => node.id === "Pod:default:web-abc-1"));
  assert.equal(graph.nodes.find(node => node.id === "ReplicaSet:default:web-abc")?.data.extra, "Rev 7 · Ready 1/1");
  assert.ok(graph.edges.some(edge => edge.source === "Deployment:default:web" && edge.target === "ReplicaSet:default:web-abc"));
  assert.ok(graph.edges.some(edge => edge.source === "ReplicaSet:default:web-abc" && edge.target === "Pod:default:web-abc-1"));

  const filteredGraph = buildWorkloadGraph(
    {
      ...baseResources,
      deployments: [deployment],
      replicaSets: [replicaSet],
      pods: [pod],
    },
    {
      visibleKinds: ["Deployment", "Pod"],
    }
  );

  assert.deepEqual(filteredGraph.nodes.map(node => node.data.kind).sort(), ["Deployment", "Pod"]);
  assert.ok(filteredGraph.edges.some(edge => edge.source === "Deployment:default:web" && edge.target === "Pod:default:web-abc-1"));

  const deploymentNode = filteredGraph.nodes.find(node => node.id === "Deployment:default:web");
  const podNode = filteredGraph.nodes.find(node => node.id === "Pod:default:web-abc-1");

  assert.ok(deploymentNode);
  assert.ok(podNode);
  assert.ok(podNode.position.x > deploymentNode.position.x);
});

test("orders replica sets by revision with newest first", () => {
  const deployment = kube<WorkloadLike>("Deployment", "default", "web", {
    spec: {
      replicas: 1,
      template: { metadata: { labels: { app: "web" } } },
    },
    status: { readyReplicas: 1, replicas: 1 },
  });
  const replicaSetOld = kube<ReplicaSetLike>("ReplicaSet", "default", "web-old", {
    metadata: {
      annotations: { "deployment.kubernetes.io/revision": "3" },
      ownerReferences: [{ kind: "Deployment", name: "web" }],
    },
    status: { readyReplicas: 1, replicas: 1 },
  });
  const replicaSetNew = kube<ReplicaSetLike>("ReplicaSet", "default", "web-new", {
    metadata: {
      annotations: { "deployment.kubernetes.io/revision": "8" },
      ownerReferences: [{ kind: "Deployment", name: "web" }],
    },
    status: { readyReplicas: 1, replicas: 1 },
  });

  const graphLr = buildWorkloadGraph({
    ...baseResources,
    deployments: [deployment],
    replicaSets: [replicaSetOld, replicaSetNew],
  });

  const rsOldLr = graphLr.nodes.find(node => node.id === "ReplicaSet:default:web-old");
  const rsNewLr = graphLr.nodes.find(node => node.id === "ReplicaSet:default:web-new");

  assert.ok(rsOldLr);
  assert.ok(rsNewLr);
  assert.ok(rsNewLr.position.y < rsOldLr.position.y);

  const graphTb = buildWorkloadGraph({
    ...baseResources,
    deployments: [deployment],
    replicaSets: [replicaSetOld, replicaSetNew],
  }, {
    direction: "TB",
  });

  const rsOldTb = graphTb.nodes.find(node => node.id === "ReplicaSet:default:web-old");
  const rsNewTb = graphTb.nodes.find(node => node.id === "ReplicaSet:default:web-new");

  assert.ok(rsOldTb);
  assert.ok(rsNewTb);
  assert.ok(rsNewTb.position.x > rsOldTb.position.x);
});

test("starts disconnected components at the load balancer column", () => {
  const ingress = kube<IngressLike>("Ingress", "default", "web", {
    spec: {
      defaultBackend: { service: { name: "web" } },
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
  const deploymentConnected = kube<WorkloadLike>("Deployment", "default", "web", {
    spec: {
      replicas: 1,
      template: { metadata: { labels: { app: "web" } } },
    },
    status: { readyReplicas: 1, replicas: 1 },
  });
  const deploymentDisconnected = kube<WorkloadLike>("Deployment", "default", "worker", {
    spec: {
      replicas: 1,
      template: { metadata: { labels: { app: "worker" } } },
    },
    status: { readyReplicas: 1, replicas: 1 },
  });

  const graph = buildWorkloadGraph({
    ...baseResources,
    ingresses: [ingress],
    services: [service],
    deployments: [deploymentConnected, deploymentDisconnected],
  });

  const loadBalancerNode = graph.nodes.find(node => node.id === "lb:default:web");
  const disconnectedNode = graph.nodes.find(node => node.id === "Deployment:default:worker");

  assert.ok(loadBalancerNode);
  assert.ok(disconnectedNode);
  assert.ok(disconnectedNode.position.x >= loadBalancerNode.position.x);
});

test("keeps multiple disconnected components separated", () => {
  const ingress = kube<IngressLike>("Ingress", "default", "front", {
    spec: {
      defaultBackend: { service: { name: "front" } },
    },
    status: { loadBalancer: { ingress: [{ hostname: "lb.example.test" }] } },
  });
  const service = kube<ServiceLike>("Service", "default", "front", {
    spec: {
      type: "ClusterIP",
      selector: { app: "front" },
      ports: [{ port: 80 }],
    },
  });
  const connectedDeployment = kube<WorkloadLike>("Deployment", "default", "front", {
    spec: {
      replicas: 1,
      template: { metadata: { labels: { app: "front" } } },
    },
    status: { readyReplicas: 1, replicas: 1 },
  });
  const workerA = kube<WorkloadLike>("Deployment", "default", "worker-a", {
    spec: {
      replicas: 1,
      template: { metadata: { labels: { app: "worker-a" } } },
    },
    status: { readyReplicas: 1, replicas: 1 },
  });
  const workerB = kube<WorkloadLike>("Deployment", "default", "worker-b", {
    spec: {
      replicas: 1,
      template: { metadata: { labels: { app: "worker-b" } } },
    },
    status: { readyReplicas: 1, replicas: 1 },
  });

  const graph = buildWorkloadGraph({
    ...baseResources,
    ingresses: [ingress],
    services: [service],
    deployments: [connectedDeployment, workerA, workerB],
  });

  const nodeA = graph.nodes.find(node => node.id === "Deployment:default:worker-a");
  const nodeB = graph.nodes.find(node => node.id === "Deployment:default:worker-b");

  assert.ok(nodeA);
  assert.ok(nodeB);
  assert.notEqual(nodeA.position.y, nodeB.position.y);
});

test("connects stateful sets to owned pods and generated volume claim templates", () => {
  const statefulSet = kube<WorkloadLike>("StatefulSet", "default", "redis", {
    spec: {
      replicas: 1,
      volumeClaimTemplates: [{ metadata: { name: "data" } }],
      template: { metadata: { labels: { app: "redis" } } },
    },
    status: { readyReplicas: 1, replicas: 1 },
  });
  const pod = kube<PodLike>("Pod", "default", "redis-0", {
    metadata: {
      labels: { app: "redis" },
      ownerReferences: [{ kind: "StatefulSet", name: "redis" }],
    },
    status: { phase: "Running", conditions: [{ type: "Ready", status: "True" }] },
  });
  const pvc = kube<PersistentVolumeClaimLike>("PersistentVolumeClaim", "default", "data-redis-0", {
    status: { phase: "Bound", capacity: { storage: "8Gi" } },
  });

  const graph = buildWorkloadGraph({
    ...baseResources,
    statefulSets: [statefulSet],
    pods: [pod],
    persistentVolumeClaims: [pvc],
  });

  assert.ok(graph.nodes.some(node => node.id === "StatefulSet:default:redis"));
  assert.ok(graph.nodes.some(node => node.id === "Pod:default:redis-0"));
  assert.ok(graph.nodes.some(node => node.id === "PersistentVolumeClaim:default:data-redis-0"));
  assert.ok(graph.edges.some(edge => edge.source === "StatefulSet:default:redis" && edge.target === "Pod:default:redis-0"));
  assert.ok(graph.edges.some(edge => edge.source === "PersistentVolumeClaim:default:data-redis-0" && edge.target === "StatefulSet:default:redis"));
});

test("keeps replica sets and pods ordered without overlapping when many revisions exist", () => {
  const deployment = kube<WorkloadLike>("Deployment", "default", "web", {
    spec: {
      replicas: 3,
      template: { metadata: { labels: { app: "web" } } },
    },
    status: { readyReplicas: 3, replicas: 3 },
  });

  const replicaSets = [
    kube<ReplicaSetLike>("ReplicaSet", "default", "web-rs-1", {
      metadata: {
        annotations: { "deployment.kubernetes.io/revision": "1" },
        ownerReferences: [{ kind: "Deployment", name: "web" }],
      },
      status: { readyReplicas: 1, replicas: 1 },
    }),
    kube<ReplicaSetLike>("ReplicaSet", "default", "web-rs-2", {
      metadata: {
        annotations: { "deployment.kubernetes.io/revision": "2" },
        ownerReferences: [{ kind: "Deployment", name: "web" }],
      },
      status: { readyReplicas: 1, replicas: 1 },
    }),
    kube<ReplicaSetLike>("ReplicaSet", "default", "web-rs-3", {
      metadata: {
        annotations: { "deployment.kubernetes.io/revision": "3" },
        ownerReferences: [{ kind: "Deployment", name: "web" }],
      },
      status: { readyReplicas: 1, replicas: 1 },
    }),
  ];

  const pods = [
    kube<PodLike>("Pod", "default", "web-rs-1-pod", {
      metadata: {
        labels: { app: "web" },
        ownerReferences: [{ kind: "ReplicaSet", name: "web-rs-1" }],
      },
      status: { phase: "Running", conditions: [{ type: "Ready", status: "True" }] },
    }),
    kube<PodLike>("Pod", "default", "web-rs-2-pod", {
      metadata: {
        labels: { app: "web" },
        ownerReferences: [{ kind: "ReplicaSet", name: "web-rs-2" }],
      },
      status: { phase: "Running", conditions: [{ type: "Ready", status: "True" }] },
    }),
    kube<PodLike>("Pod", "default", "web-rs-3-pod", {
      metadata: {
        labels: { app: "web" },
        ownerReferences: [{ kind: "ReplicaSet", name: "web-rs-3" }],
      },
      status: { phase: "Running", conditions: [{ type: "Ready", status: "True" }] },
    }),
  ];

  const graph = buildWorkloadGraph({
    ...baseResources,
    deployments: [deployment],
    replicaSets,
    pods,
  });

  const rs1 = graph.nodes.find(node => node.id === "ReplicaSet:default:web-rs-1");
  const rs2 = graph.nodes.find(node => node.id === "ReplicaSet:default:web-rs-2");
  const rs3 = graph.nodes.find(node => node.id === "ReplicaSet:default:web-rs-3");

  assert.ok(rs1);
  assert.ok(rs2);
  assert.ok(rs3);
  assert.ok(rs3.position.y < rs2.position.y);
  assert.ok(rs2.position.y < rs1.position.y);
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
  assert.equal(deploymentNode.targetPosition, "top");
  assert.equal(secretNode.sourcePosition, "bottom");
  assert.ok(secretNode.position.y < deploymentNode.position.y);
  assert.deepEqual(graph.nodes.map(node => node.data.kind).sort(), ["Deployment", "Secret"]);
});

test("parses cluster specific namespace settings", () => {
  const settings = parseWorkloadFlowPageSettings(JSON.stringify({
    direction: "TB",
    visibleKinds: ["Service", "Deployment"],
    namespaceByCluster: {
      alpha: "team-a",
      beta: "team-b",
    },
  }));

  assert.equal(settings.direction, "TB");
  assert.equal(settings.namespaceByCluster.alpha, "team-a");
  assert.equal(settings.namespaceByCluster.beta, "team-b");
});

test("prefers kubeconfig context and entity id before display name for cluster keys", () => {
  const keys = clusterPreferenceKeys({
    spec: { kubeconfigContext: "search-agent-dev-context" },
    metadata: { uid: "cluster-uid", name: "search-agent-dev" },
    getId: () => "cluster-id",
    getName: () => "search-agent-dev",
  });

  assert.deepEqual(keys, [
    "search-agent-dev-context",
    "cluster-id",
    "search-agent-dev",
    "default",
  ]);
});

test("falls back through stored cluster keys in order", () => {
  const namespace = storedNamespaceForCluster(
    {
      "cluster-id": "team-a",
      default: "legacy",
    },
    ["search-agent-dev-context", "cluster-id", "search-agent-dev", "default"]
  );

  assert.equal(namespace, "team-a");
});

test("migrates legacy selected namespace into default cluster bucket", () => {
  const settings = parseWorkloadFlowPageSettings(JSON.stringify({
    selectedNamespace: "legacy-ns",
  }));

  assert.equal(settings.namespaceByCluster.default, "legacy-ns");
});
