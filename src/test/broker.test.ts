import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { brokerRequest } from "../broker/client.js";
import { parseBrokerArgs } from "../broker/cli.js";
import type { CommandRunner } from "../broker/run.js";
import { timelineFile } from "../broker/session.js";
import { startBroker } from "../broker/server.js";

const SECRET = "SENTINEL_HTTP_LOG_do_not_leak";

async function tempWorkspace(): Promise<string> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "lcp-broker-"));
  await fs.promises.mkdir(path.join(dir, ".controlplane"), { recursive: true });
  await fs.promises.writeFile(
    path.join(dir, ".controlplane", "commands.json"),
    JSON.stringify({ commands: { test: ["node", "test.js"] } }),
    "utf8",
  );
  return dir;
}

test("broker 只绑 127.0.0.1，错误 token 被拒绝，验收回执不含完整 stdout", async () => {
  const workspace = await tempWorkspace();
  const token = "t".repeat(32);
  const sessionId = "sessionabcdef12";
  let calls = 0;
  const run: CommandRunner = async () => {
    calls += 1;
    return {
      exitCode: calls === 1 ? 1 : 0,
      stdout: `first line ok\n${SECRET}\n${"z".repeat(500)}`,
      stderr: "",
      durationMs: 2,
    };
  };
  const broker = await startBroker({ workspace, token, sessionId, run });
  try {
    assert.equal(broker.host, "127.0.0.1");
    assert.notEqual(broker.port, 0);
    const session = { host: "127.0.0.1" as const, port: broker.port, token };
    const health = (await brokerRequest(session, "GET", "/v1/health")) as { ok?: boolean; host?: string };
    assert.equal(health.ok, true);
    assert.equal(health.host, "127.0.0.1");

    const denied = await brokerRequest({ ...session, token: "u".repeat(32) }, "GET", "/v1/health");
    assert.equal((denied as { receipt?: { status?: string } }).receipt?.status, "rejected");

    const verified = (await brokerRequest(session, "POST", "/v1/verify", {
      commandIds: ["test"],
      maxRounds: 3,
      actor: "cursor",
    })) as { receipt: { status: string; rounds: number; failure?: string }; stdout?: string };
    assert.equal(calls, 2);
    assert.equal(verified.receipt.status, "passed");
    assert.equal(verified.receipt.rounds, 2);
    assert.equal(verified.stdout, undefined);
    const body = JSON.stringify(verified);
    assert.equal(body.includes(SECRET), false);
    assert.equal(body.includes('"stdout"'), false);

    const timeline = (await brokerRequest(session, "GET", "/v1/timeline")) as { events: unknown[] };
    const timelineJson = JSON.stringify(timeline);
    assert.equal(timelineJson.includes(SECRET), false);
    assert.equal(timelineJson.includes('"stdout"'), false);
    assert.ok(timeline.events.length >= 3);

    const log = await fs.promises.readFile(timelineFile(workspace, sessionId), "utf8");
    assert.equal(log.includes(SECRET), false);
  } finally {
    await broker.close();
    await fs.promises.rm(workspace, { recursive: true, force: true });
  }
});

test("cli 只在 127.0.0.1 上报告就绪", async () => {
  const workspace = await tempWorkspace();
  const script = path.resolve(import.meta.dirname, "../broker/cli.js");
  const token = "c".repeat(32);
  const child = spawn(process.execPath, [
    script,
    "--workspace",
    workspace,
    "--token",
    token,
    "--session",
    "clisession123456",
  ], { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  try {
    const line = await new Promise<string>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error(`cli 超时\n${stderr}`));
      }, 5_000);
      let buffer = "";
      child.stdout.on("data", (chunk: Buffer) => {
        if (settled) return;
        buffer += chunk.toString("utf8");
        const newline = buffer.indexOf("\n");
        if (newline < 0) return;
        settled = true;
        clearTimeout(timer);
        resolve(buffer.slice(0, newline));
      });
      child.on("exit", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error(`cli 退出 ${code ?? "未知"}\n${stderr}`));
      });
    });
    const ready = JSON.parse(line) as { ready?: boolean; host?: string; port?: number };
    assert.equal(ready.ready, true);
    assert.equal(ready.host, "127.0.0.1");
    assert.equal(typeof ready.port, "number");
    const health = (await brokerRequest(
      { host: "127.0.0.1", port: ready.port ?? 0, token },
      "GET",
      "/v1/health",
    )) as { ok?: boolean; host?: string };
    assert.equal(health.ok, true);
    assert.equal(health.host, "127.0.0.1");
  } finally {
    child.kill("SIGTERM");
    await fs.promises.rm(workspace, { recursive: true, force: true });
  }
});

test("命令行拒绝把 broker 绑到 0.0.0.0", () => {
  const rejected = parseBrokerArgs(["--workspace", "/tmp", "--token", "t".repeat(32), "--session", "sessionabcdef12", "--host", "0.0.0.0"]);
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.match(rejected.error, /127\.0\.0\.1/);
  const also = parseBrokerArgs(["--workspace", "/tmp", "--token", "t".repeat(32), "--session", "sessionabcdef12", "0.0.0.0"]);
  assert.equal(also.ok, false);
});
