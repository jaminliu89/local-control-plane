#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatDoctorReport, runDoctor } from "./report.js";

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

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(
      [
        "用法: node dist/doctor/cli.js [--workspace <路径>] [--json]",
        "",
        "自检本机控制面：Node、工作区、commands.json、broker、Mac 助手授权。",
        "核心检查通过退出 0；有 FAIL 退出 1。WARN 不算失败。",
        "",
      ].join("\n"),
    );
    return;
  }
  const workspace = workspaceFromArgv(argv);
  const report = await runDoctor(workspace);
  if (argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatDoctorReport(report)}\n`);
  }
  process.exitCode = report.ok ? 0 : 1;
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entry === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "doctor 失败";
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}
