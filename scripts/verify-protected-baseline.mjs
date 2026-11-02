#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const manifestPath = path.join(root, ".controlplane", "protected-baseline.json");
function fail(message) {
  console.error("[protected-baseline] FAIL:", message);
  process.exitCode = 1;
}
let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
} catch (error) {
  fail("Cannot read protected baseline: " + String(error));
  process.exit();
}
if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.protectedCapabilities) || manifest.protectedCapabilities.length === 0) {
  fail("Invalid or empty protected capability manifest");
  process.exit();
}
const ids = new Set();
const tests = new Set();
for (const item of manifest.protectedCapabilities) {
  if (typeof item.id !== "string" || !/^[a-z0-9-]+$/.test(item.id) || ids.has(item.id)) {
    fail("Invalid or duplicate capability ID");
    continue;
  }
  ids.add(item.id);
  if (!Array.isArray(item.requiredTests) || item.requiredTests.length === 0) {
    fail(item.id + ": missing requiredTests");
    continue;
  }
  for (const file of item.requiredTests) {
    if (typeof file !== "string" || !/^dist\/test\/[a-zA-Z0-9-]+\.test\.js$/.test(file)) {
      fail(item.id + ": invalid test path");
      continue;
    }
    if (!fs.existsSync(path.join(root, file))) fail(item.id + ": missing compiled test " + file);
    tests.add(file);
  }
}
if (process.exitCode) process.exit();
const { spawnSync } = await import("node:child_process");
const result = spawnSync(process.execPath, ["--test", ...[...tests].sort()], { cwd: root, stdio: "inherit", shell: false, timeout: 120_000 });
if (result.error || result.status !== 0) fail("Protected regression suite failed");
else console.log("[protected-baseline] PASS:", ids.size, "capabilities;", tests.size, "test suites");
