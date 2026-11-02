#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { brokerRequest } from "../broker/client.js";
import { loadSession } from "../broker/session.js";
import type { TimelineEvent } from "../contract/timeline.js";
import { startPanelServer } from "./panelServer.js";
import { buildWitnessFrame, formatWitnessFrame } from "./render.js";

function spawnDetached(command: string, args: string[]): void {
  try {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.unref();
  } catch {
    // 打不开浏览器时只保留打印出的 URL。
  }
}

function workspaceFromArgv(argv: string[]): string {
  const flag = argv.indexOf("--workspace");
  if (flag >= 0) {
    const value = argv[flag + 1];
    if (!value || value.startsWith("--")) throw new Error("缺少 --workspace 路径");
    return path.resolve(value);
  }
  if (process.env.CONTROLPLANE_WORKSPACE) return path.resolve(process.env.CONTROLPLANE_WORKSPACE);
  return process.cwd();
}

function parseInterval(argv: string[]): number {
  const flag = argv.indexOf("--interval");
  if (flag < 0) return 1000;
  const value = Number(argv[flag + 1]);
  if (!Number.isFinite(value) || value < 200 || value > 10_000) throw new Error("--interval 要在 200 到 10000 毫秒之间");
  return Math.floor(value);
}

async function fetchEvents(workspace: string): Promise<{
  events: TimelineEvent[];
  sessionId: string;
  host: "127.0.0.1";
  port: number;
}> {
  const session = loadSession(workspace);
  const body = (await brokerRequest(session, "GET", "/v1/timeline", undefined, 5_000)) as {
    events?: TimelineEvent[];
  };
  return {
    events: Array.isArray(body.events) ? body.events : [],
    sessionId: session.id,
    host: "127.0.0.1",
    port: session.port,
  };
}

async function tick(workspace: string, clear: boolean): Promise<void> {
  const { events, sessionId, host, port } = await fetchEvents(workspace);
  const frame = buildWitnessFrame(events, { sessionId, host, port });
  const text = formatWitnessFrame(frame);
  if (clear && process.stdout.isTTY) {
    process.stdout.write("\x1b[2J\x1b[H");
  }
  process.stdout.write(`${text}\n`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(
      [
        "用法: node dist/witness/watch.js [--workspace <路径>] [--interval 1000] [--once] [--ui] [--open]",
        "",
        "默认在终端刷新时间线。",
        "--ui 再开一个只听 127.0.0.1 的 Prism 构图小窗口预览。",
        "--open 在有 --ui 时尝试打开系统浏览器。",
        "先让扩展或 broker 在该工作区启动，再开见证。",
        "",
      ].join("\n"),
    );
    return;
  }
  const workspace = workspaceFromArgv(argv);
  if (!fs.existsSync(workspace) || !fs.statSync(workspace).isDirectory()) {
    throw new Error(`工作区不是目录：${workspace}`);
  }
  const once = argv.includes("--once");
  const wantUi = argv.includes("--ui");
  const wantOpen = argv.includes("--open");
  const interval = parseInterval(argv);

  let panel: Awaited<ReturnType<typeof startPanelServer>> | undefined;
  if (wantUi) {
    panel = await startPanelServer(workspace);
    process.stdout.write(`见证小窗口 ${panel.url}\n`);
    if (wantOpen) {
      const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
      const args = process.platform === "win32" ? ["/c", "start", "", panel.url] : [panel.url];
      spawnDetached(opener, args);
    }
  }

  if (once) {
    await tick(workspace, false);
    if (panel) await panel.close();
    return;
  }

  await tick(workspace, !wantUi);
  const timer = setInterval(() => {
    void tick(workspace, !wantUi).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "读时间线失败";
      if (!wantUi && process.stdout.isTTY) process.stdout.write("\x1b[2J\x1b[H");
      process.stdout.write(`本机控制面 · 见证\n\n${message}\n\n等 broker 起来后再看。\n`);
    });
  }, interval);

  const stop = (): void => {
    clearInterval(timer);
    if (panel) {
      void panel.close().finally(() => process.exit(0));
      return;
    }
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entry === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "见证启动失败";
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}
