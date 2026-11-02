import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import * as vscode from "vscode";
import { brokerRequest } from "../broker/client.js";
import { clearCurrent, writeCurrent } from "../broker/session.js";
import type { AuthStatus, TimelineEvent } from "../contract/timeline.js";
import { AUTH_PLACEHOLDER } from "../contract/timeline.js";
import { formatDoctorReport, runDoctor } from "../doctor/report.js";
import { requestHelperAuth } from "../helper/client.js";
import { scaffoldWorkspace } from "../init/scaffold.js";
import { buildWitnessFrame } from "../witness/render.js";
import { buildControlPlaneMcpDefinition, canRegisterMcpProvider, mcpEntryFromExtension } from "./mcpProvider.js";
import { timelineHtml } from "./timelineHtml.js";

interface LiveSession {
  id: string;
  host: "127.0.0.1";
  port: number;
  token: string;
}

let child: ChildProcess | undefined;
let helperChild: ChildProcess | undefined;
let session: LiveSession | undefined;
let starting = false;
let provider: TimelineProvider | undefined;
let statusBar: vscode.StatusBarItem | undefined;
let lastAuth: AuthStatus = AUTH_PLACEHOLDER;
const mcpChanged = new vscode.EventEmitter<void>();

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("本机控制面");
  context.subscriptions.push(mcpChanged);
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.command = "controlplane.runDoctor";
  statusBar.text = "$(debug-disconnect) 本机控制面";
  statusBar.tooltip = "运行本机控制面 doctor";
  statusBar.show();
  provider = new TimelineProvider(context.extensionUri, () => session, (auth) => {
    lastAuth = auth;
    refreshStatusBar();
  });
  context.subscriptions.push(output, provider, statusBar);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("controlplane.timeline", provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("controlplane.refreshTimeline", () => provider?.refresh()),
    vscode.commands.registerCommand("controlplane.copyMcpConfig", async () => {
      await copyClientConfig(context.extensionPath);
    }),
    vscode.commands.registerCommand("controlplane.showStatus", async () => {
      await showBrokerStatus(output);
    }),
    vscode.commands.registerCommand("controlplane.runDoctor", async () => {
      await runDoctorCommand(output);
    }),
    vscode.commands.registerCommand("controlplane.openWitness", async () => {
      await openWitness(context.extensionPath);
    }),
    vscode.commands.registerCommand("controlplane.exportJournal", async () => {
      await exportJournal(context.extensionPath);
    }),
    vscode.commands.registerCommand("controlplane.initWorkspace", async () => {
      await initWorkspaceCommands();
    }),
    vscode.commands.registerCommand("controlplane.startDemoHelper", async () => {
      await startDemoHelper(context.extensionPath, output);
    }),
    vscode.commands.registerCommand("controlplane.stopDemoHelper", async () => {
      stopDemoHelper();
      void vscode.window.showInformationMessage("演示助手已停止。");
      void provider?.refresh();
    }),
    vscode.commands.registerCommand("controlplane.openAuthHelp", async () => {
      await openAuthHelp();
    }),
  );

  registerMcpProvider(context, mcpChanged);

  const boot = (): void => {
    mcpChanged.fire();
    void ensureBroker(context.extensionPath, output);
  };
  boot();
  refreshStatusBar();
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(boot));
  context.subscriptions.push(vscode.workspace.onDidGrantWorkspaceTrust(boot));
  context.subscriptions.push(
    vscode.window.onDidChangeWindowState((state) => {
      const folder = workspacePath();
      if (state.focused && folder && session) writeCurrent(folder, session.id);
    }),
  );
  context.subscriptions.push(
    vscode.window.onDidChangeVisibleTextEditors(() => {
      void pushSnapshot(output);
    }),
    vscode.languages.onDidChangeDiagnostics(() => {
      void pushSnapshot(output);
    }),
  );
  context.subscriptions.push({
    dispose: () => {
      stopDemoHelper();
      stopBroker();
    },
  });
}

export function deactivate(): void {
  provider?.dispose();
  stopDemoHelper();
  stopBroker();
}

/** VS Code 里 process.execPath 是 Electron，不是 Node。broker 要交给 PATH 上的 node。 */
function nodeBinary(): string {
  return process.versions.electron ? "node" : process.execPath;
}

function workspacePath(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function packagedFile(extensionPath: string, ...parts: string[]): string | undefined {
  const inside = path.join(extensionPath, "dist", ...parts);
  if (fs.existsSync(inside)) return inside;
  const sibling = path.resolve(extensionPath, "..", "dist", ...parts);
  if (fs.existsSync(sibling)) return sibling;
  return undefined;
}

async function copyClientConfig(extensionPath: string): Promise<void> {
  const folder = workspacePath();
  if (!folder) {
    void vscode.window.showErrorMessage("先打开一个工作区文件夹。");
    return;
  }
  const mcp = packagedFile(extensionPath, "mcp", "stdio.js");
  if (!mcp) {
    void vscode.window.showErrorMessage("找不到 MCP 入口。先在仓库根目录运行 npm run compile。");
    return;
  }
  const choice = await vscode.window.showQuickPick(
    [
      { label: "Cursor mcp.json", description: "JSON", id: "cursor" as const },
      { label: "Codex config.toml", description: "TOML", id: "codex" as const },
    ],
    { title: "复制哪一种 MCP 配置" },
  );
  if (!choice) return;
  if (choice.id === "cursor") {
    const snippet = {
      mcpServers: {
        controlplane: {
          command: "node",
          args: [mcp],
          env: {
            CONTROLPLANE_WORKSPACE: folder,
          },
        },
      },
    };
    await vscode.env.clipboard.writeText(JSON.stringify(snippet, null, 2));
    void vscode.window.showInformationMessage("已复制 Cursor MCP 配置，粘贴进 mcp.json。");
    return;
  }
  const toml = [
    "[mcp_servers.controlplane]",
    'command = "node"',
    `args = [${JSON.stringify(mcp)}]`,
    `env = { CONTROLPLANE_WORKSPACE = ${JSON.stringify(folder)} }`,
    "",
  ].join("\n");
  await vscode.env.clipboard.writeText(toml);
  void vscode.window.showInformationMessage("已复制 Codex MCP 配置，粘贴进 ~/.codex/config.toml 或项目 .codex/config.toml。");
}

async function initWorkspaceCommands(): Promise<void> {
  const folder = workspacePath();
  if (!folder) {
    void vscode.window.showErrorMessage("先打开一个工作区文件夹。");
    return;
  }
  const target = path.join(folder, ".controlplane", "commands.json");
  let force = false;
  if (fs.existsSync(target)) {
    const choice = await vscode.window.showWarningMessage(
      "工作区已有 .controlplane/commands.json",
      { modal: true },
      "覆盖",
    );
    if (choice !== "覆盖") return;
    force = true;
  }
  try {
    const result = scaffoldWorkspace(folder, { force });
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(result.path));
    await vscode.window.showTextDocument(doc, { preview: false });
    void vscode.window.showInformationMessage(
      `已写入 ${Object.keys(result.commands).length} 条声明命令。terminal / verify 只跑这些 id。`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "初始化失败";
    void vscode.window.showErrorMessage(message);
  }
}

async function exportJournal(extensionPath: string): Promise<void> {
  const folder = workspacePath();
  if (!folder) {
    void vscode.window.showErrorMessage("先打开一个工作区文件夹。");
    return;
  }
  const journal = packagedFile(extensionPath, "journal", "cli.js");
  if (!journal) {
    void vscode.window.showErrorMessage("找不到过程日志入口。先在仓库根目录运行 npm run compile。");
    return;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const relative = path.join(".controlplane", "journals", `${stamp}.md`);
  const absolute = path.join(folder, relative);
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(nodeBinary(), [journal, "--workspace", folder, "--out", absolute], {
        cwd: folder,
        shell: false,
      });
      child.on("error", reject);
      child.on("exit", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`导出退出码 ${code ?? "未知"}`));
      });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "导出失败";
    void vscode.window.showErrorMessage(message);
    return;
  }
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(absolute));
  await vscode.window.showTextDocument(doc, { preview: false });
  void vscode.window.showInformationMessage(`已导出编程过程日志到 ${relative}`);
}

function refreshStatusBar(): void {
  if (!statusBar) return;
  const folder = workspacePath();
  if (!folder) {
    statusBar.text = "$(debug-disconnect) 本机控制面";
    statusBar.tooltip = "打开工作区后启动 broker。点击运行 doctor。";
    return;
  }
  if (!vscode.workspace.isTrusted) {
    statusBar.text = "$(shield) 本机控制面";
    statusBar.tooltip = "工作区未信任。信任后才会启动 broker 与 MCP。";
    return;
  }
  if (!session) {
    statusBar.text = "$(warning) 本机控制面";
    statusBar.tooltip = "broker 还没起来。点击运行 doctor。";
    return;
  }
  const auth = lastAuth;
  const authShort =
    auth.state === "ready"
      ? "授权就绪"
      : auth.state === "placeholder"
        ? "授权占位"
        : auth.state === "helper_offline"
          ? "助手离线"
          : `授权 ${auth.state}`;
  statusBar.text = `$(debug-start) 控制面 :${session.port}`;
  statusBar.tooltip = `broker 127.0.0.1:${session.port} · ${authShort} · 点击运行 doctor`;
}

async function showBrokerStatus(output: vscode.OutputChannel): Promise<void> {
  const folder = workspacePath();
  if (!folder) {
    void vscode.window.showWarningMessage("没有打开工作区。");
    return;
  }
  if (!session) {
    void vscode.window.showWarningMessage("broker 还没起来。看「本机控制面」输出通道。");
    output.show(true);
    refreshStatusBar();
    return;
  }
  try {
    const health = (await brokerRequest(session, "GET", "/v1/health", undefined, 3_000)) as { ok?: boolean };
    const authBody = (await brokerRequest(session, "GET", "/v1/auth", undefined, 3_000)) as { auth?: AuthStatus };
    if (authBody.auth) lastAuth = authBody.auth;
    refreshStatusBar();
    const message = health.ok
      ? `broker 正常 · 127.0.0.1:${session.port} · 会话 ${session.id} · 授权 ${lastAuth.state}`
      : `broker 应答异常 · 127.0.0.1:${session.port}`;
    void vscode.window.showInformationMessage(message);
    output.appendLine(message);
  } catch (error) {
    const message = error instanceof Error ? error.message : "无法探测 broker";
    void vscode.window.showErrorMessage(message);
    refreshStatusBar();
  }
}

async function runDoctorCommand(output: vscode.OutputChannel): Promise<void> {
  const folder = workspacePath();
  if (!folder) {
    void vscode.window.showWarningMessage("没有打开工作区。");
    return;
  }
  try {
    const report = await runDoctor(folder);
    const text = formatDoctorReport(report);
    output.clear();
    output.appendLine(text);
    output.show(true);
    refreshStatusBar();
    void provider?.refresh();
    if (report.ok) {
      void vscode.window.showInformationMessage("本机控制面 doctor：核心检查通过。详情见输出通道。");
    } else {
      void vscode.window.showWarningMessage("本机控制面 doctor：有必须处理的失败项。详情见输出通道。");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "doctor 失败";
    void vscode.window.showErrorMessage(message);
  }
}

async function startDemoHelper(extensionPath: string, output: vscode.OutputChannel): Promise<void> {
  const folder = workspacePath();
  if (!folder) {
    void vscode.window.showErrorMessage("先打开一个工作区文件夹。");
    return;
  }
  if (helperChild && !helperChild.killed) {
    void vscode.window.showInformationMessage("演示助手已在跑。可用「停止演示助手」关掉。");
    return;
  }
  const cli = packagedFile(extensionPath, "helper", "cli.js");
  if (!cli) {
    void vscode.window.showErrorMessage("找不到助手入口。先在仓库根目录运行 npm run compile。");
    return;
  }
  const authPick = await vscode.window.showQuickPick(
    [
      { label: "ready", description: "两项都算已允许（仅演示）" },
      { label: "missing_screen", description: "缺屏幕录制" },
      { label: "missing_accessibility", description: "缺辅助功能" },
      { label: "missing_both", description: "两项都缺" },
      { label: "placeholder", description: "占位" },
    ],
    { title: "演示助手授权态（不是系统 TCC）" },
  );
  if (!authPick) return;

  const proc = spawn(
    nodeBinary(),
    [cli, "--workspace", folder, "--auth", authPick.label, "--ui"],
    { cwd: folder, shell: false, stdio: ["ignore", "pipe", "pipe"], env: process.env },
  );
  helperChild = proc;
  proc.stderr.on("data", (chunk: Buffer) => output.append(chunk.toString("utf8")));
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("演示助手启动超时"));
    }, 8_000);
    let buffer = "";
    proc.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const newline = buffer.indexOf("\n");
      if (newline < 0 || settled) return;
      try {
        const message = JSON.parse(buffer.slice(0, newline)) as {
          ready?: boolean;
          port?: number;
          panelUrl?: string | null;
          note?: string;
        };
        if (message.ready) {
          settled = true;
          clearTimeout(timer);
          const panel = message.panelUrl ? ` · 面板 ${message.panelUrl}` : "";
          output.appendLine(`演示助手已在 127.0.0.1:${message.port}${panel}`);
          if (message.note) output.appendLine(message.note);
          void vscode.window.showInformationMessage(
            `演示助手已启动（${authPick.label}）。侧边栏授权条会刷新；这不是系统 TCC。`,
          );
          void provider?.refresh();
          resolve();
        }
      } catch {
        settled = true;
        clearTimeout(timer);
        reject(new Error("演示助手启动应答无法解析"));
      }
    });
    proc.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    proc.on("exit", (code) => {
      helperChild = undefined;
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`演示助手退出，码 ${code ?? "未知"}`));
      }
    });
  }).catch((error: unknown) => {
    stopDemoHelper();
    const message = error instanceof Error ? error.message : "演示助手启动失败";
    void vscode.window.showErrorMessage(message);
  });
}

function stopDemoHelper(): void {
  const proc = helperChild;
  helperChild = undefined;
  if (!proc || proc.killed) return;
  proc.kill("SIGTERM");
}

async function openWitness(extensionPath: string): Promise<void> {
  const folder = workspacePath();
  if (!folder) {
    void vscode.window.showErrorMessage("先打开一个工作区文件夹。");
    return;
  }
  if (!session) {
    void vscode.window.showWarningMessage("broker 还没起来，见证会空等。先等扩展激活完成。");
  }
  const witness = packagedFile(extensionPath, "witness", "watch.js");
  if (!witness) {
    void vscode.window.showErrorMessage("找不到见证入口。先在仓库根目录运行 npm run compile。");
    return;
  }
  const term = vscode.window.createTerminal({
    name: "本机控制面见证",
    cwd: folder,
  });
  term.show();
  const quotedWitness = JSON.stringify(witness);
  const quotedFolder = JSON.stringify(folder);
  term.sendText(`${nodeBinary()} ${quotedWitness} --workspace ${quotedFolder} --ui --open`);
}

function registerMcpProvider(context: vscode.ExtensionContext, changed: vscode.EventEmitter<void>): void {
  if (!canRegisterMcpProvider()) {
    return;
  }
  context.subscriptions.push(
    vscode.lm.registerMcpServerDefinitionProvider("controlplane", {
      onDidChangeMcpServerDefinitions: changed.event,
      provideMcpServerDefinitions: async () => {
        if (!vscode.workspace.isTrusted) return [];
        const folder = workspacePath();
        const mcp = mcpEntryFromExtension(context.extensionPath);
        if (!folder || !mcp) return [];
        return [
          buildControlPlaneMcpDefinition({
            label: "本机控制面",
            mcpEntry: mcp,
            workspace: folder,
            version: context.extension.packageJSON?.version ?? "0.1.9",
          }),
        ];
      },
      resolveMcpServerDefinition: async (server) => {
        if (!vscode.workspace.isTrusted) {
          void vscode.window.showWarningMessage("先信任工作区，再启动本机控制面 MCP。");
          return undefined;
        }
        if (!session) {
          void vscode.window.showWarningMessage("broker 还在启动或未起来。可先看状态栏，稍后再调工具。");
        }
        return server;
      },
    }),
  );
}

async function openAuthHelp(): Promise<void> {
  const folder = workspacePath();
  if (!folder) {
    void vscode.window.showWarningMessage("没有打开工作区。");
    return;
  }
  const whichPick = await vscode.window.showQuickPick(
    [
      { label: "both", description: "屏幕录制 + 辅助功能" },
      { label: "screen", description: "只开屏幕录制设置" },
      { label: "accessibility", description: "只开辅助功能设置" },
    ],
    { title: "引导哪一项授权" },
  );
  if (!whichPick) return;
  const which = whichPick.label as "screen" | "accessibility" | "both";
  try {
    const result = await requestHelperAuth(folder, which);
    for (const url of result.openUrls) {
      await vscode.env.openExternal(vscode.Uri.parse(url));
    }
    void vscode.window.showInformationMessage(result.note || "已打开系统设置。");
    void provider?.refresh();
  } catch (error) {
    const message = error instanceof Error ? error.message : "无法请求授权引导";
    const fallback =
      which === "accessibility"
        ? ["x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"]
        : which === "screen"
          ? ["x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"]
          : [
              "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
              "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
            ];
    if (process.platform === "darwin") {
      for (const url of fallback) await vscode.env.openExternal(vscode.Uri.parse(url));
    }
    void vscode.window.showWarningMessage(
      `${message}。Linux 上请用「启动演示助手」；Mac 上请先装签名助手，或手动打开系统设置 › 隐私与安全性。`,
    );
  }
}

async function ensureBroker(extensionPath: string, output: vscode.OutputChannel): Promise<void> {
  if (session || starting) return;
  const folder = workspacePath();
  if (!folder) {
    provider?.setNote("没有打开文件夹。打开一个工作区后，扩展会在 127.0.0.1 启动 broker。");
    output.appendLine("没有打开文件夹，broker 不启动。");
    return;
  }
  if (!vscode.workspace.isTrusted) {
    provider?.setNote("工作区未信任。信任这个文件夹后，扩展才会在 127.0.0.1 启动 broker，并挂上本机 MCP。");
    output.appendLine("工作区未信任，broker 不启动。");
    refreshStatusBar();
    return;
  }
  starting = true;
  try {
    session = await launchBroker(folder, extensionPath, output);
    output.appendLine(`broker 已在 127.0.0.1:${session.port} 监听，会话 ${session.id}`);
    provider?.setNote(null);
    provider?.startPolling();
    refreshStatusBar();
    await pushSnapshot(output);
  } catch (error) {
    const message = error instanceof Error ? error.message : "broker 启动失败";
    output.appendLine(message);
    provider?.setNote(`broker 没有启动。${message}`);
    refreshStatusBar();
    void vscode.window.showErrorMessage(`本机控制面 broker 没有启动：${message}`);
  } finally {
    starting = false;
  }
}

function launchBroker(workspace: string, extensionPath: string, output: vscode.OutputChannel): Promise<LiveSession> {
  const token = crypto.randomBytes(32).toString("hex");
  const id = crypto.randomBytes(8).toString("hex");
  const packaged = path.join(extensionPath, "dist", "broker", "cli.js");
  const fromRepo = path.resolve(extensionPath, "..", "dist", "broker", "cli.js");
  const cli = fs.existsSync(packaged) ? packaged : fromRepo;
  if (!fs.existsSync(cli)) {
    return Promise.reject(new Error(`找不到 broker：${packaged}。先在仓库根目录运行 npm run compile。`));
  }
  const proc = spawn(nodeBinary(), [cli, "--workspace", workspace, "--token", token, "--session", id], {
    cwd: workspace,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });
  child = proc;
  proc.stderr.on("data", (chunk: Buffer) => output.append(chunk.toString("utf8")));
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      proc.kill("SIGTERM");
      reject(error);
    };
    timer = setTimeout(() => fail(new Error("broker 启动超时")), 8_000);
    let buffer = "";
    proc.stdout?.on("data", (chunk: Buffer) => {
      if (settled) return;
      buffer += chunk.toString("utf8");
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      try {
        const message = JSON.parse(buffer.slice(0, newline)) as { ready?: boolean; host?: string; port?: number };
        if (message.ready === true && message.host === "127.0.0.1" && typeof message.port === "number") {
          settled = true;
          clearTimeout(timer);
          resolve({ id, host: "127.0.0.1", port: message.port, token });
          return;
        }
        fail(new Error("broker 没有返回本机端口"));
      } catch {
        fail(new Error("broker 的启动应答无法解析"));
      }
    });
    proc.on("error", (error) => fail(error));
    proc.on("exit", (code) => fail(new Error(`broker 退出，码 ${code ?? "未知"}`)));
  });
}

function stopBroker(): void {
  const current = session;
  const folder = workspacePath();
  session = undefined;
  lastAuth = AUTH_PLACEHOLDER;
  refreshStatusBar();
  if (folder && current) {
    try {
      clearCurrent(folder, current.id);
    } catch {
      // 窗口已经关掉时，清指针失败不用再提示。
    }
  }
  const proc = child;
  child = undefined;
  if (!proc || proc.killed) return;
  proc.kill("SIGTERM");
}

async function pushSnapshot(output: vscode.OutputChannel): Promise<void> {
  const folder = workspacePath();
  if (!folder || !session) return;
  const editors: string[] = [];
  for (const editor of vscode.window.visibleTextEditors) {
    if (editor.document.uri.scheme !== "file") continue;
    const relative = path.relative(folder, editor.document.uri.fsPath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) continue;
    editors.push((relative.length === 0 ? path.basename(editor.document.uri.fsPath) : relative).slice(0, 180));
    if (editors.length >= 30) break;
  }
  const diagnostics = { error: 0, warning: 0, info: 0, hint: 0 };
  for (const [, items] of vscode.languages.getDiagnostics()) {
    for (const item of items) {
      if (item.severity === vscode.DiagnosticSeverity.Error) diagnostics.error += 1;
      else if (item.severity === vscode.DiagnosticSeverity.Warning) diagnostics.warning += 1;
      else if (item.severity === vscode.DiagnosticSeverity.Information) diagnostics.info += 1;
      else diagnostics.hint += 1;
    }
  }
  try {
    await brokerRequest(session, "POST", "/v1/snapshot", { editors, diagnostics }, 5_000);
  } catch (error) {
    const message = error instanceof Error ? error.message : "快照推送失败";
    output.appendLine(message);
  }
}

class TimelineProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private note: string | null = null;
  private polling = false;
  private inflight = false;
  private authTick = 0;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly currentSession: () => LiveSession | undefined,
    private readonly onAuth: (auth: AuthStatus) => void,
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };
    const nonce = crypto.randomBytes(16).toString("hex");
    webviewView.webview.html = timelineHtml(nonce);
    webviewView.webview.onDidReceiveMessage((message: { type?: string }) => {
      if (message?.type === "ready") void this.refresh();
    });
    webviewView.onDidDispose(() => {
      this.view = undefined;
    });
    void this.refresh();
  }

  setNote(note: string | null): void {
    this.note = note;
    void this.refresh();
  }

  startPolling(): void {
    if (this.polling) return;
    this.polling = true;
    this.timer = setInterval(() => {
      void this.refresh();
    }, 1000);
    void this.refresh();
  }

  async refresh(): Promise<void> {
    if (!this.view || this.inflight) return;
    this.inflight = true;
    try {
      const current = this.currentSession();
      if (!current) {
        this.view.webview.postMessage({
          type: "timeline",
          events: [],
          note: this.note,
          auth: AUTH_PLACEHOLDER,
        });
        return;
      }
      const body = (await brokerRequest(current, "GET", "/v1/timeline", undefined, 5_000)) as {
        events?: TimelineEvent[];
      };
      const events = Array.isArray(body.events) ? body.events : [];
      const now = buildWitnessFrame(events, {
        sessionId: current.id,
        host: current.host,
        port: current.port,
      });
      let auth = now.auth;
      this.authTick += 1;
      if (this.authTick === 1 || this.authTick % 3 === 0) {
        try {
          const authBody = (await brokerRequest(current, "GET", "/v1/auth", undefined, 3_000)) as {
            auth?: AuthStatus;
          };
          if (authBody.auth) {
            auth = authBody.auth;
            now.auth = auth;
            now.authLine = `${auth.state}（屏幕录制 ${auth.screenRecording}，辅助功能 ${auth.accessibility}）`;
          }
        } catch {
          // 授权探测失败时继续用时间线上的值。
        }
      }
      this.onAuth(auth);
      this.view.webview.postMessage({
        type: "timeline",
        events,
        note: this.note,
        now,
        auth,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "读时间线失败";
      this.view?.webview.postMessage({ type: "timeline", note: message });
    } finally {
      this.inflight = false;
    }
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.polling = false;
  }
}
