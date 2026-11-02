#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { clearCurrent } from "./session.js";
import { startBroker, type BrokerOptions } from "./server.js";

export type ParsedArgs =
  | { ok: true; value: BrokerOptions }
  | { ok: false; error: string };

export function parseBrokerArgs(argv: string[]): ParsedArgs {
  if (argv.includes("--host") || argv.includes("0.0.0.0") || argv.includes("::")) {
    return { ok: false, error: "broker 只监听 127.0.0.1，不对 0.0.0.0 监听" };
  }
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg?.startsWith("--")) return { ok: false, error: `无法识别的参数：${arg ?? ""}` };
    const key = arg.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) return { ok: false, error: `缺少参数 ${arg}` };
    values.set(key, value);
    index += 1;
  }
  const workspace = values.get("workspace");
  const token = values.get("token");
  const sessionId = values.get("session");
  if (!workspace || !token || !sessionId) {
    return { ok: false, error: "需要 --workspace、--token 和 --session" };
  }
  if (!fs.existsSync(workspace) || !fs.statSync(workspace).isDirectory()) {
    return { ok: false, error: "workspace 不是目录" };
  }
  return {
    ok: true,
    value: {
      workspace: path.resolve(workspace),
      token,
      sessionId,
    },
  };
}

async function main(): Promise<void> {
  const parsed = parseBrokerArgs(process.argv.slice(2));
  if (!parsed.ok) {
    process.stderr.write(`${parsed.error}\n`);
    process.exit(2);
  }
  const broker = await startBroker(parsed.value);
  process.stdout.write(`${JSON.stringify({ ready: true, host: broker.host, port: broker.port, session: parsed.value.sessionId })}\n`);
  let closing = false;
  const shutdown = (): void => {
    if (closing) return;
    closing = true;
    broker.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  process.on("exit", () => {
    try {
      clearCurrent(parsed.value.workspace, parsed.value.sessionId);
    } catch {
      // 进程退出时清指针失败不影响已经关掉的端口。
    }
  });
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entry === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "broker 启动失败";
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}
