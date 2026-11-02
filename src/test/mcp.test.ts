import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import test from "node:test";
import type { CommandRunner } from "../broker/run.js";
import { startBroker } from "../broker/server.js";

const SECRET = "SENTINEL_MCP_LOG_do_not_leak";

interface McpResult {
  tools?: Array<{ name: string; description: string }>;
  content?: Array<{ text: string }>;
  isError?: boolean;
  serverInfo?: { name?: string };
  instructions?: string;
}

interface McpClient {
  request: (method: string, params?: unknown) => Promise<{ result?: McpResult }>;
  notify: (method: string) => void;
  close: () => void;
}

function startMcp(workspace: string): McpClient {
  const script = path.resolve(import.meta.dirname, "../mcp/stdio.js");
  const child: ChildProcessWithoutNullStreams = spawn(process.execPath, [script], {
    env: { ...process.env, CONTROLPLANE_WORKSPACE: workspace },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  let next = 1;
  const lines = readline.createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    let message: { id?: number };
    try {
      message = JSON.parse(line) as { id?: number };
    } catch {
      for (const waiter of pending.values()) waiter.reject(new Error(`stdout 不是 JSON：${line}`));
      pending.clear();
      return;
    }
    if (message.id === undefined) return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    waiter.resolve(message);
  });
  return {
    request(method, params) {
      const id = next;
      next += 1;
      const body: Record<string, unknown> = { jsonrpc: "2.0", id, method };
      if (params !== undefined) body.params = params;
      child.stdin.write(`${JSON.stringify(body)}\n`);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`MCP 超时 ${method}\n${stderr}`));
        }, 5_000);
        pending.set(id, {
          resolve: (value) => {
            clearTimeout(timer);
            resolve(value as Awaited<ReturnType<McpClient["request"]>>);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        });
      });
    },
    notify(method) {
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`);
    },
    close() {
      child.kill("SIGTERM");
      lines.close();
    },
  };
}

test("MCP 工具名与动词一致，并写明回执是压缩的", async () => {
  const workspace = await fs.promises.mkdtemp(path.join(os.tmpdir(), "lcp-mcp-"));
  const mcp = startMcp(workspace);
  try {
    const initialized = await mcp.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "cursor-test", version: "0.0.0" },
    });
    assert.equal(initialized.result?.serverInfo?.name, "local-control-plane");
    assert.match(initialized.result?.instructions ?? "", /不要向本服务索要完整 stdout/);
    mcp.notify("notifications/initialized");
    const listed = await mcp.request("tools/list");
    const tools = listed.result?.tools ?? [];
    assert.deepEqual(
      tools.map((tool) => tool.name).sort(),
      ["capture_window", "edit", "observe", "observe_ui", "perform_ax", "terminal", "trace", "verify"],
    );
    for (const tool of tools) {
      assert.match(tool.description, /不要把全量日志要回去/);
    }
    const missing = await mcp.request("tools/call", { name: "observe", arguments: {} });
    assert.equal(missing.result?.isError, true);
    assert.match(missing.result?.content?.[0]?.text ?? "", /broker 还没启动/);
  } finally {
    mcp.close();
    await fs.promises.rm(workspace, { recursive: true, force: true });
  }
});

test("MCP verify 只回一张压缩回执，未声明命令不执行", async () => {
  const workspace = await fs.promises.mkdtemp(path.join(os.tmpdir(), "lcp-mcp-"));
  await fs.promises.mkdir(path.join(workspace, ".controlplane"), { recursive: true });
  await fs.promises.writeFile(
    path.join(workspace, ".controlplane", "commands.json"),
    JSON.stringify({ commands: { test: ["node", "test.js"] } }),
    "utf8",
  );
  let calls = 0;
  const run: CommandRunner = async () => {
    calls += 1;
    return { exitCode: 0, stdout: `passed\n${SECRET}`, stderr: "", durationMs: 1 };
  };
  const broker = await startBroker({
    workspace,
    token: "m".repeat(32),
    sessionId: "mcpSession123456",
    run,
  });
  const mcp = startMcp(workspace);
  try {
    await mcp.request("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "codex", version: "0" },
    });
    mcp.notify("notifications/initialized");
    const verified = await mcp.request("tools/call", {
      name: "verify",
      arguments: { commandIds: ["test"], maxRounds: 4 },
    });
    assert.equal(verified.result?.isError, false);
    assert.equal(calls, 1);
    const text = verified.result?.content?.[0]?.text ?? "";
    assert.equal(text.includes(SECRET), false);
    assert.equal(text.includes('"stdout"'), false);
    const payload = JSON.parse(text) as { receipt: { status: string; rounds: number } };
    assert.equal(payload.receipt.status, "passed");
    assert.equal(payload.receipt.rounds, 1);

    const rejected = await mcp.request("tools/call", {
      name: "terminal",
      arguments: { command: "bash -lc 'echo hi'", commandId: "nope" },
    });
    const rejectedText = rejected.result?.content?.[0]?.text ?? "";
    assert.equal(rejectedText.includes(SECRET), false);
    const rejectedPayload = JSON.parse(rejectedText) as { receipt: { status: string } };
    assert.equal(rejectedPayload.receipt.status, "rejected");
    assert.equal(calls, 1);
  } finally {
    mcp.close();
    await broker.close();
    await fs.promises.rm(workspace, { recursive: true, force: true });
  }
});
