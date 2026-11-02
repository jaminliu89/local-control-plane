#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const version = pkg.version;
const releaseRoot = path.join(root, "release");
const stageName = `local-control-plane-${version}`;
const stage = path.join(releaseRoot, stageName);
const vsixName = `local-control-plane-${version}.vsix`;
const archive = path.join(releaseRoot, `${stageName}.tar.gz`);

function run(command, args, opts = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: false,
    ...opts,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} 失败`);
  }
}

function copyDir(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true });
}

function resolveProfile(argv) {
  const flag = argv.indexOf("--profile");
  if (flag >= 0) {
    const value = argv[flag + 1];
    if (value === "full" || value === "lite") return value;
    throw new Error("--profile 只能是 lite 或 full");
  }
  return argv.includes("--full") ? "full" : "lite";
}

function findMacApp() {
  const candidates = [
    process.env.CONTROLPLANE_MAC_APP,
    path.join(releaseRoot, "artifacts", "ControlPlaneHelper.app"),
    path.join(root, "mac-helper", "dist", "ControlPlaneHelper.app"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) return candidate;
  }
  return null;
}

function maybeBuildMacApp() {
  if (process.platform !== "darwin") return null;
  const script = path.join(root, "mac-helper", "scripts", "build-app.sh");
  if (!fs.existsSync(script)) return null;
  console.log("在 macOS 上构建 ControlPlaneHelper.app …");
  run("bash", [script]);
  return findMacApp();
}

function writeInstallMd(target, profile, hasMacApp) {
  const macSection = hasMacApp
    ? `## Mac 菜单栏助手

本包含 \`ControlPlaneHelper.app\`（Bundle ID \`local.ide-control.helper\`）。
\`install.sh\` 在 macOS 上会安装到 \`~/Applications\`。首次打开后到系统设置授予屏幕录制与辅助功能。
`
    : `## Mac 菜单栏助手

当前是 **lite** 包：含 Swift 源码与 \`mac-helper/scripts/build-app.sh\`，**不含**已构建 \`.app\`。

在 Mac 真机：

\`\`\`bash
cd mac-helper
./scripts/build-app.sh
# 可选签名：CONTROLPLANE_CODESIGN_IDENTITY="Developer ID Application: …" ./scripts/build-app.sh
cd ..
npm run pack:full
# 或：npm run pack && npm run compose:full -- --app mac-helper/dist/ControlPlaneHelper.app
\`\`\`
`;

  const text = `# 安装本机控制面 ${version}（${profile}）

## 分发包里有什么

- \`local-control-plane-${version}.vsix\`：Cursor / VS Code 扩展（含本机 broker）
- \`dist/\`：CLI 运行时（mcp / witness / broker / journal / init / doctor / helper）
- \`dsh-plugin/\`：DeepSeek Harness Cordis 插件
- \`mac-helper/\`：Mac 菜单栏助手源码与构建脚本
${hasMacApp ? "- `ControlPlaneHelper.app`：菜单栏助手（完整包）\n" : ""}- \`install.sh\` / \`uninstall.sh\`

这一包是给本机开发者装的。云端 Agent 用不上屏幕录制和辅助功能。

${macSection}
## 一键安装

\`\`\`bash
tar -xzf local-control-plane-${version}${profile === "full" ? "-full" : ""}.tar.gz
cd local-control-plane-${version}
./install.sh
\`\`\`

\`install.sh\` 会：

1. 检查 Node.js >= 18
2. 优先用 \`cursor\`，否则 \`code\`，安装 VSIX（可用 \`CONTROLPLANE_EDITOR=code\` 指定）
3. 把 CLI 装到 \`\$HOME/.local/bin/controlplane-*\`
4. 若在 macOS 且包内有 \`.app\`，拷到 \`~/Applications/ControlPlaneHelper.app\`

自定义前缀：

\`\`\`bash
CONTROLPLANE_PREFIX=/opt/controlplane ./install.sh
\`\`\`

## 装完做什么

1. 打开并**信任**工作区
2. 命令面板：「本机控制面: 初始化工作区命令」
3. 命令面板：「本机控制面: 运行 doctor 自检」
4. Cursor / 新版 VS Code 会经扩展自动挂 MCP；Codex 用「复制 MCP 配置」
5. Linux 演示助手：\`controlplane-helper --workspace <路径> --auth ready --ui\`
6. Mac：打开 \`ControlPlaneHelper.app\`（或扩展「启动演示助手」仅 Linux 演示协议）

## 卸载

\`\`\`bash
./uninstall.sh
\`\`\`
`;
  fs.writeFileSync(target, text);
}

function main() {
  const profile = resolveProfile(process.argv.slice(2));
  fs.mkdirSync(releaseRoot, { recursive: true });
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });

  console.log(`打包 ${stageName}（profile=${profile}）…`);
  run("npm", ["test"]);
  run("npm", ["run", "package:vsix"]);

  const vsixSrc = path.join(root, vsixName);
  if (!fs.existsSync(vsixSrc)) {
    throw new Error(`找不到 ${vsixName}，package:vsix 没有产出`);
  }

  let macApp = findMacApp();
  if (profile === "full" && !macApp) {
    macApp = maybeBuildMacApp();
  }
  if (profile === "full" && !macApp) {
    throw new Error(
      "完整包需要 ControlPlaneHelper.app。在 Mac 上运行 mac-helper/scripts/build-app.sh，或设置 CONTROLPLANE_MAC_APP，或先 npm run pack 再用 npm run compose:full。",
    );
  }

  fs.copyFileSync(vsixSrc, path.join(stage, vsixName));
  fs.writeFileSync(path.join(stage, "VERSION"), `${version}\n`);
  fs.writeFileSync(path.join(stage, "PROFILE"), `${profile}\n`);
  writeInstallMd(path.join(stage, "INSTALL.md"), profile, Boolean(macApp));
  fs.copyFileSync(path.join(root, "README.md"), path.join(stage, "README.md"));
  fs.copyFileSync(path.join(root, "scripts", "install.sh"), path.join(stage, "install.sh"));
  fs.copyFileSync(path.join(root, "scripts", "uninstall.sh"), path.join(stage, "uninstall.sh"));
  fs.chmodSync(path.join(stage, "install.sh"), 0o755);
  fs.chmodSync(path.join(stage, "uninstall.sh"), 0o755);

  copyDir(path.join(root, "dist"), path.join(stage, "dist"));
  fs.rmSync(path.join(stage, "dist", "test"), { recursive: true, force: true });
  fs.rmSync(path.join(stage, "dist", "extension"), { recursive: true, force: true });
  copyDir(path.join(root, "dsh-plugin"), path.join(stage, "dsh-plugin"));
  copyDir(path.join(root, "mac-helper"), path.join(stage, "mac-helper"));
  // 分发包里不要嵌套本机 build 缓存
  fs.rmSync(path.join(stage, "mac-helper", ".build"), { recursive: true, force: true });
  fs.rmSync(path.join(stage, "mac-helper", "dist"), { recursive: true, force: true });
  if (fs.existsSync(path.join(root, "docs"))) {
    copyDir(path.join(root, "docs"), path.join(stage, "docs"));
  }

  if (macApp) {
    copyDir(macApp, path.join(stage, "ControlPlaneHelper.app"));
  }

  const outArchive =
    profile === "full"
      ? path.join(releaseRoot, `${stageName}-full.tar.gz`)
      : archive;

  const manifest = {
    name: "local-control-plane",
    version,
    profile,
    createdAt: new Date().toISOString(),
    archive: path.basename(outArchive),
    vsix: vsixName,
    macApp: macApp ? "ControlPlaneHelper.app" : null,
    includes: [
      "vsix",
      "dist-cli",
      "dsh-plugin",
      "mac-helper-source",
      "install.sh",
      ...(macApp ? ["ControlPlaneHelper.app"] : []),
    ],
    excludes: [
      ...(macApp ? [] : ["ControlPlaneHelper.app"]),
      "node_modules",
      "tests",
    ],
  };
  fs.writeFileSync(path.join(stage, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  fs.rmSync(outArchive, { force: true });
  run("tar", ["-czf", outArchive, "-C", releaseRoot, stageName]);

  const latestName = profile === "full" ? "latest-full.json" : "latest.json";
  fs.writeFileSync(path.join(releaseRoot, latestName), `${JSON.stringify(manifest, null, 2)}\n`);

  const size = fs.statSync(outArchive).size;
  console.log(`完成：${outArchive}（${Math.round(size / 1024)} KB）`);
  console.log(`目录：${stage}`);
  if (profile === "lite") {
    console.log("完整包：在 Mac 构建 .app 后执行 npm run pack:full 或 npm run compose:full");
  }
}

main();
