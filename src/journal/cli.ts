#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { brokerRequest } from "../broker/client.js";
import { loadSession, timelineFile } from "../broker/session.js";
import type { TimelineEvent } from "../contract/timeline.js";
import { formatJournal } from "./format.js";

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

function outPath(argv: string[], workspace: string, sessionId: string): string | undefined {
  const flag = argv.indexOf("--out");
  if (flag < 0) return undefined;
  const value = argv[flag + 1];
  if (!value || value.startsWith("--")) throw new Error("缺少 --out 路径");
  if (path.isAbsolute(value)) return value;
  return path.join(workspace, value);
}

function readJsonl(file: string): TimelineEvent[] {
  if (!fs.existsSync(file)) return [];
  const events: TimelineEvent[] = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      events.push(JSON.parse(line) as TimelineEvent);
    } catch {
      // 坏行跳过
    }
  }
  return events;
}

async function loadEvents(workspace: string): Promise<{ events: TimelineEvent[]; sessionId: string }> {
  try {
    const session = loadSession(workspace);
    const body = (await brokerRequest(session, "GET", "/v1/timeline", undefined, 5_000)) as {
      events?: TimelineEvent[];
    };
    return {
      events: Array.isArray(body.events) ? body.events : [],
      sessionId: session.id,
    };
  } catch {
    const pointer = path.join(workspace, ".controlplane", "current");
    if (!fs.existsSync(pointer)) throw new Error("没有当前会话。先启动扩展或 broker。");
    const sessionId = fs.readFileSync(pointer, "utf8").trim();
    return { events: readJsonl(timelineFile(workspace, sessionId)), sessionId };
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(
      [
        "用法: node dist/journal/cli.js [--workspace <路径>] [--out journals/latest.md]",
        "",
        "把本机时间线导出成编程过程日志，方便反复对照。",
        "",
      ].join("\n"),
    );
    return;
  }
  const workspace = workspaceFromArgv(argv);
  const { events, sessionId } = await loadEvents(workspace);
  const text = formatJournal(events, { sessionId });
  const target = outPath(argv, workspace, sessionId);
  if (target) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text, "utf8");
    process.stdout.write(`${target}\n`);
    return;
  }
  process.stdout.write(text);
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entry === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "导出失败";
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}
