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
      target: { pageId: "workload-flow" },
      title: "Workload Monitoring",
      components: {
        Icon: (props: Renderer.Component.IconProps) => (
          <Renderer.Component.Icon {...props} material="device_hub" />
        ),
      },
    },
  ];
}
