import React from "react";
import { Renderer } from "@k8slens/extensions";
import { WorkloadFlow } from "./WorkloadFlow";
import "./WorkloadFlowPage.scss";

const { TabLayout, NamespaceSelectFilter } = Renderer.Component;

export const WorkloadFlowPage: React.FC = () => (
  <TabLayout className="WorkloadFlowPage">
    <header className="flex gaps align-center">
      <NamespaceSelectFilter id="workload-flow-namespace-filter" />
    </header>
    <WorkloadFlow />
  </TabLayout>
);
