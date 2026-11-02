import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startBroker } from "../broker/server.js";
import { execute, emptySnapshot } from "../broker/verbs.js";
import { AUTH_PLACEHOLDER } from "../contract/timeline.js";
import { MemoryTimelineStore } from "../broker/store.js";
import { startMockHelper } from "../helper/mockServer.js";

async function tempWorkspace(): Promise<string> {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), "lcp-helper-"));
}

test("没有助手时 observe_ui 明确拒绝，不假装已授权", async () => {
  const workspace = await tempWorkspace();
  try {
    const store = new MemoryTimelineStore();
    const outcome = await execute(
      { workspace, store, run: async () => ({ exitCode: 0, stdout: "", stderr: "", durationMs: 0 }), snapshot: emptySnapshot(), auth: AUTH_PLACEHOLDER },
      "observe_ui",
      { actor: "cursor" },
    );
    assert.equal(outcome.receipt.status, "rejected");
    assert.match(outcome.receipt.failure ?? "", /Mac 菜单栏助手/);
    assert.equal(store.list().at(-1)?.auth.state, "placeholder");
  } finally {
    await fs.promises.rm(workspace, { recursive: true, force: true });
  }
});

test("mock 助手在线时可读 UI、截帧，并把授权写进时间线", async () => {
  const workspace = await tempWorkspace();
  const helper = await startMockHelper(workspace, {
    state: "ready",
    screenRecording: "granted",
    accessibility: "granted",
  });
  const token = crypto.randomBytes(16).toString("hex");
  const sessionId = crypto.randomBytes(4).toString("hex");
  const broker = await startBroker({ wobkspace, token, sessionId });
  try {
    const ui = await fetch(`http://127.0.0.1:${broker.port}/v1/observe_ui`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ entry: "rest", actor: "cursor" }),
    }).then((response) => response.json()) as {
      receipt: { status: string };
      ui?: { nodeCount: number };
      auth?: { state: string };
    };
    assert.equal(ui.receipt.status, "passed");
    assert.equal(ui.ui?.nodeCount, 4);
    assert.equal(ui.auth?.state, "ready");

    const frame = await fetch(`http://127.0.0.1:${broker.port}/v1/capture_window`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ entry: "rest", actor: "cursor", app: "vscode" }),
    }).then((response) => response.json()) as {
      receipt: { status: string };
      artifact?: { kind: string; path: string };
    };
    assert.equal(frame.receipt.status, "passed");
    assert.equal(frame.artifact?.kind, "window_frame");
    assert.match(frame.artifact?.path ?? "", /mock-frame/);

    const auth = await fetch(`http://127.0.0.1:${broker.port}/v1/auth`, {
      headers: { authorization: `Bearer ${token}` },
    }).then((response) => response.json()) as { auth: { state: string; screenRecording: string } };
    assert.equal(auth.auth.state, "ready");
    assert.equal(auth.auth.screenRecording, "granted");
  } finally {
    await broker.close();
    await helper.close();
    await fs.promises.rm(workspace, { recursive: true, force: true });
  }
});
