# Lens Flow Lens Extension

A [Lens](https://k8slens.dev) (or [OpenLens](https://github.com/MuhammedKalkan/OpenLens)) extension that visualizes Kubernetes workload traffic paths as an interactive React Flow topology graph.

Lens Flow helps you see how external entry points, ingresses, services, pods, and workload controllers are connected inside the selected namespaces of a cluster.

## Requirements

- Lens (or OpenLens) `>= 6.0.0`
- Node.js `>= 20.0.0` for local development
- Kubernetes cluster access through Lens/OpenLens

> This extension reads Kubernetes resources from the Lens renderer API. No extra binary is required.

## Installing

For local installation while developing:

1. Clone or download this repository.
2. Install dependencies with `npm install`.
3. Build the extension with `npm run build`.
4. Open Lens/OpenLens.
5. Go to Extensions view (`Menu -> File -> Extensions`).
6. Load this extension directory, or install the generated package archive.
7. Make sure the extension is enabled.

If you use the packaged archive, build it with:

```sh
npm run build
npm pack
```

Then install the generated `lens-flow-0.1.0.tgz` from the Lens/OpenLens Extensions view.

---

## Features

After completing the installation, you will see a new cluster page named **Workload Monitoring**.

The page displays a topology graph for the namespaces selected in the Lens namespace filter.

Lens Flow currently visualizes:

- Internet and LoadBalancer entry points
- Ingress resources and Ingress backends
- Ingress `defaultBackend`
- Service resources
- `LoadBalancer` and `NodePort` services even when no Ingress exists
- Deployment targets
- StatefulSet targets
- DaemonSet targets
- Standalone Pod targets when no owning workload is known
- `Pod -> ReplicaSet -> Deployment` owner chains

The graph also includes:

- Health indicators for pending load balancers, missing service targets, pod readiness, and workload replica readiness
- Namespace and resource kind labels on nodes
- Edge deduplication for repeated paths
- Deterministic graph layout
- Minimap and fit-view controls
- Double-click on a resource node to open the Lens details panel

## How It Works

Lens Flow subscribes to Kubernetes stores exposed by Lens/OpenLens and builds a graph from the available resources.

Service targets are resolved in this order:

1. Endpoints data, when available
2. Pod selector matching
3. Workload template selector matching as a fallback

The pure graph builder lives in `graph/buildGraph.ts`, so the topology rules can be tested without running Lens.

## Development

Install dependencies:

```sh
npm install
```

Run the webpack watcher:

```sh
npm run start
```

Build the extension:

```sh
npm run build
```

Run tests:

```sh
npm test
```

## Project Structure

- `renderer.tsx` registers the Lens extension page and menu item.
- `components/WorkloadFlowPage.tsx` renders the namespace filter and graph page.
- `components/WorkloadFlow.tsx` connects Lens Kubernetes stores to React Flow.
- `components/WorkloadFlow.scss` contains the graph and node styles.
- `graph/buildGraph.ts` builds the Kubernetes topology graph.
- `graph/types.ts` contains the graph and Kubernetes-like resource types.
- `tests/buildGraph.test.ts` verifies graph generation with fixtures.

## Upgrading

Build the new version, then reinstall the extension from the Lens/OpenLens Extensions view.

If using a packaged archive, uninstall the old package and install the newly generated `.tgz` file.

## Uninstalling

Go to the Lens/OpenLens Extensions view and click the Uninstall button next to this extension.

## License

MIT
