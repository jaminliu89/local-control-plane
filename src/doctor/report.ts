import fs from "node:fs";
import path from "node:path";
import { brokerRequest } from "../broker/client.js";
import { discoverCapabilities } from "../capabilities/discovery.js";
import { loadCommands } from "../broker/commands.js";
import { loadSession } from "../broker/session.js";
import { probeHelperAuth, readHelperHint } from "../helper/client.js";

export type CheckLevel = "ok" | "warn" | "fail";

export interface DoctorCheck {
  id: string;
  level: CheckLevel;
  title: string;
  detail: string;
}

export interface DoctorReport {
  workspace: string;
  checks: DoctorCheck[];
  ok: boolean;
}

function nodeMajor(): number {
  const major = Number(process.versions.node.split(".")[0]);
  return Number.isFinite(major) ? major : 0;
}

export async function runDoctor(workspace: string): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const root = path.resolve(workspace);

  if (nodeMajor() >= 18) {
    checks.push({
      id: "node",
      level: "ok",
      title: "Node.js",
      detail: `当前 ${process.versions.node}`,
    });
  } else {
    checks.push({
      id: "node",
      level: "fail",
      title: "Node.js",
      detail: `需要 >= 18，当前 ${process.versions.node}`,
    });
  }

  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    checks.push({
      id: "workspace",
      level: "fail",
      title: "工作区",
      detail: `${root} 不是目录`,
    });
    return { workspace: root, checks, ok: false };
  }
  checks.push({
    id: "workspace",
    level: "ok",
    title: "工作区",
    detail: root,
  });

  const commandsFile = path.join(root, ".controlplane", "commands.json");
  if (!fs.existsSync(commandsFile)) {
    checks.push({
      id: "commands",
      level: "fail",
      title: "声明命令",
      detail: "缺少 .controlplane/commands.json。先运行 npm run init 或扩展里的「初始化工作区命令」。",
    });
  } else {
    try {
      const commands = loadCommands(root);
      checks.push({
        id: "commands",
        level: commands.size > 0 ? "ok" : "warn",
        title: "声明命令",
        detail: commands.size > 0 ? `${commands.size} 条：${[...commands.keys()].join(", ")}` : "commands.json 是空的",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "无法读取";
      checks.push({
        id: "commands",
        level: "fail",
        title: "声明命令",
        detail: message,
      });
    }
  }

  try {
    const session = loadSession(root);
    const health = (await brokerRequest(session, "GET", "/v1/health", undefined, 3_000)) as { ok?: boolean };
    if (health.ok) {
      checks.push({
        id: "broker",
        level: "ok",
        title: "本机 broker",
        detail: `127.0.0.1:${session.port} · 会话 ${session.id}`,
      });
    } else {
      checks.push({
        id: "broker",
        level: "fail",
        title: "本机 broker",
        detail: "健康检查未通过",
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "broker 不可用";
    const hint = /扩展/.test(message) ? message : `${message}。用 VS Code / Cursor 打开工作区并激活扩展。`;
    checks.push({
      id: "broker",
      level: "warn",
      title: "本机 broker",
      detail: hint,
    });
  }

  const hint = readHelperHint(root);
  if (!hint) {
    checks.push({
      id: "helper",
      level: "warn",
      title: "Mac 助手",
      detail: "未发现 .controlplane/helper.json。Linux 上这是预期；屏幕录制 / 辅助功能要在 Mac 签名助手上授权。",
    });
  } else {
    const auth = await probeHelperAuth(root);
    if (auth.state === "ready") {
      checks.push({
        id: "helper",
        level: "ok",
        title: "Mac 助手",
        detail: `在线 · 127.0.0.1:${hint.port} · 屏幕录制 ${auth.screenRecording} · 辅助功能 ${auth.accessibility}`,
      });
    } else if (auth.state === "helper_offline") {
      checks.push({
        id: "helper",
        level: "warn",
        title: "Mac 助手",
        detail: `有 helper.json，但 127.0.0.1:${hint.port} 连不上`,
      });
    } else {
      checks.push({
        id: "helper",
        level: "warn",
        title: "Mac 助手",
        detail: `在线，授权态 ${auth.state}（屏幕 ${auth.screenRecording}，辅助功能 ${auth.accessibility}）`,
      });
    }
  }

  const discovery = discoverCapabilities(process.env.SKILLHUB_HOME);
  const registry = discovery.candidates[0];
  checks.push({
    id: "skillhub-discovery",
    level: "warn",
    title: "集团能力发现（只读）",
    detail: registry
      ? `${registry.status} · ${registry.source} · 未执行能力连接验证`
      : discovery.missing.join("; "),
  });

  const ok = checks.every((check) => check.level !== "fail");
  return { workspace: root, checks, ok };
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines = [`本机控制面 · doctor`, `工作区  ${report.workspace}`, ""];
  for (const check of report.checks) {
    const mark = check.level === "ok" ? "OK" : check.level === "warn" ? "WARN" : "FAIL";
    lines.push(`[${mark}] ${check.title}`);
    lines.push(`      ${check.detail}`);
  }
  lines.push("");
  lines.push(report.ok ? "核心检查通过。" : "有必须处理的失败项。");
  return lines.join("\n");
}
