import fs from "node:fs";
import path from "node:path";

export type CapabilityStatus = "UNKNOWN" | "DISCOVERED_NOT_CONNECTED" | "VERIFIED_AVAILABLE" | "BLOCKED" | "UNSUPPORTED";

export interface CapabilityCandidate {
  id: string;
  source: string;
  status: CapabilityStatus;
  evidence: string[];
  reason: string;
}

export interface CapabilityDiscovery {
  registryPath: string | null;
  candidates: CapabilityCandidate[];
  missing: string[];
}

/**
 * Safe, local-only capability discovery. No network, subprocess, or implicit
 * trust in workspace-supplied registry paths. Discovery != runtime availability.
 */
export function discoverCapabilities(registryRoot?: string): CapabilityDiscovery {
  const root = registryRoot?.trim();
  if (!root) return { registryPath: null, candidates: [], missing: ["SkillHub registry not configured"] };
  const resolved = path.resolve(root);
  const registry = path.join(resolved, "SKILL_REGISTRY.yaml");
  try {
    if (!fs.statSync(resolved).isDirectory() || !fs.statSync(registry).isFile()) {
      return { registryPath: registry, candidates: [], missing: ["SkillHub registry not found"] };
    }
    // Only confirm the file exists. YAML parsing and semantic routing belong
    // to SkillHub's own canonical CLI, not to a duplicate registry parser.
    return {
      registryPath: registry,
      candidates: [{
        id: "skillhub-registry",
        source: registry,
        status: "DISCOVERED_NOT_CONNECTED",
        evidence: ["registry-file-present"],
        reason: "Registry found; no hub route, agent host or executable capability probe performed",
      }],
      missing: ["Runtime SkillHub routing and capability probes not connected"],
    };
  } catch {
    return { registryPath: registry, candidates: [], missing: ["SkillHub registry not accessible"] };
  }
}
