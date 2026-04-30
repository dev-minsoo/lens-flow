import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Renderer } from "@k8slens/extensions";
import { WorkloadFlow } from "./WorkloadFlow";
import { GraphDirection, ResourceKind } from "../graph/types";
import {
  defaultVisibleKinds,
  readWorkloadFlowPageSettings,
  writeWorkloadFlowPageSettings,
} from "./workloadFlowPageSettings";
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
const allVisibleKinds = resourceOptions.map(option => option.kind);
const resourceKindSet = new Set<ResourceKind>(resourceOptions.map(option => option.kind));

function resourceTone(kind: ResourceKind): string {
  return kind.toLowerCase();
}

type StoredSettings = {
  direction?: GraphDirection;
  visibleKinds?: ResourceKind[];
  showMiniMap?: boolean;
  showControls?: boolean;
  namespaceByCluster?: Record<string, string>;
};

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function currentClusterKeys(): string[] {
  const activeCluster = Renderer.Catalog.activeCluster.get();
  const contextName = activeCluster?.spec?.kubeconfigContext;
  const clusterName = activeCluster?.getName?.() ?? activeCluster?.metadata?.name;
  const activeClusterId = activeCluster?.getId?.() ?? activeCluster?.metadata?.uid;

  if (activeCluster) {
    return uniqueStrings([contextName, clusterName, activeClusterId, "default"]);
  }

  const match = window.location.pathname.match(/\/cluster\/([^/]+)/);
  return uniqueStrings([match?.[1] ? decodeURIComponent(match[1]) : undefined, "default"]);
}

function settingForCluster(settings: Record<string, string>, clusterKeys: string[]): string | undefined {
  for (const key of clusterKeys) {
    const value = settings[key];

    if (typeof value === "string" && value) return value;
  }

  return undefined;
}

function normalizeVisibleKinds(kinds: ResourceKind[] | undefined): ResourceKind[] {
  if (!Array.isArray(kinds)) return defaultVisibleKinds;

  const visible = new Set((kinds ?? []).filter(kind => resourceKindSet.has(kind)));
  return resourceOptions
    .map(option => option.kind)
    .filter(kind => visible.has(kind));
}

const GearIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M19.43 12.98c.04-.32.07-.65.07-.98s-.02-.66-.07-.98l2.1-1.64c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.37-.31-.6-.22l-2.47.99c-.52-.4-1.08-.72-1.69-.98L14.5 2.42A.5.5 0 0 0 14 2h-4a.5.5 0 0 0-.5.42l-.38 2.65c-.61.25-1.18.58-1.69.98l-2.47-.99a.5.5 0 0 0-.6.22l-2 3.46a.5.5 0 0 0 .12.64l2.1 1.64c-.04.32-.08.65-.08.98s.03.66.08.98l-2.1 1.64a.5.5 0 0 0-.12.64l2 3.46c.12.22.37.31.6.22l2.47-.99c.52.4 1.08.72 1.69.98l.38 2.65c.04.24.25.42.5.42h4c.25 0 .46-.18.5-.42l.38-2.65c.61-.25 1.18-.58 1.69-.98l2.47.99c.23.08.48 0 .6-.22l2-3.46a.5.5 0 0 0-.12-.64l-2.1-1.64ZM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5Z" />
  </svg>
);

export const WorkloadFlowPage: React.FC = () => {
  const storedSettings = useMemo<StoredSettings>(() => readWorkloadFlowPageSettings(), []);
  const clusterKeys = currentClusterKeys();
  const clusterKey = clusterKeys[0] ?? "default";
  const initialVisibleKinds = normalizeVisibleKinds(storedSettings.visibleKinds);
  const initialNamespaceByCluster = storedSettings.namespaceByCluster ?? {};
  const initialSelectedNamespace = settingForCluster(initialNamespaceByCluster, clusterKeys)
    ?? "default";
  const filtersRef = useRef<HTMLDivElement | null>(null);
  const previousClusterKeyRef = useRef(clusterKey);
  const [direction, setDirection] = useState<GraphDirection>(storedSettings.direction ?? "LR");
  const [visibleKinds, setVisibleKinds] = useState<ResourceKind[]>(initialVisibleKinds);
  const [draftVisibleKinds, setDraftVisibleKinds] = useState<ResourceKind[]>(initialVisibleKinds);
  const [namespaceByCluster, setNamespaceByCluster] = useState<Record<string, string>>(initialNamespaceByCluster);
  const [availableNamespaces, setAvailableNamespaces] = useState<string[]>([]);
  const [resourceFiltersOpen, setResourceFiltersOpen] = useState(false);
  const [viewSettingsOpen, setViewSettingsOpen] = useState(false);
  const [showMiniMap, setShowMiniMap] = useState(storedSettings.showMiniMap ?? false);
  const [showControls, setShowControls] = useState(storedSettings.showControls ?? true);
  const [selectedNamespace, setSelectedNamespace] = useState(initialSelectedNamespace);
  const namespaceOptions = useMemo(() => availableNamespaces, [availableNamespaces]);
  const graphNamespaces = useMemo(
    () => availableNamespaces.includes(selectedNamespace) ? [selectedNamespace] : [],
    [availableNamespaces, selectedNamespace]
  );
  const selectedNamespaceValue = availableNamespaces.includes(selectedNamespace) ? selectedNamespace : "";
  const hasPendingResourceChanges = useMemo(() => (
    draftVisibleKinds.length !== visibleKinds.length
      || draftVisibleKinds.some((kind, index) => kind !== visibleKinds[index])
  ), [draftVisibleKinds, visibleKinds]);

  const handleNamespacesChange = useCallback((namespaces: string[]) => {
    setAvailableNamespaces(current => (
      current.length === namespaces.length && current.every((namespace, index) => namespace === namespaces[index])
        ? current
        : namespaces
    ));
  }, []);

  const toggleDraftKind = (kind: ResourceKind) => {
    setDraftVisibleKinds(current => normalizeVisibleKinds(
      current.includes(kind)
        ? current.filter(item => item !== kind)
        : [...current, kind]
    ));
  };

  const closeResourceFilters = useCallback(() => {
    setDraftVisibleKinds(visibleKinds);
    setResourceFiltersOpen(false);
  }, [visibleKinds]);

  useEffect(() => {
    if (availableNamespaces.length === 0) return;
    if (availableNamespaces.includes(selectedNamespace)) return;

    const fallbackNamespace = availableNamespaces.includes("default")
      ? "default"
      : availableNamespaces[0];

    if (fallbackNamespace) {
      setSelectedNamespace(fallbackNamespace);
    }
  }, [availableNamespaces, selectedNamespace]);

  useEffect(() => {
    if (!selectedNamespace) return;

    setNamespaceByCluster(current => (
      current[clusterKey] === selectedNamespace
        ? current
        : {
          ...current,
          [clusterKey]: selectedNamespace,
        }
    ));
  }, [clusterKey, selectedNamespace]);

  useEffect(() => {
    if (previousClusterKeyRef.current === clusterKey) return;

    previousClusterKeyRef.current = clusterKey;
    const nextNamespace = settingForCluster(namespaceByCluster, clusterKeys) ?? "default";
    setSelectedNamespace(nextNamespace);
  }, [clusterKey, clusterKeys, namespaceByCluster]);

  useEffect(() => {
    writeWorkloadFlowPageSettings({
      direction,
      visibleKinds,
      showMiniMap,
      showControls,
      namespaceByCluster,
    });
  }, [direction, namespaceByCluster, showControls, showMiniMap, visibleKinds]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;

      if (target instanceof Node && filtersRef.current?.contains(target)) return;

      closeResourceFilters();
      setViewSettingsOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);

    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [closeResourceFilters]);

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
                setResourceFiltersOpen(open => {
                  if (open) {
                    setDraftVisibleKinds(visibleKinds);
                    return false;
                  }

                  setDraftVisibleKinds(visibleKinds);
                  return true;
                });
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
              </div>
            )}
            {resourceFiltersOpen && (
              <div className="WorkloadFlowResourcePanel" role="dialog" aria-label="Visible resources">
                <div className="WorkloadFlowResourcePanelHeader">
                  <span>Visible resources</span>
                  <button type="button" onClick={closeResourceFilters}>Close</button>
                </div>
                <div className="WorkloadFlowResourceActions">
                  <button type="button" onClick={() => setDraftVisibleKinds(allVisibleKinds)}>All</button>
                  <button type="button" onClick={() => setDraftVisibleKinds([])}>None</button>
                  <button type="button" onClick={() => setDraftVisibleKinds(defaultVisibleKinds)}>Reset</button>
                </div>
                <div className="WorkloadFlowResourceFilters">
                  {resourceOptions.map(option => (
                    <label key={option.kind}>
                      <input
                        type="checkbox"
                        checked={draftVisibleKinds.includes(option.kind)}
                        onChange={() => toggleDraftKind(option.kind)}
                      />
                      <span className={`resource-swatch resource-swatch-${resourceTone(option.kind)}`} />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>
                <div className="WorkloadFlowResourceFooter">
                  <button type="button" onClick={closeResourceFilters}>Cancel</button>
                  <button
                    type="button"
                    className="primary"
                    disabled={!hasPendingResourceChanges}
                    onClick={() => {
                      setVisibleKinds(draftVisibleKinds);
                      setResourceFiltersOpen(false);
                    }}
                  >
                    Apply
                  </button>
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
