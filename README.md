# Lens Flow

[![Release](https://img.shields.io/github/v/release/dev-minsoo/lens-flow?display_name=tag)](https://github.com/dev-minsoo/lens-flow/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/dev-minsoo/lens-flow/ci.yml?branch=main&label=ci)](https://github.com/dev-minsoo/lens-flow/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/dev-minsoo/lens-flow)](./LICENSE.md)

> Add your screenshot or GIF here near the top of the README.
> Suggested path: `docs/assets/workload-flow-overview.gif`
>
> Example:
> `![Lens Flow overview](docs/assets/workload-flow-overview.gif)`

Lens Flow is a Kubernetes topology extension for Lens-family apps. It renders cluster entrypoints, routing resources, workloads, and workload dependencies as an interactive graph inside a cluster page named **Workload Monitoring**.

The project was inspired by the experience of exploring resource relationships through Argo CD's Tree and Network graph views, but adapted for Lens-family desktop clients with a Kubernetes workload-focused topology.

When Kubernetes traffic and ownership relationships are spread across Ingresses, Services, workloads, ReplicaSets, Pods, ConfigMaps, Secrets, and PVCs, understanding one change often means jumping through multiple screens. Lens Flow brings those relationships into one view so operators can trace routing, ownership, and dependencies faster.

## Download

- [Open the latest release](https://github.com/dev-minsoo/lens-flow/releases/latest)
- Download the attached `lens-flow-*.tgz` asset from that release
- Install the downloaded `.tgz` from the Extensions screen in Lens, OpenLens, or FreeLens

Releases are created when a `vX.Y.Z` tag is pushed on a commit that is already included in `main`.

It is designed for operators who want to answer questions like:

- Which Service is this Ingress routing to?
- Which workload is really behind this Service?
- Which ReplicaSet or Pod belongs to this Deployment?
- Which ConfigMap, Secret, or PVC is this workload using?

## Supported Apps

- Lens 6+
- OpenLens 6+
- FreeLens 6+

The extension uses the Lens renderer API and does not require any extra sidecar process.

## Features

- Internet, LoadBalancer, Ingress, Service, Deployment, ReplicaSet, StatefulSet, DaemonSet, Pod, ConfigMap, Secret, and PVC nodes
- Ingress `defaultBackend` support
- External `LoadBalancer` Services even without Ingress
- Pod owner-chain resolution:
  `Deployment -> ReplicaSet -> Pod`
- StatefulSet to Pod and generated PVC relationships
- Workload dependency edges from pod template `env`, `envFrom`, and `volumes`
- Resource visibility panel with `All`, `None`, and `Reset`
- `Left to right` and `Top to bottom` layout modes
- Minimap and controls toggles
- Edge hover highlighting for the connected nodes
- Cluster-specific namespace persistence
- Shared resource visibility persistence across clusters
- Clickable resource cards that open the Lens details pane

## Default View

The default visible resource set is:

- Internet
- LoadBalancer
- Ingress
- Service
- Deployment
- ReplicaSet
- Pod

`Reset` in the Resources panel returns to this default set.

## Persistence

Lens Flow stores user settings in:

```text
~/.k8slens/lens-flow/settings.json
```

Settings behavior:

- `namespace` is stored per cluster
- `resource visibility`, `direction`, `minimap`, and `controls` are stored globally

Cluster preference keys are resolved in this order:

1. `kubeconfigContext`
2. Lens cluster entity id
3. Lens cluster display name
4. `default`

This lets the extension preserve old values while preferring stable, human-readable context names when available.

## Installation

### Install from GitHub Releases

1. Open the [latest release](https://github.com/dev-minsoo/lens-flow/releases/latest).
2. Download the attached `lens-flow-*.tgz` asset.
3. Open Lens, OpenLens, or FreeLens.
4. Go to the Extensions screen.
5. Install the downloaded `.tgz`.

### Build a local `.tgz`

```sh
npm install
npm run build
npm pack
```

Then install the generated `lens-flow-<version>.tgz` from the Extensions screen.

### Install from source during development

```sh
npm install
npm run build
```

Then load the project directory from the Extensions screen.

## Usage

1. Open a cluster.
2. Open **Workload Monitoring** from the left navigation.
3. Pick a namespace from the selector.
4. Open the **Resources** panel to choose which resource kinds are visible.
5. Use **Apply** to commit Resource panel changes.
6. Hover edges to highlight the connected nodes.
7. Click any resource card to open the native details view.

## How the Graph Is Built

Lens Flow reads Kubernetes resources from Lens stores and builds a graph in three stages:

1. Resource and relationship discovery
2. Directed graph layout with `dagre`
3. Post-layout adjustments for ReplicaSet ordering, disconnected groups, and collision reduction

Service target resolution uses this order:

1. Endpoints data
2. Pod selector matching
3. Workload template selector matching

## Known Limitations

- Very dense or unusual topologies can still produce imperfect edge routing.
- Layout quality is best-effort; it is not a full constraint-based graph router.
- Runtime behavior can vary slightly between Lens-family distributions and versions.
- The extension depends on the availability of Lens renderer stores for the target resource kinds.

If you hit an unexpected layout case, include the resource mix and screenshot when filing an issue.

## Development

```sh
npm install
npm run start
```

Available commands:

- `npm run start` - webpack watch mode
- `npm run build` - production build
- `npm test` - graph and settings tests
- `npm pack` - create installable `.tgz`

## Release Flow

1. Update `package.json` to the target version
2. Commit the change on `main`
3. Create and push a matching tag such as `v1.0.0`
4. GitHub Actions runs tests, builds the extension, creates `lens-flow-<version>.tgz`, and publishes or updates the matching GitHub Release

## Project Structure

- `renderer.tsx` registers the cluster page and menu item
- `main.ts` registers the main extension entrypoint
- `components/WorkloadFlowPage.tsx` renders the page toolbar and settings UI
- `components/WorkloadFlow.tsx` bridges Lens stores into React Flow
- `components/workloadFlowPageSettings.ts` handles persisted settings
- `graph/buildGraph.ts` builds and lays out the topology graph
- `graph/types.ts` contains graph and Kubernetes-like types
- `tests/buildGraph.test.ts` covers graph generation and settings parsing logic

## License

MIT
