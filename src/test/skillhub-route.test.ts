import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { routeSkillHub } from "../capabilities/skillhubRoute.js";

test("SkillHub route refuses missing configuration", async () => {
  const result = await routeSkillHub("build a website");
  assert.equal(result.blocked, true);
  assert.deepEqual(result.candidates, []);
});

test("SkillHub route refuses invalid intent", async () => {
  const result = await routeSkillHub(" ");
  assert.equal(result.blocked, true);
});

test("SkillHub route refuses missing CLI without invoking Python", async () => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "lcp-hub-route-"));
  try {
    await fs.promises.writeFile(path.join(dir, "SKILL_REGISTRY.yaml"), "schema_version: 1\n");
    const result = await routeSkillHub("build a website", dir);
    assert.equal(result.blocked, true);
    assert.equal(result.candidates.length, 0);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
});
