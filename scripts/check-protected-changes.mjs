#!/usr/bin/env node
import { execFileSync } from "node:child_process";

const base = process.env.GITHUB_BASE_REF
  ? `origin/${process.env.GITHUB_BASE_REF}`
  : process.env.PROTECTED_BASE_REF;
if (!base || !/^[a-zA-Z0-9._\/-]+$/.test(base)) {
  console.error("Missing or invalid base ref; cannot validate protected files");
  process.exit(1);
}
let files;
try {
  const output = execFileSync("git", ["diff", "--name-only", "--diff-filter=ACDMRT", `${base}...HEAD`], { encoding: "utf8", timeout: 15000 });
  files = output.split("\n").filter(Boolean);
} catch (error) {
  console.error("Cannot determine changes against base ref:", String(error));
  process.exit(1);
}
const protectedFiles = new Set([
  ".controlplane/protected-baseline.json",
  "scripts/verify-protected-baseline.mjs",
  "scripts/check-protected-changes.mjs",
  ".github/workflows/ci.yml",
  "src/test/acceptance.test.ts",
  "src/test/broker.test.ts",
  "src/test/doctor.test.ts",
  "src/test/capability-discovery.test.ts",
  "src/test/skillhub-route.test.ts",
]);
const touched = files.filter((file) => protectedFiles.has(file));
if (touched.length > 0) {
  console.error("Protected control files changed; independent approval required:", touched.join(", "));
  // Bootstrap: a newly introduced gate must be reviewed separately.
  // Never silently allow changes to the verifier itself.
  process.exit(2);
}
console.log("Protected control files unchanged relative to", base);
