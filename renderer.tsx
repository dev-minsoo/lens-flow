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
      id: "lens-flow",
      title: "Lens Flow",
      orderNumber: 35,
      components: {
        Icon: (props: Renderer.Component.IconProps) => (
          <Renderer.Component.Icon {...props} material="device_hub" />
        ),
      },
    },
    {
      id: "workload-flow",
      parentId: "lens-flow",
      target: { pageId: "workload-flow" },
      title: "Workload Monitoring",
      orderNumber: 10,
      components: {
        Icon: (props: Renderer.Component.IconProps) => (
          <Renderer.Component.Icon {...props} material="device_hub" />
        ),
      },
    },
  ];
}
