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

type ClusterIdentityLike = {
  getId?: () => string;
  getName?: () => string;
  metadata?: {
    uid?: string;
    name?: string;
  };
  spec?: {
    kubeconfigContext?: string;
  };
};

let lastSerializedSettings = "";
let pendingWrite = Promise.resolve();
const PACKAGE_NAME = "lens-flow";

function currentAppFlavor(): "freelens" | "lens" | undefined {
  if (typeof window !== "undefined") {
    const hostname = window.location.hostname.toLowerCase();
    if (hostname.includes("freelens")) return "freelens";
    if (hostname.includes("lens")) return "lens";
  }

  return undefined;
}

function settingsFileCandidates(): string[] {
  const home = os.homedir();

  return [
    path.join(home, ".freelens", PACKAGE_NAME, "settings.json"),
    path.join(home, ".k8slens", PACKAGE_NAME, "settings.json"),
  ];
}

function settingsFilePath(): string {
  const home = os.homedir();
  const appFlavor = currentAppFlavor();

  if (appFlavor === "freelens") {
    return path.join(home, ".freelens", PACKAGE_NAME, "settings.json");
  }

  if (appFlavor === "lens") {
    return path.join(home, ".k8slens", PACKAGE_NAME, "settings.json");
  }

  const existingFile = settingsFileCandidates().find(filePath => fs.existsSync(filePath));
  if (existingFile) return existingFile;

  return fs.existsSync(path.join(home, ".freelens"))
    ? path.join(home, ".freelens", PACKAGE_NAME, "settings.json")
    : path.join(home, ".k8slens", PACKAGE_NAME, "settings.json");
}

function legacySettingsFilePaths(): string[] {
  const home = os.homedir();
  const appFlavor = currentAppFlavor();
  const appSpecificLegacyPaths = appFlavor === "freelens"
    ? [path.join(home, ".k8slens", "lens-flow", "settings.json")]
    : appFlavor === "lens"
      ? [path.join(home, ".freelens", "lens-flow", "settings.json")]
      : [
        path.join(home, ".freelens", "lens-flow", "settings.json"),
        path.join(home, ".k8slens", "lens-flow", "settings.json"),
      ];

  return [
    path.join(home, ".freelens", "extensions", "dev-minsoo--lens-flow", "settings.json"),
    path.join(home, ".freelens", "extensions", "@dev-minsoo", "lens-flow", "settings.json"),
    path.join(home, ".k8slens", "extensions", "dev-minsoo--lens-flow", "settings.json"),
    path.join(home, ".k8slens", "extensions", "@dev-minsoo", "lens-flow", "settings.json"),
    path.join(home, "Library", "Application Support", "OpenLens", "lens-flow-settings.json"),
    path.join(process.env.APPDATA ?? path.join(home, "AppData", "Roaming"), "OpenLens", "lens-flow-settings.json"),
    path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, ".config"), "OpenLens", "lens-flow-settings.json"),
    ...appSpecificLegacyPaths,
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

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

export function clusterPreferenceKeys(activeCluster?: ClusterIdentityLike | null, pathname?: string): string[] {
  const contextName = activeCluster?.spec?.kubeconfigContext;
  const clusterId = activeCluster?.getId?.() ?? activeCluster?.metadata?.uid;
  const clusterName = activeCluster?.getName?.() ?? activeCluster?.metadata?.name;

  if (activeCluster) {
    return uniqueStrings([contextName, clusterId, clusterName, "default"]);
  }

  const match = pathname?.match(/\/cluster\/([^/]+)/);
  return uniqueStrings([match?.[1] ? decodeURIComponent(match[1]) : undefined, "default"]);
}

export function storedNamespaceForCluster(
  namespaceByCluster: Record<string, string>,
  clusterKeys: string[]
): string | undefined {
  for (const key of clusterKeys) {
    const value = namespaceByCluster[key];

    if (typeof value === "string" && value) return value;
  }

  return undefined;
}

export function readWorkloadFlowPageSettings(): WorkloadFlowPageSettings {
  try {
    const settings = parseWorkloadFlowPageSettings(fs.readFileSync(settingsFilePath(), "utf8"));
    lastSerializedSettings = JSON.stringify(settings, null, 2);
    return settings;
  } catch {
    for (const legacyPath of legacySettingsFilePaths()) {
      try {
        const settings = parseWorkloadFlowPageSettings(fs.readFileSync(legacyPath, "utf8"));
        lastSerializedSettings = JSON.stringify(settings, null, 2);
        void writeWorkloadFlowPageSettings(settings);
        return settings;
      } catch {
        continue;
      }
    }

    return defaultWorkloadFlowPageSettings;
  }
}

export function writeWorkloadFlowPageSettings(settings: WorkloadFlowPageSettings): Promise<void> {
  const filePath = settingsFilePath();
  const serialized = JSON.stringify(settings, null, 2);

  if (serialized === lastSerializedSettings) {
    return pendingWrite;
  }

  lastSerializedSettings = serialized;
  pendingWrite = pendingWrite.then(async () => {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, serialized);
  });

  return pendingWrite;
}
