# 给其他 Agent 的自部署说明

把本仓库当成「本机 IDE 控制面」安装源。目标机器需要能跑 Node.js ≥ 18；Mac 助手 `.app` 只能在 macOS 上构建。

## 克隆

```bash
git clone https://github.com/jaminliu89/local-control-plane.git
cd local-control-plane
npm ci
npm test
npm run pack
```

仓库地址：https://github.com/jaminliu89/local-control-plane

## 安装到本机（lite）

```bash
tar -xzf release/local-control-plane-*.tar.gz
cd local-control-plane-*
./install.sh
```

`install.sh` 会装 VSIX（优先 `cursor`，否则 `code`）和 `~/.local/bin/controlplane-*`。

## 完整包（含 Mac 菜单栏助手）

在 macOS：

```bash
npm run build:mac-helper
# 可选签名：
# CONTROLPLANE_CODESIGN_IDENTITY="Developer ID Application: …" npm run build:mac-helper
npm run pack:full
# 或跨机：npm run compose:full -- --app mac-helper/dist/ControlPlaneHelper.app
```

装完整包后，macOS 会把 `ControlPlaneHelper.app` 放到 `~/Applications`。

## 工作区侧

1. 用 Cursor / VS Code **打开并信任**目标工作区  
2. 命令面板：「本机控制面: 初始化工作区命令」  
3. 命令面板：「本机控制面: 运行 doctor 自检」  
4. Cursor / 新版 VS Code 经扩展自动挂 MCP；Codex 用「复制 MCP 配置」  
5. Linux 演示助手：`controlplane-helper --workspace <路径> --auth ready --ui`

## Agent 调用约定

- 只交紧凑意图；回执是压缩的，不要把全量日志要回去  
- `terminal` / `verify` 只跑 `.controlplane/commands.json` 里声明过的命令 id  
- 画面与长日志留本机；Mac 助手动词需要签名助手与系统授权  

更完整的形态说明见 [`docs/设计说明.md`](docs/设计说明.md)。
