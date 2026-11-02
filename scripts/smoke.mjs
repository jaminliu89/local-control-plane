#!/usr/bin/env node
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function request(port, token, method, route, body) {
  return fetch(`http://127.0.0.1:${port}/v1/${route}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (response) => {
    const text = await response.text();
    return JSON.parse(text);
  });
}

async function main() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "lcp-smoke-"));
  const token = crypto.randomBytes(16).toString("hex");
  const session = crypto.randomBytes(4).toString("hex");
  fs.mkdirSync(path.join(workspace, ".controlplane"), { recursive: true });
  fs.writeFileSync(
    path.join(workspace, ".controlplane", "commands.json"),
    JSON.stringify({
      commands: {
        check: [process.execPath, "--test", "led.test.js"],
      },
    }),
  );
  fs.writeFileSync(
    path.join(workspace, "led.js"),
    "export function nextLed(on) {\n  return on;\n}\n",
  );
  fs.writeFileSync(
    path.join(workspace, "led.test.js"),
    [
      'import assert from "node:assert/strict";',
      'import test from "node:test";',
      'import { nextLed } from "./led.js";',
      'test("灯的下一状态是翻转", () => {',
      "  assert.equal(nextLed(false), true);",
      "  assert.equal(nextLed(true), false);",
      "});",
      "",
    ].join("\n"),
  );

  const broker = spawn(
    process.execPath,
    [path.join(root, "dist/broker/cli.js"), "--workspace", workspace, "--token", token, "--session", session],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
  );

  const ready = await new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => reject(new Error("broker 启动超时")), 8000);
    broker.stdout.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const nl = buffer.indexOf("\n");
      if (nl < 0) return;
      try {
        const message = JSON.parse(buffer.slice(0, nl));
        if (message.ready === true && message.host === "127.0.0.1") {
          clearTimeout(timer);
          resolve(message.port);
        } else reject(new Error("broker 没有返回本机端口"));
      } catch (error) {
        clearTimeout(timer);
        reject(error);
      }
    });
    broker.on("error", reject);
  });

  try {
    const fail = await request(ready, token, "POST", "verify", {
      entry: "rest",
      actor: "smoke",
      commandIds: ["check"],
      maxRounds: 1,
    });
    if (fail.receipt?.status !== "failed") throw new Error("期望先失败");
    if (!String(fail.receipt?.failure ?? "").includes("not ok")) {
      throw new Error(`失败回执不对：${fail.receipt?.failure}`);
    }

    const patch = [
      "diff --git a/led.js b/led.js",
      "--- a/led.js",
      "+++ b/led.js",
      "@@ -1,3 +1,3 @@",
      " export function nextLed(on) {",
      "-  return on;",
      "+  return !on;",
      " }",
      "",
    ].join("\n");
    const edited = await request(ready, token, "POST", "edit", {
      entry: "rest",
      actor: "smoke",
      patch,
    });
    if (edited.receipt?.status !== "passed") throw new Error("补丁失败");

    const pass = await request(ready, token, "POST", "verify", {
      entry: "rest",
      actor: "smoke",
      commandIds: ["check"],
      maxRounds: 1,
    });
    if (pass.receipt?.status !== "passed") throw new Error("修复后应通过");

    const journalPath = path.join(workspace, "journal.md");
    await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [path.join(root, "dist/journal/cli.js"), "--workspace", workspace, "--out", journalPath],
        { stdio: "inherit" },
      );
      child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`journal 退出 ${code}`))));
    });
    const journal = fs.readFileSync(journalPath, "utf8");
    if (!journal.includes("编程过程日志") || !journal.includes("smoke/rest")) {
      throw new Error("过程日志内容不对");
    }
    process.stdout.write(`smoke ok · port ${ready} · journal ${journalPath}\n`);
  } finally {
    broker.kill("SIGTERM");
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});
