import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startBroker } from "../broker/server.js";
import { apply, buildControlPlaneTools, type ToolDefinition } from "../dsh/plugin.js";

async function tempWorkspace(): Promise<string> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "lcp-dsh-"));
  await fs.promises.mkdir(path.join(dir, ".controlplane"), { recursive: true });
  await fs.promises.writeFile(
    path.join(dir, ".controlplane", "commands.json"),
    `${JSON.stringify({ commands: { ok: [process.execPath, "-e", "process.exit(0)"] } })}\n`,
    "utf8",
  );
  return dir;
}

test("DeepSeek 插件注册控制面动词，不另写 agent loop", () => {
  const registered: string[] = [];
  apply(
    {
      tools: {
        register(tool: ToolDefinition) {
          registered.push(tool.name);
          assert.match(tool.description, /回执是压缩的/);
          assert.match(tool.description, /不要把全量日志要回去/);
        },
      },
    },
    {},
  );
  assert.deepEqual(registered, [
    "observe",
    "edit",
    "terminal",
    "verify",
    "trace",
    "observe_ui",
    "capture_window",
    "perform_ax",
  ]);
});

test("DeepSeek 工具经 broker，时间线入口标成 dsh", async () => {
  const workspace = await tempWorkspace();
  const token = crypto.randomBytes(16).toString("hex");
  const sessionId = crypto.randomBytes(4).toString("hex");
  const broker = await startBroker({ workspace, token, sessionId });
  try {
    const tools = buildControlPlaneTools(workspace);
    const verify = tools.find((tool) => tool.name === "verify");
    assert.ok(verify);
    const result = (await verify.execute({ commandIds: ["ok"], maxRounds: 1 })) as {
      receipt?: { status?: string; rounds?: number;
    };
    assert.equal(result.receipt?.status, "passed");
    assert.equal(result.receipt?.rounds, 1);
    assert.equal(JSON.stringify(result).includes("stdout"), false);

    const body = await fetch(`http://127.0.0.1:${broker.port}/v1/timeline`, {
      headers: { authorization: `Bearer ${token}` },
    }).then((response) => response.json()) as { events: Array<{ entry: string; actor: string }> };
    assert.ok(body.events.some((event) => event.entry === "dsh" && event.actor === "deepseek"));
  } finally {
    await broker.close();
    await fs.promises.rm(workspace, { recursive: true, force: true });
  }
});
