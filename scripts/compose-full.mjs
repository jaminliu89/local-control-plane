#!/usr/bin/env node
/**
 * 把已有的 lite 分发包与真机打好的 ControlPlaneHelper.app 合成完整包。
 * 用法:
 *   node scripts/compose-full.mjs [--lite path/to/lite.tar.gz] [--app path/to/ControlPlaneHelper.app]
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const version = pkg.version;
const releaseRoot = path.join(root, "release");

function argValue(argv, flag) {
  const idx = argv.indexOf(flag);
  if (idx < 0) return undefined;
  const value = argv[idx + 1];
  if (!value || value.startsWith("--")) throw new Error(`缺少 ${flag} 值`);
  return path.resolve(value);
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${command} 失败`);
}

function main() {
  const argv = process.argv.slice(2);
  const lite =
    argValue(argv, "--lite") ?? path.join(releaseRoot, `local-control-plane-${version}.tar.gz`);
  const appCandidates = [
    argValue(argv, "--app"),
    path.join(releaseRoot, "artifacts", "ControlPlaneHelper.app"),
    path.join(root, "mac-helper", "dist", "ControlPlaneHelper.app"),
  ].filter(Boolean);
  const app = appCandidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isDirectory());

  if (!fs.existsSync(lite)) throw new Error(`找不到 lite 包：${lite}。先 npm run pack`);
  if (!app) {
    throw new Error(
      `找不到 ControlPlaneHelper.app（试过：${appCandidates.join(", ")}）\n在 Mac 上跑: cd mac-helper && ./scripts/build-app.sh`,
    );
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lcp-full-"));
  try {
    run("tar", ["-xzf", lite, "-C", tmp]);
    const stageName = `local-control-plane-${version}`;
    const stage = path.join(tmp, stageName);
    if (!fs.existsSync(stage)) throw new Error("lite 包结构不对");

    const destApp = path.join(stage, "ControlPlaneHelper.app");
    fs.rmSync(destApp, { recursive: true, force: true });
    fs.cpSync(app, destApp, { recursive: true });

    const installMd = fs.readFileSync(path.join(stage, "INSTALL.md"), "utf8");
    const macBlurb = `## Mac 菜单栏助手

本完整包含 \`ControlPlaneHelper.app\`（Bundle ID \`local.ide-control.helper\`）。
\`install.sh\` 在 macOS 上会拷到 \`~/Applications\`。首次请在系统设置授予屏幕录制与辅助功能。

`;
    let nextMd = installMd;
    if (installMd.includes("## Mac 菜单栏助手")) {
      nextMd = installMd.replace(/## Mac 菜单栏助手[\s\S]*?(## 一键安装)/, `${macBlurb}$1`);
    } else {
      nextMd = `${installMd.trim()}\n\n${macBlurb}`;
    }
    fs.writeFileSync(path.join(stage, "INSTALL.md"), nextMd);

    const manifestPath = path.join(stage, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.profile = "full";
    manifest.macApp = "ControlPlaneHelper.app";
    manifest.includes = [...new Set([...(manifest.includes ?? []), "ControlPlaneHelper.app"])];
    manifest.excludes = (manifest.excludes ?? []).filter((item) => item !== "signed-mac-app");
    manifest.composedAt = new Date().toISOString();
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    fs.writeFileSync(path.join(stage, "PROFILE"), "full\n");

    fs.mkdirSync(releaseRoot, { recursive: true });
    const archive = path.join(releaseRoot, `local-control-plane-${version}-full.tar.gz`);
    fs.rmSync(archive, { force: true });
    run("tar", ["-czf", archive, "-C", tmp, stageName]);
    fs.writeFileSync(
      path.join(releaseRoot, "latest-full.json"),
      `${JSON.stringify(
        {
          ...manifest,
          archive: path.basename(archive),
        },
        null,
        2,
      )}\n`,
    );
    console.log(`完整包：${archive}（${Math.round(fs.statSync(archive).size / 1024)} KB）`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main();
