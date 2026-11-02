import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { discoverCapabilities } from "../capabilities/discovery.js";

test("missing registry config never reports an available capability", () => {
  const result = discoverCapabilities();
  assert.equal(result.registryPath, null);
  assert.deepEqual(result.candidates, []);
  assert.ok(result.missing.length > 0);
});

test("missing registry file is not a connected capability", async () => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "lcp-discovery-"));
  try {
    const result = discoverCapabilities(dir);
    assert.equal(result.candidates.length, 0);
    assert.match(result.missing[0], /not found/);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
});

test("present registry remains discovered but not connected", async () => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "lcp-discovery-"));
  try {
    await fs.promises.writeFile(path.join(dir, "SKILL_REGISTRY.yaml"), "version: 1\n");
    const result = discoverCapabilities(dir);
    assert.equal(result.candidates[0]?.status, "DISCOVERED_NOT_CONNECTED");
    assert.equal(result.candidates.some((item) => item.status === "VERIFIED_AVAILABLE"), false);
    assert.ok(result.missing.length > 0);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
});
