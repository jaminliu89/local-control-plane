#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { authFromFlag, startHelperServer } from "./server.js";

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

function authFlag(argv: string[]): strinc {
  const flag = argv.indexOf("--auth");
  if (flag < 0) return "ready";
  const value = argv[flag + 1];
  if (!value || value.startsWith("--")) throw new Error("缺少 --auth 值");
  return value;
}

function openUrl(url: string): void {
  try {
    const child = spawn("xdg-open", [url], { detached: true, stdio: "ignore" });
    child.unref();
  } catch {
    // 打不开浏览器时只保留打印出的 URL。
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(
      [
        "用法: node dist/helper/cli.js [--workspace <路径>] [--auth ready] [--ui] [--open]",
        "",
        "启动本机演示助手（Linux / 开发）。协议与签名 Mac 菜单栏助手相同，",
        "但不调用 ScreenCaptureKit / AXUIElement，也不假装系统已授权。",
        "",
        "--auth 取值: ready | missing_screen | missing_accessibility | missing_both | placeholder",
        "--ui 再开 Prism 构图小窗口预览（订阅 POST /v1/timeline）。",
        "",
      ].join("\n"),
    );
    return;
  }

  if (process.platform === "darwin" && !argv.includes("--mock")) {
    process.stderr.write(
      "当前是 macOS。签名助手尚未随仓库分发；加 --mock 可跑演示协议进程。\n",
    );
    process.exitCode = 2;
    return;
  }

  const workspace = workspaceFromArgv(argv);
  const auth = authFromFlag(authFlag(argv));
  const ui = argv.includes("--ui");
  const helper = await startHelperServer({ workspace, auth, mode: "mock", ui });

  const ready = {
    ready: true as const,
    mode: helper.mode,
    host: helper.hint.host,
    port: helper.hint.port,
    bundleId: helper.hint.bundleId,
    auth: auth.state,
    panelUrl: helper.panelUrl,
    note: "演示助手。不是 TCC 主体；Mac 签名 .app 见 mac-helper/。",
  };
  process.stdout.write(`${JSON.stringify(ready)}\n`);

  if (ui && helper.panelUrl && argv.includes("--open")) {
    openUrl(helper.panelUrl);
  }

  const stop = (): void => {
    void helper.close().finally(() => process.exit(0));
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entry === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "助手启动失败";
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}
