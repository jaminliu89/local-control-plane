# Mac 菜单栏助手

固定 Bundle ID：`local.ide-control.helper`。系统设置里用户看到的就是它。

## 现在仓库里有什么

- **Swift 实现**：`Sources/ControlPlaneHelper/`（回环 HTTP、授权四态、ScreenCaptureKit 截帧、AX 读树/动作、不抢焦点 NSPanel）
- **打 .app**：`./scripts/build-app.sh`（仅 macOS；可设 `CONTROLPLANE_CODESIGN_IDENTITY` 签名）
- **Linux 演示助手**：`npm run helper -- --workspace <路径> --auth ready --ui`（同协议，不是 TCC 主体）
- TypeScript 契约：[`../src/contract/helper.ts`](../src/contract/helper.ts)

小窗口审美见 [`UI.md`](UI.md)。整体形态见 [`../docs/设计说明.md`](../docs/设计说明.md)。

## 在 Mac 上构建

```bash
cd mac-helper
./scripts/build-app.sh
# 签名（可选）：
# CONTROLPLANE_CODESIGN_IDENTITY="Developer ID Application: Your Name (TEAMID)" ./scripts/build-app.sh
```

产物：`mac-helper/dist/ControlPlaneHelper.app`，并复制到 `release/artifacts/ControlPlaneHelper.app` 供完整包合并。

运行：

```bash
open dist/ControlPlaneHelper.app --args --workspace /绝对路径/工作区 --ui
```

## 协议

助手只听 `127.0.0.1`。Broker / 扩展用窗口 token 呼叫：

| 路由 | 作用 |
| --- | --- |
| `GET /v1/health` | 存活 |
| `GET /v1/auth` | 授权四态 |
| `GET /v1/ui` | 辅助功能树大纲 |
| `POST /v1/capture` | 单窗口帧（本机路径） |
| `POST /v1/ax` | press / set_value / type |
| `POST /v1/timeline` | broker 推送同一条时间线 |
| `POST /v1/auth/request` | 打开系统设置深链 |

## 完整包怎么出

```bash
# 机器 A（任意）：lite
npm run pack

# 机器 B（Mac）：.app
cd mac-helper && ./scripts/build-app.sh

# 再合并：
npm run compose:full -- --app mac-helper/dist/ControlPlaneHelper.app
# → release/local-control-plane-<ver>-full.tar.gz
```

CI：`mac-helper` job 出 `.app`，`compose-full` job 与 lite 合成完整包产物。

## Linux 上怎么演示

```bash
npm run helper -- --workspace /绝对路径/工作区 --auth ready --ui --open
```
