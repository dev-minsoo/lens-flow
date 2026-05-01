import React from "react";
import { Renderer } from "@k8slens/extensions";
import { WorkloadFlowPage } from "./components";

export default class LensFlowExtension extends Renderer.LensExtension {
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
      target: { pageId: "workload-flow" },
      title: "Workload Monitoring",
      orderNumber: 999,
      components: {
        Icon: (props: Renderer.Component.IconProps) => (
          <Renderer.Component.Icon {...props} material="device_hub" />
        ),
      },
    },
  ];
}
