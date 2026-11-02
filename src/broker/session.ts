import fs from "node:fs";
import path from "node:path";
import type { BrokerSession } from "../contract/session.js";

const SESSION_ID = /^[A-Za-z0-9_-]{8,64}$/;

export function controlPlaneDir(workspace: string): string {
  return path.join(workspace, ".controlplane");
}

export function sessionFile(workspace: string, sessionId: string): string {
  if (!SESSION_ID.test(sessionId)) throw new Error("会话 id 不合法");
  return path.join(controlPlaneDir(workspace), "sessions", `${sessionId}.json`);
}

export function timelineFile(workspace: string, sessionId: string): string {
  if (!SESSION_ID.test(sessionId)) throw new Error("会话 id 不合法");
  return path.join(controlPlaneDir(workspace), "sessions", `${sessionId}.jsonl`);
}

export function currentFile(workspace: string): string {
  return path.join(controlPlaneDir(workspace), "current");
}

export function writeSessionFile(workspace: string, session: BrokerSession): void {
  const file = sessionFile(workspace, session.id);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${JSON.stringify(session)}\n`, { encoding: "utf8", mode: 0o600 });
}

export function writeCurrent(workspace: string, sessionId: string): void {
  if (!SESSION_ID.test(sessionId)) throw new Error("会话 id 不合法");
  const file = currentFile(workspace);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${sessionId}\n`, { encoding: "utf8", mode: 0o600 });
}

export function clearCurrent(workspace: string, sessionId: string): void {
  const file = currentFile(workspace);
  if (!fs.existsSync(file)) return;
  const current = fs.readFileSync(file, "utf8").trim();
  if (current === sessionId) fs.rmSync(file, { force: true });
}

export function loadSession(workspace: string): BrokerSession {
  const pointer = currentFile(workspace);
  if (!fs.existsSync(pointer)) {
    throw new Error("本机 broker 还没启动。用 VS Code 打开工作区并激活「本机控制面」扩展。");
  }
  const id = fs.readFileSync(pointer, "utf8").trim();
  if (!SESSION_ID.test(id)) throw new Error("会话 id 不合法");
  const file = sessionFile(workspace, id);
  if (!fs.existsSync(file)) {
    throw new Error("本机 broker 还没启动。用 VS Code 打开工作区并激活「本机控制面」扩展。");
  }
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<BrokerSession>;
  if (parsed.host !== "127.0.0.1") throw new Error("broker 不在 127.0.0.1");
  if (typeof parsed.port !== "number" || !Number.isInteger(parsed.port) || parsed.port < 1 || parsed.port > 65535) {
    throw new Error("端口不合法");
  }
  if (typeof parsed.token !== "string" || parsed.token.length < 16) throw new Error("token 不合法");
  return {
    id,
    host: "127.0.0.1",
    port: parsed.port,
    token: parsed.token,
    pid: typeof parsed.pid === "number" ? parsed.pid : 0,
  };
}
