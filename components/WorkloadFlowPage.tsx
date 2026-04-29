import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Renderer } from "@k8slens/extensions";
import { WorkloadFlow } from "./WorkloadFlow";
import { GraphDirection, ResourceKind } from "../graph/types";
import "./WorkloadFlowPage.scss";

const { TabLayout } = Renderer.Component;

const resourceOptions: Array<{ kind: ResourceKind; label: string }> = [
  { kind: "Internet", label: "Internet" },
  { kind: "LoadBalancer", label: "Load Balancer" },
  { kind: "Ingress", label: "Ingress" },
  { kind: "Service", label: "Service" },
  { kind: "Deployment", label: "Deployment" },
  { kind: "ReplicaSet", label: "ReplicaSet" },
  { kind: "StatefulSet", label: "StatefulSet" },
  { kind: "DaemonSet", label: "DaemonSet" },
  { kind: "Pod", label: "Pod" },
  { kind: "ConfigMap", label: "ConfigMap" },
  { kind: "Secret", label: "Secret" },
  { kind: "PersistentVolumeClaim", label: "PVC" },
];

const defaultVisibleKinds = resourceOptions.map(option => option.kind);
const platformNamespaceNames = new Set([
  "argocd",
  "cert-manager",
  "external-secrets",
  "ingress-nginx",
  "istio-system",
  "linkerd",
  "logging",
  "metallb-system",
  "monitoring",
]);

function resourceTone(kind: ResourceKind): string {
  return kind.toLowerCase();
}

function isPlatformNamespace(namespace: string): boolean {
  return namespace.startsWith("kube-") || platformNamespaceNames.has(namespace);
}

const GearIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M19.43 12.98c.04-.32.07-.65.07-.98s-.02-.66-.07-.98l2.1-1.64c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.37-.31-.6-.22l-2.47.99c-.52-.4-1.08-.72-1.69-.98L14.5 2.42A.5.5 0 0 0 14 2h-4a.5.5 0 0 0-.5.42l-.38 2.65c-.61.25-1.18.58-1.69.98l-2.47-.99a.5.5 0 0 0-.6.22l-2 3.46a.5.5 0 0 0 .12.64l2.1 1.64c-.04.32-.08.65-.08.98s.03.66.08.98l-2.1 1.64a.5.5 0 0 0-.12.64l2 3.46c.12.22.37.31.6.22l2.47-.99c.52.4 1.08.72 1.69.98l.38 2.65c.04.24.25.42.5.42h4c.25 0 .46-.18.5-.42l.38-2.65c.61-.25 1.18-.58 1.69-.98l2.47.99c.23.08.48 0 .6-.22l2-3.46a.5.5 0 0 0-.12-.64l-2.1-1.64ZM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5Z" />
  </svg>
);

export const WorkloadFlowPage: React.FC = () => {
  const filtersRef = useRef<HTMLDivElement | null>(null);
  const [direction, setDirection] = useState<GraphDirection>("LR");
  const [visibleKinds, setVisibleKinds] = useState<ResourceKind[]>(defaultVisibleKinds);
  const [availableNamespaces, setAvailableNamespaces] = useState<string[]>([]);
  const [resourceFiltersOpen, setResourceFiltersOpen] = useState(false);
  const [viewSettingsOpen, setViewSettingsOpen] = useState(false);
  const [showMiniMap, setShowMiniMap] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [showPlatformNamespaces, setShowPlatformNamespaces] = useState(false);
  const [selectedNamespace, setSelectedNamespace] = useState("default");
  const namespaceOptions = useMemo(
    () => showPlatformNamespaces
      ? availableNamespaces
      : availableNamespaces.filter(namespace => !isPlatformNamespace(namespace)),
    [availableNamespaces, showPlatformNamespaces]
  );
  const graphNamespaces = useMemo(
    () => availableNamespaces.includes(selectedNamespace) ? [selectedNamespace] : [],
    [availableNamespaces, selectedNamespace]
  );
  const selectedNamespaceValue = availableNamespaces.includes(selectedNamespace) ? selectedNamespace : "";

  const handleNamespacesChange = useCallback((namespaces: string[]) => {
    setAvailableNamespaces(current => (
      current.length === namespaces.length && current.every((namespace, index) => namespace === namespaces[index])
        ? current
        : namespaces
    ));
  }, []);

  const toggleKind = (kind: ResourceKind) => {
    setVisibleKinds(current =>
      current.includes(kind)
        ? current.filter(item => item !== kind)
        : [...current, kind]
    );
  };

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;

      if (target instanceof Node && filtersRef.current?.contains(target)) return;

      setResourceFiltersOpen(false);
      setViewSettingsOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);

    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  return (
    <TabLayout className="WorkloadFlowPage">
      <header className="WorkloadFlowToolbar">
        <div className="WorkloadFlowToolbarPrimary">
          <label className="WorkloadFlowNamespaceSelect">
            <span>Namespace</span>
            <select
              value={selectedNamespaceValue}
              onChange={event => {
                const namespace = event.currentTarget.value;
                if (namespace) setSelectedNamespace(namespace);
              }}
            >
              {!availableNamespaces.includes(selectedNamespace) && <option value="">default</option>}
              {namespaceOptions.map(namespace => (
                <option key={namespace} value={namespace}>{namespace}</option>
              ))}
            </select>
          </label>
          <div className="WorkloadFlowDirection" role="group" aria-label="Graph direction">
            <button
              type="button"
              className={direction === "LR" ? "active" : ""}
              onClick={() => setDirection("LR")}
            >
              Left to right
            </button>
            <button
              type="button"
              className={direction === "TB" ? "active" : ""}
              onClick={() => setDirection("TB")}
            >
              Top to bottom
            </button>
          </div>
          <div className="WorkloadFlowFilters" ref={filtersRef}>
            <button
              type="button"
              className={`WorkloadFlowSettingsButton ${viewSettingsOpen ? "active" : ""}`}
              aria-label="View settings"
              onClick={() => {
                setResourceFiltersOpen(false);
                setViewSettingsOpen(open => !open);
              }}
            >
              <GearIcon />
            </button>
            <button
              type="button"
              className={resourceFiltersOpen ? "active" : ""}
              onClick={() => {
                setViewSettingsOpen(false);
                setResourceFiltersOpen(open => !open);
              }}
            >
              Resources ({visibleKinds.length})
            </button>
            {viewSettingsOpen && (
              <div className="WorkloadFlowViewPanel" role="dialog" aria-label="View settings">
                <label>
                  <input
                    type="checkbox"
                    checked={showMiniMap}
                    onChange={() => setShowMiniMap(visible => !visible)}
                  />
                  <span>MiniMap</span>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={showControls}
                    onChange={() => setShowControls(visible => !visible)}
                  />
                  <span>Controls</span>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={showPlatformNamespaces}
                    onChange={() => setShowPlatformNamespaces(visible => !visible)}
                  />
                  <span>Platform namespaces</span>
                </label>
              </div>
            )}
            {resourceFiltersOpen && (
              <div className="WorkloadFlowResourcePanel" role="dialog" aria-label="Visible resources">
                <div className="WorkloadFlowResourcePanelHeader">
                  <span>Visible resources</span>
                  <button type="button" onClick={() => setResourceFiltersOpen(false)}>Close</button>
                </div>
                <div className="WorkloadFlowResourceActions">
                  <button type="button" onClick={() => setVisibleKinds(defaultVisibleKinds)}>All</button>
                  <button type="button" onClick={() => setVisibleKinds([])}>None</button>
                </div>
                <div className="WorkloadFlowResourceFilters">
                  {resourceOptions.map(option => (
                    <label key={option.kind}>
                      <input
                        type="checkbox"
                        checked={visibleKinds.includes(option.kind)}
                        onChange={() => toggleKind(option.kind)}
                      />
                      <span className={`resource-swatch resource-swatch-${resourceTone(option.kind)}`} />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </header>
      <WorkloadFlow
        direction={direction}
        visibleKinds={visibleKinds}
        selectedNamespaces={graphNamespaces}
        showMiniMap={showMiniMap}
        showControls={showControls}
        onNamespacesChange={handleNamespacesChange}
      />
    </TabLayout>
  );
};
