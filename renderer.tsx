import React from "react";
import { Renderer } from "@k8slens/extensions";
import { WorkloadFlowPage } from "./components";

export default class LensFlowExtension extends Renderer.LensExtension {
  onActivate() {
    console.log("[lens-flow] Extension activated");
  }

  clusterPages = [
    {
      id: "workload-flow",
      components: {
        Page: WorkloadFlowPage,
      },
    },
  ];

  clusterPageMenus = [
    {
      id: "workload-flow",
      parentId: "workloads",
      target: { pageId: "workload-flow" },
      title: "Workload Monitoring",
      orderNumber: 15,
      components: {
        Icon: (props: Renderer.Component.IconProps) => (
          <Renderer.Component.Icon {...props} material="device_hub" />
        ),
      },
    },
  ];
}
