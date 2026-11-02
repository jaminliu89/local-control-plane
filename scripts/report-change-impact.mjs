#!/usr/bin/env node
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const base = process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : process.env.PROTECTED_BASE_REF;
if (!base || !/^[A-Za-z0-9._\/-]+$/.test(base)) {
  console.error("Impact analysis requires a trusted base ref");
  process.exit(1);
}
let changed;
try {
  changed = execFileSync("git", ["diff", "--name-only", "--diff-filter=ACDMRT", `${base}...HEAD`], {
    encoding: "utf8", timeout: 15000,
  }).split("\n").filter(Boolean);
} catch {
  console.error("Cannot calculate changed files");
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(".controlplane/protected-baseline.json", "utf8"));
if (!Array.isArray(manifest.protectedCapabilities) || !manifest.protectedCapabilities.length) process.exit(1);
let impacted = 0;
for (const capability of manifest.protectedCapabilities) {
  if (!Array.isArray(capability.sourcePaths) || !capability.sourcePaths.length) {
    console.error("Missing sourcePaths for", capability.id);
    process.exitCode = 1;
    continue;
  }
  const matches = changed.filter((file) => capability.sourcePaths.some((prefix) =>
    typeof prefix === "string" && prefix.startsWith("src/") && file.startsWith(prefix)
  ));
  if (matches.length) {
    impacted++;
    console.log(`IMPACTED ${capability.id}: ${matches.join(", ")}`);
    console.log("Required regression suites:", capability.requiredTests.join(", "));
  }
}
const unknown = changed.filter((file) => file.startsWith("src/") &&
  !manifest.protectedCapabilities.some((cap) => cap.sourcePaths?.some((prefix) => file.startsWith(prefix))));
if (unknown.length) {
  console.log("UNMAPPED SOURCE CHANGES (manual impact review required):", unknown.join(", "));
}
console.log(`Impact summary: ${impacted} protected capabilities; ${unknown.length} unmapped source files`);
