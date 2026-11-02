import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { requestHelperAuth } from "../helper/client.js";
import { ACCESSIBILITY_SETTINGS_URL, SCREEN_RECORDING_SETTINGS_URL } from "../helper/authLinks.js";
import { authFromFlag, startHelperServer } from "../helper/server.js";

async function tempWorkspace(): Promise<string> {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), "lcp-auth-req-"));
}

test("auth/request 返回系统设置深链与演示说明", async () => {
  const workspace = await tempWorkspace();
  const helper = await startHelperServer({
    workspace,
    auth: authFromFlag("missing_both"),
    mode: "mock",
  });
  try {
    const both = await requestHelperAuth(workspace, "both");
    assert.equal(both.ok, true);
    assert.deepEqual(both.openUrls, [SCREEN_RECORDING_SETTINGS_URL, ACCESSIBILITY_SETTINGS_URL]);
    assert.match(both.note, /演示助手/);
    assert.equal(both.auth.state, "missing_both");

    const screen = await requestHelperAuth(workspace, "screen");
    assert.deepEqual(screen.openUrls, [SCREEN_RECORDING_SETTINGS_URL]);

    const ax = await requestHelperAuth(workspace, "accessibility");
    assert.deepEqual(ax.openUrls, [ACCESSIBILITY_SETTINGS_URL]);
  } finally {
    await helper.close();
    await fs.promises.rm(workspace, { recursive: true, force: true });
  }
});
