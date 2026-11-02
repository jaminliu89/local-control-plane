#!/usr/bin/env node
import { execFileSync } from "node:child_process";

const base = process.env.GITHUB_BASE_REF
  ? `origin/${process.env.GITHUB_BASE_REF}`
  : process.env.PROTECTED_BASE_REF;
if (!base || !/^[a-zA-Z0-9._\/-]+$/.test(base)) {
  console.error("Missing or invalid base ref");
  process.exit(1);
}
let files;
try {
  files = execFileSync("git", ["diff", "--name-only", "--diff-filter=ACDMRT", `${base}...HEAD`], {
    encoding: "utf8", timeout: 15000,
  }).split("\n").filter(Boolean);
} catch {
  console.error("Unable to compare changes to protected base");
  process.exit(1);
}
const controlFiles = new Set([
  ".controlplane/protected-baseline.json",
  "scripts/verify-protected-baseline.mjs",
  "scripts/check-protected-changes.mjs",
  ".github/workflows/ci.yml",
]);
const protectedTests = new Set([
  "src/test/acceptance.test.ts",
  "src/test/broker.test.ts",
  "src/test/doctor.test.ts",
  "src/test/capability-discovery.test.ts",
  "src/test/skillhub-route.test.ts",
]);
const sensitive = files.filter((file) => controlFiles.has(file) || protectedTests.has(file));
if (sensitive.length) {
  console.log("PROTECTED_CHANGE_REVIEW_REQUIRED");
  for (const file of sensitive) console.log(" -", file);
  console.log("This report is NOT an approval. Branch protection must require independent CODEOWNERS review.");
} else {
  console.log("No protected control or regression test changes detected.");
}
