import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startBroker } from "../broker/server.js";
import { pushTimelineToHelper } from "../helper/client.js";
import { authFromFlag, startHelperServer } from "../helper/server.js";

async function tempWorkspace(): Promise<string> {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), "lcp-helper-push-"));
}

test("broker 追加事件后会推给助手 /v1/timeline", async () => {
  const workspace = await tempWorkspace();
  const helper = await startHelperServer({
    workspace,
    auth: authFromFlag("ready"),
    mode: "mock",
    ui: true,
  });
  const token = crypto.randomBytes(16).toString("hex");
  const sessionId = crypto.randomBytes(4).toString("hex");
  const broker = await startBroker({ workspace, token, sessionId });
  try {
    await fs.promises.mkdir(path.join(workspace, ".controlplane"), { recursive: true });
    await fs.promises.writeFile(
      path.join(workspace, ".controlplane", "commands.json"),
      JSON.stringify({ commands: { ping: [process.execPath, "--version"] } }),
    );
    const result = await fetch(`http://127.0.0.1:${broker.port}/v1/trace`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ entry: "rest", actor: "test", summary: "推给助手" }),
    }).then((response) => response.json()) as { receipt: { status: string } };
    assert.equal(result.receipt.status, "passed");

    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.ok(helper.events().length >= 1);
    assert.equal(helper.events().at(-1)?.summary, "推给助手");

    const frame = await fetch(helper.panelUrl!).then((response) => response.text());
    assert.match(frame, /正在做/);
  } finally {
    await broker.close();
    await helper.close();
    await fs.promises.rm(workspace, { recursive: true, force: true });
  }
});

test("缺屏幕录制时 capture 被拒绝；缺辅助功能时 observe_ui 被拒绝", async () => {
  const workspace = await tempWorkspace();
  const helper = await startHelperServer({
    workspace,
    auth: authFromFlag("missing_both"),
    mode: "mock",
  });
  const token = crypto.randomBytes(16).toString("hex");
  const sessionId = crypto.randomBytes(4).toString("hex");
  const broker = await startBroker({ workspace, token, sessionId });
  try {
    const capture = await fetch(`http://127.0.0.1:${broker.port}/v1/capture_window`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ entry: "rest", actor: "test", app: "vscode" }),
    }).then((response) => response.json()) as { receipt: { status: string; failure?: string } };
    assert.equal(capture.receipt.status, "rejected");
    assert.match(capture.receipt.failure ?? "", /屏幕录制/);

    const ui = await fetch(`http://127.0.0.1:${broker.port}/v1/observe_ui`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ entry: "rest", actor: "test" }),
    }).then((response) => response.json()) as { receipt: { status: string; failure?: string } };
    assert.equal(ui.receipt.status, "rejected");
    assert.match(ui.receipt.failure ?? "", /辅助功能/);
  } finally {
    await broker.close();
    await helper.close();
    await fs.promises.rm(workspace, { recursive: true, force: true });
  }
});

test("pushTimelineToHelper 在无助手时静默", async () => {
  const workspace = await tempWorkspace();
  try {
    await pushTimelineToHelper(workspace, []);
  } finally {
    await fs.promises.rm(workspace, { recursive: true, force: true });
  }
});
