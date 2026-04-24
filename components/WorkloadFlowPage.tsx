import React, { useState } from "react";
import { Renderer } from "@k8slens/extensions";
import { WorkloadFlow } from "./WorkloadFlow";
import { GraphDirection, ResourceKind } from "../graph/types";
import "./WorkloadFlowPage.scss";

const { TabLayout, NamespaceSelectFilter } = Renderer.Component;

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

export const WorkloadFlowPage: React.FC = () => {
  const [direction, setDirection] = useState<GraphDirection>("LR");
  const [visibleKinds, setVisibleKinds] = useState<ResourceKind[]>(defaultVisibleKinds);

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
          <NamespaceSelectFilter id="workload-flow-namespace-filter" />
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
        </div>
        <div className="WorkloadFlowResourceFilters" aria-label="Visible resources">
          {resourceOptions.map(option => (
            <label key={option.kind}>
              <input
                type="checkbox"
                checked={visibleKinds.includes(option.kind)}
                onChange={() => toggleKind(option.kind)}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </header>
      <WorkloadFlow direction={direction} visibleKinds={visibleKinds} />
    </TabLayout>
  );
};
