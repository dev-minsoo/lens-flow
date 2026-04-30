import fs from "fs";
import os from "os";
import path from "path";
import { GraphDirection, ResourceKind } from "../graph/types";

export const defaultVisibleKinds: ResourceKind[] = [
  "Internet",
  "LoadBalancer",
  "Ingress",
  "Service",
  "Deployment",
  "ReplicaSet",
  "Pod",
];

export interface WorkloadFlowPageSettings {
  direction: GraphDirection;
  visibleKinds: ResourceKind[];
  showMiniMap: boolean;
  showControls: boolean;
  namespaceByCluster: Record<string, string>;
}

export const defaultWorkloadFlowPageSettings: WorkloadFlowPageSettings = {
  direction: "LR",
  visibleKinds: defaultVisibleKinds,
  showMiniMap: false,
  showControls: true,
  namespaceByCluster: {},
};

function settingsFilePath(): string {
  return path.join(os.homedir(), ".k8slens", "lens-flow", "settings.json");
}

function legacySettingsFilePaths(): string[] {
  const home = os.homedir();

  return [
    path.join(home, "Library", "Application Support", "OpenLens", "lens-flow-settings.json"),
    path.join(process.env.APPDATA ?? path.join(home, "AppData", "Roaming"), "OpenLens", "lens-flow-settings.json"),
    path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, ".config"), "OpenLens", "lens-flow-settings.json"),
  ];
}

export function parseWorkloadFlowPageSettings(raw: string): WorkloadFlowPageSettings {
  const parsed = JSON.parse(raw) as Partial<WorkloadFlowPageSettings>;
  const legacySelectedNamespace = (parsed as { selectedNamespace?: unknown }).selectedNamespace;

  return {
    direction: parsed.direction === "TB" ? "TB" : defaultWorkloadFlowPageSettings.direction,
    visibleKinds: Array.isArray(parsed.visibleKinds) ? parsed.visibleKinds : defaultWorkloadFlowPageSettings.visibleKinds,
    showMiniMap: typeof parsed.showMiniMap === "boolean" ? parsed.showMiniMap : defaultWorkloadFlowPageSettings.showMiniMap,
    showControls: typeof parsed.showControls === "boolean" ? parsed.showControls : defaultWorkloadFlowPageSettings.showControls,
    namespaceByCluster: parsed.namespaceByCluster && typeof parsed.namespaceByCluster === "object"
      ? Object.fromEntries(
        Object.entries(parsed.namespaceByCluster)
          .filter(([clusterId, namespace]) => Boolean(clusterId) && typeof namespace === "string" && namespace)
      )
      : typeof legacySelectedNamespace === "string" && legacySelectedNamespace
        ? { default: legacySelectedNamespace }
        : defaultWorkloadFlowPageSettings.namespaceByCluster,
  };
}

export function readWorkloadFlowPageSettings(): WorkloadFlowPageSettings {
  try {
    return parseWorkloadFlowPageSettings(fs.readFileSync(settingsFilePath(), "utf8"));
  } catch {
    for (const legacyPath of legacySettingsFilePaths()) {
      try {
        const settings = parseWorkloadFlowPageSettings(fs.readFileSync(legacyPath, "utf8"));
        writeWorkloadFlowPageSettings(settings);
        return settings;
      } catch {
        continue;
      }
    }

    return defaultWorkloadFlowPageSettings;
  }
}

export function writeWorkloadFlowPageSettings(settings: WorkloadFlowPageSettings): void {
  const filePath = settingsFilePath();

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(settings, null, 2));
}
