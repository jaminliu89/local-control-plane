#!/usr/bin/env node
import readline from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { brokerRequest } from "../broker/client.js";
import { loadSession } from "../broker/session.js";

/**
 * 工具说明要让模型知道：回执是压缩的，不要把全量日志要回去。
 * 名字和 broker 的动词一致。
 */
const COMPACT = "回执是压缩的，只有退出码、失败名或第一段错误、diff 统计和耗时。不要把全量日志要回去。";

export const TOOLS = [
  {
    name: "observe",
    description: `压缩查看当前工作区：打开的编辑器、诊断计数、git 状态（若可取得）。${COMPACT}`,
    inputSchema: {
      type: "object",
      properties: {
        actor: { type: "string", description: "谁在下任务，例如 cursor 或 codex" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "edit",
    description: `把 unified diff 应用到工作区内的文件。越出工作区会被拒绝。${COMPACT}通过就停。`,
    inputSchema: {
      type: "object",
      properties: {
        actor: { type: "string" },
        patch: { type: "string", description: "unified diff，路径必须留在工作区内" },
      },
      required: ["patch"],
      additionalProperties: false,
    },
  },
  {
    name: "terminal",
    description: `只运行工作区 .controlplane/commands.json 里声明过的命令 id。不接受任意 shell。${COMPACT}`,
    inputSchema: {
      type: "object",
      properties: {
        actor: { type: "string" },
        commandId: { type: "string", description: "commands.json 里的命令 id" },
      },
      required: ["commandId"],
      additionalProperties: false,
    },
  },
  {
    name: "verify",
    description: `按意图里的验收命令在本机循环，最多 5 轮，通过就停，只回一张压缩回执。回执还有轮次。${COMPACT}`,
    inputSchema: {
      type: "object",
      properties: {
        actor: { type: "string" },
        commandIds: {
          type: "array",
          items: { type: "string" },
          description: "已声明的验收命令 id",
        },
        maxRounds: { type: "integer", minimum: 1, maximum: 5 },
      },
      required: ["commandIds"],
      additionalProperties: false,
    },
  },
  {
    name: "trace",
    description: `只往时间线追加一条事件，不跑命令。${COMPACT}`,
    inputSchema: {
      type: "object",
      properties: {
        actor: { type: "string" },
        summary: { type: "string", description: "这一步的一句话摘要，不超过 200 字" },
        stepKind: { type: "string", enum: ["model_turn", "local_loop"] },
      },
      required: ["summary"],
      additionalProperties: false,
    },
  },
  {
    name: "observe_ui",
    description: `读取当前编辑器窗口的辅助功能树大纲。需要 Mac 菜单栏助手。${COMPACT}`,
    inputSchema: {
      type: "object",
      properties: { actor: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "capture_window",
    description: `截取 VS Code 或 Cursor 单窗口一帧。帧留本机，默认不进模型。需要 Mac 助手与屏幕录制授权。${COMPACT}`,
    inputSchema: {
      type: "object",
      properties: {
        actor: { type: "string" },
        app: { type: "string", enum: ["vscode", "cursor"] },
        windowTitleIncludes: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "perform_ax",
    description: `在已授权窗口里按、设值或输入。需要 Mac 助手与辅助功能授权。${COMPACT}`,
    inputSchema: {
      type: "object",
      properties: {
        actor: { type: "string" },
        action: { type: "string", enum: ["press", "set_value", "type"] },
        target: { type: "string" },
        value: { type: "string" },
      },
      required: ["action", "target"],
      additionalProperties: false,
    },
  },
] as const;

interface JsonRpc {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string };
}

const VERBS = new Set([
  "observe",
  "edit",
  "terminal",
  "verify",
  "trace",
  "observe_ui",
  "capture_window",
  "perform_ax",
]);

export function stripLogs(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => stripLogs(item));
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (/^(stdout|stderr|logs?)$/i.test(key)) continue;
    out[key] = stripLogs(item);
  }
  return out;
}

function defaultActor(clientName: string, given: unknown): string {
  if (typeof given === "string" && given.trim().length > 0 && given.trim().length <= 80) return given.trim();
  if (/codex/i.test(clientName)) return "codex";
  if (/cursor/i.test(clientName)) return "cursor";
  return clientName.slice(0, 80) || "mcp";
}

export async function handleMessage(workspace: string, message: JsonRpc, clientName: string): Promise<JsonRpc | null> {
  if (message.id === undefined) return null;
  const id = message.id;
  const method = message.method ?? "";
  if (method === "initialize") {
    const requested = message.params?.protocolVersion;
    const protocolVersion = typeof requested === "string" && /^\d{4}-\d{2}-\d{2}$/.test(requested)
      ? requested
      : "2024-11-05";
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "local-control-plane", version: "0.1.0" },
        instructions: "回执是压缩的。不要向本服务索要完整 stdout 或日志。验收通过就停。",
      },
    };
  }
  if (method === "ping") return { jsonrpc: "2.0", id, result: {} };
  if (method === "tools/list") return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
  if (method === "tools/call") {
    const name = typeof message.params?.name === "string" ? message.params.name : "";
    if (!VERBS.has(name)) {
      return {
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: "未知工具" }], isError: true },
      } as JsonRpc;
    }
    const rawArgs = message.params?.arguments;
    const args =
      rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)
        ? (rawArgs as Record<string, unknown>)
        : {};
    try {
      const session = loadSession(workspace);
      const payload = await brokerRequest(session, "POST", `/v1/${name}`, {
        ...args,
        entry: "mcp",
        actor: defaultActor(clientName, args.actor),
      });
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: JSON.stringify(stripLogs(payload)) }],
          isError: false,
        },
      };
    } catch (error) {
      const text = error instanceof Error ? error.message : "broker 调用失败";
      return {
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: text.slice(0, 180) }], isError: true },
      };
    }
  }
  return { jsonrpc: "2.0", id, error: { code: -32601, message: "unknown method" } };
}

function workspaceFromEnv(): string {
  const given = process.env.CONTROLPLANE_WORKSPACE;
  if (given && given.trim().length > 0) return path.resolve(given);
  return process.cwd();
}

function main(): void {
  let clientName = "mcp";
  const workspace = workspaceFromEnv();
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  input.on("line", (line) => {
    if (line.trim().length === 0) return;
    let message: JsonRpc;
    try {
      message = JSON.parse(line) as JsonRpc;
    } catch {
      process.stderr.write("无法解析的 JSON-RPC\n");
      return;
    }
    if (message.method === "initialize") {
      const info = message.params?.clientInfo as { name?: string } | undefined;
      if (info && typeof info.name === "string" && info.name.trim().length > 0) clientName = info.name.trim();
    }
    handleMessage(workspace, message, clientName).then(
      (response) => {
        if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
      },
      (error: unknown) => {
        const text = error instanceof Error ? error.message : "mcp 失败";
        process.stderr.write(`${text}\n`);
      },
    );
  });
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entry === fileURLToPath(import.meta.url)) main();
