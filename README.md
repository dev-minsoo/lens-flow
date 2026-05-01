# Lens Flow

[![Release](https://img.shields.io/github/v/release/dev-minsoo/lens-flow?display_name=tag)](https://github.com/dev-minsoo/lens-flow/releases)
[![License](https://img.shields.io/github/license/dev-minsoo/lens-flow)](./LICENSE.md)

[한국어](./README.ko.md)

Lens Flow is a Kubernetes topology extension for Lens-family desktop apps. It adds a **Workload Monitoring** page that lets you trace routing, ownership, and workload dependencies in one graph.

It was built for the moments when checking a Kubernetes path means jumping between Ingress, Service, Deployment, ReplicaSet, Pod, ConfigMap, Secret, and PVC detail screens. Lens Flow keeps that workflow inside the cluster view and turns it into a graph you can inspect at a glance.

## Preview

<p>
  <img src="docs/assets/screenshot.png" alt="Lens Flow workload topology screenshot" width="820">
</p>

<details>
  <summary>View demo GIF</summary>
  <p>
    <img src="docs/assets/demo.gif" alt="Lens Flow demo showing namespace topology, layout switching, and resource filtering" width="820">
  </p>
</details>

## Why Lens Flow

Kubernetes relationships are usually spread across multiple screens. Lens Flow brings the most common paths into one view so you can answer questions like:

- Which Service is this Ingress routing to?
- Which workload is actually behind this Service?
- Which ReplicaSet or Pod belongs to this Deployment?
- Which ConfigMap, Secret, or PVC is this workload using?

## Supported Apps

- Lens 6+
- OpenLens 6+
- FreeLens 1.8.1+

The extension uses the Lens renderer API and does not require any extra sidecar process.

## Core Features

- Topology graph for Internet, LoadBalancer, Ingress, Service, Deployment, ReplicaSet, StatefulSet, DaemonSet, Pod, ConfigMap, Secret, and PVC resources
- Service-to-workload and workload-to-pod relationship tracing
- Dependency edges for `env`, `envFrom`, and `volumes`
- Namespace-aware graph browsing inside the cluster page
- Resource visibility filters with `All`, `None`, and `Reset`
- `Left to right` and `Top to bottom` layout modes
- Minimap and controls toggles
- Edge hover highlighting and clickable resource cards

## Installation

### Install from GitHub Releases

1. Open the [latest release](https://github.com/dev-minsoo/lens-flow/releases/latest).
2. Download the attached `.tgz` asset.
3. Open Lens, OpenLens, or FreeLens.
4. Go to the Extensions screen.
5. Install the downloaded `.tgz`.

### Build a Local Package

```sh
npm install
npm run build
npm pack
```

Then install the generated `.tgz` file from the Extensions screen.

## Usage

1. Open a cluster.
2. Open **Workload Monitoring** from the left navigation.
3. Select a namespace.
4. Adjust visible resource kinds from the **Resources** panel if needed.
5. Hover an edge to emphasize the connected path.
6. Click a resource card to open the native details pane.

## Settings Storage

Lens Flow stores user settings per app:

```text
Lens / OpenLens: ~/.k8slens/lens-flow/settings.json
FreeLens:        ~/.freelens/lens-flow/settings.json
```

Stored settings include:

- selected namespace per cluster
- visible resource kinds
- graph direction
- minimap visibility
- controls visibility

## Development

```sh
npm install
npm run start
```

Useful commands:

- `npm run start` - webpack watch mode
- `npm run build` - production build
- `npm test` - graph and settings tests
- `npm pack` - create an installable package

## Contributing

Issues and pull requests are welcome.

If you report a compatibility or layout issue, include:

- app name and version
- cluster and resource context
- screenshot or short GIF when possible

## License

MIT
