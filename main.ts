import { Main } from "@k8slens/extensions";

export default class LensFlowMainExtension extends Main.LensExtension {
  onActivate() {
    console.log("[lens-flow] Main extension activated");
  }
}
