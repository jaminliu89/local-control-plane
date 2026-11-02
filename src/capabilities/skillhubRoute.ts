import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { CapabilityCandidate } from "./discovery.js";

export interface RouteResult {
  intent: string;
  candidates: CapabilityCandidate[];
  blocked: boolean;
  reason?: string;
}

/** Read-only SkillHub route adapter. Never dispatches an agent or executes a routed skill. */
export async function routeSkillHub(intent: string, registryRoot?: string, timeoutMs = 3000): Promise<RouteResult> {
  if (!intent.trim() || intent.length > 500) return { intent, candidates: [], blocked: true, reason: "Invalid intent" };
  if (!registryRoot?.trim()) return { intent, candidates: [], blocked: true, reason: "SkillHub not configured" };
  const root = path.resolve(registryRoot);
  const script = path.join(root, "scripts", "hub.py");
  try {
    if (!fs.statSync(path.join(root, "SKILL_REGISTRY.yaml")).isFile() || !fs.statSync(script).isFile()) {
      return { intent, candidates: [], blocked: true, reason: "SkillHub CLI or registry missing" };
    }
  } catch {
    return { intent, candidates: [], blocked: true, reason: "SkillHub CLI or registry inaccessible" };
  }
  return new Promise((resolve) => {
    const child = spawn("python3", [script, "route", intent, "--json", "--top", "5"], {
      cwd: root,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", SKILLHUB_HOME: root, PYTHONDONTWRITEBYTECODE: "1" },
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result: RouteResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ intent, candidates: [], blocked: true, reason: "SkillHub route timed out" });
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (stdout.length > 64_000) {
        child.kill("SIGKILL");
        finish({ intent, candidates: [], blocked: true, reason: "SkillHub route output exceeded limit" });
      }
    });
    child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString("utf8")).slice(0, 1000); });
    child.on("error", () => finish({ intent, candidates: [], blocked: true, reason: "SkillHub CLI could not start" }));
    child.on("close", (code) => {
      if (settled) return;
      if (code !== 0) return finish({ intent, candidates: [], blocked: true, reason: "SkillHub route returned no verified candidates" });
      try {
        const data = JSON.parse(stdout) as { candidates?: Array<{ key?: unknown; skill?: unknown; owner?: unknown }> };
        if (!Array.isArray(data.candidates)) throw new Error("Invalid response");
        const candidates: CapabilityCandidate[] = data.candidates.slice(0, 5).filter((item) => typeof item.key === "string").map((item) => ({
          id: String(item.key),
          source: typeof item.skill === "string" ? item.skill : root,
          status: "DISCOVERED_NOT_CONNECTED",
          evidence: ["SkillHub CLI route candidate; runtime invocation not probed"],
          reason: typeof item.owner === "string" ? `Suggested owner: ${item.owner}` : "Candidate only",
        }));
        finish({ intent, candidates, blocked: candidates.length === 0, reason: candidates.length ? undefined : "No route candidates" });
      } catch {
        finish({ intent, candidates: [], blocked: true, reason: "SkillHub route response invalid" });
      }
    });
  });
}
