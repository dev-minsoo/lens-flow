import React, { useState } from "react";
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
  { kind: "StatefulSet", label: "StatefulSet" },
  { kind: "DaemonSet", label: "DaemonSet" },
  { kind: "Pod", label: "Pod" },
  { kind: "ConfigMap", label: "ConfigMap" },
  { kind: "Secret", label: "Secret" },
  { kind: "PersistentVolumeClaim", label: "PVC" },
];

const defaultVisibleKinds = resourceOptions.map(option => option.kind);

function resourceTone(kind: ResourceKind): string {
  return kind.toLowerCase();
}

const GearIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M12 8.2a3.8 3.8 0 1 1 0 7.6 3.8 3.8 0 0 1 0-7.6Zm0-5.2 1.3 2.1c.5.1 1 .3 1.5.6l2.4-.6 1.8 3.1-1.7 1.8c.1.5.2 1 .2 1.5s-.1 1-.2 1.5l1.7 1.8-1.8 3.1-2.4-.6c-.5.3-1 .5-1.5.6L12 21l-1.3-2.1c-.5-.1-1-.3-1.5-.6l-2.4.6L5 15.8 6.7 14c-.1-.5-.2-1-.2-1.5s.1-1 .2-1.5L5 9.2l1.8-3.1 2.4.6c.5-.3 1-.5 1.5-.6L12 3Z" />
  </svg>
);

export const WorkloadFlowPage: React.FC = () => {
  const [direction, setDirection] = useState<GraphDirection>("LR");
  const [visibleKinds, setVisibleKinds] = useState<ResourceKind[]>(defaultVisibleKinds);
  const [availableNamespaces, setAvailableNamespaces] = useState<string[]>([]);
  const [selectedNamespaces, setSelectedNamespaces] = useState<string[]>([]);
  const [resourceFiltersOpen, setResourceFiltersOpen] = useState(false);
  const [viewSettingsOpen, setViewSettingsOpen] = useState(false);
  const [showMiniMap, setShowMiniMap] = useState(false);
  const [showControls, setShowControls] = useState(true);

  const toggleKind = (kind: ResourceKind) => {
    setVisibleKinds(current =>
      current.includes(kind)
        ? current.filter(item => item !== kind)
        : [...current, kind]
    );
  };

  return (
    <TabLayout className="WorkloadFlowPage">
      <header className="WorkloadFlowToolbar">
        <div className="WorkloadFlowToolbarPrimary">
          <label className="WorkloadFlowNamespaceSelect">
            <span>Namespace</span>
            <select
              value={selectedNamespaces[0] ?? "__all__"}
              onChange={event => {
                const namespace = event.currentTarget.value;
                setSelectedNamespaces(namespace === "__all__" ? [] : [namespace]);
              }}
            >
              <option value="__all__">All namespaces</option>
              {availableNamespaces.map(namespace => (
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
          <div className="WorkloadFlowFilters">
            <button
              type="button"
              className={`WorkloadFlowSettingsButton ${viewSettingsOpen ? "active" : ""}`}
              aria-label="View settings"
              onClick={() => setViewSettingsOpen(open => !open)}
            >
              <GearIcon />
            </button>
            <button
              type="button"
              className={resourceFiltersOpen ? "active" : ""}
              onClick={() => setResourceFiltersOpen(open => !open)}
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
        selectedNamespaces={selectedNamespaces}
        showMiniMap={showMiniMap}
        showControls={showControls}
        onNamespacesChange={setAvailableNamespaces}
      />
    </TabLayout>
  );
};
