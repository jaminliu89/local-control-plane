# 本机控制面

一件产品，三个进程。模型只提交紧凑意图，本机执行，回执保持很短。通过就停，长日志不回到模型。

**其他 Agent 要自行部署：** 见 [`AGENT_DEPLOY.md`](AGENT_DEPLOY.md)（克隆 → `npm ci` → `npm run pack` → `./install.sh`）。

Linux 上现在能跑：**VS Code 扩展**、**本机 broker**、**终端见证**。第三个产品进程是签名的 Mac 菜单栏助手，外加一个不抢焦点的小原生窗口；Linux 上用终端见证订阅同一条时间线，先把「看见编程怎么发生」用起来。

任何代码工作都能接。STM32 不是特殊分支，仓库里不带编译器、OpenOCD 或芯片包。要跑什么，写进工作区自己的命令声明。

## 这一刀包括什么

- TypeScript VS Code 扩展。`extension/package.json` 里声明视图和命令，esbuild 打成一个文件，并把 broker 拷进 `extension/dist/`。窗口激活后，扩展在本机拉起 broker。
- Broker 只听 `127.0.0.1`，每个窗口一个随机 token。不对 `0.0.0.0` 监听。
- 五个动词：
  - `observe`：压缩工作区摘要。打开的编辑器、诊断计数、能取到的 git 状态。没有文件正文。
  - `edit`：对工作区内的文件打 unified diff。路径跑出工作区会被拒绝，指向区外的符号链接也会被拒绝。补丁不能改 `.controlplane/`，避免改写命令声明或会话 token。
  - `terminal`：只跑 `.controlplane/commands.json` 里声明过的命令 id。参数是 argv，不经过 shell。不接受任意命令字符串。
  - `verify`：按意图里的验收命令在本机循环，最多 5 轮。某一轮通过就停，只回一张回执。
  - `trace`：只追加一条时间线事件，不跑命令。
- 回执只有退出码、失败名或第一段错误、diff 统计、耗时，verify 再加实际轮次。没有 stdout，没有 stderr，没有完整日志。
- MCP stdio，工具名就是这五个动词。本机 Cursor 和 Codex 走这一条。
- 本机 REST：同一套 `POST /v1/<动词>`，请求里写 `"entry":"rest"`。token 仍是窗口那一把，只听 `127.0.0.1`。
- 侧边栏时间线，以及终端见证 `npm run witness`。两边读同一份事件：谁在下任务、正在做的一步、通过或失败、授权占位。
- 编程过程日志 `npm run journal`：把时间线导出成 Markdown，方便反复对照「为什么改这里、验收为什么过或失败」。
- 工作区初始化 `npm run init`：从 package.json / pytest / go / cargo / cmake / make 收出声明命令，写入 `.controlplane/commands.json`。
- 侧边栏顶部「正在做」与终端见证、将来的 Mac 小窗口读同一份事件。Mac 助手契约在 [`mac-helper/README.md`](mac-helper/README.md) 与 `src/contract/helper.ts`。
- 见证小窗口审美对齐 Prism 指挥台：`npm run witness -- --ui --open` 打开本机 HTML 预览；设计说明在 [`mac-helper/UI.md`](mac-helper/UI.md)。
- Mac 助手动词：`observe_ui`、`capture_window`、`perform_ax`。没有签名助手时明确拒绝，不在 Linux 上假装已获屏幕录制 / 辅助功能授权。小窗口展示四种授权态。
- `doctor` 自检：`npm run doctor` 或命令面板「运行 doctor 自检」。检查 Node、工作区、`commands.json`、broker 健康、Mac 助手授权。状态栏显示端口与授权摘要；侧边栏顶部有授权条，读 `/v1/auth`。
- 演示助手第三进程：`npm run helper -- --workspace <路径> --auth ready --ui`。协议与签名 Mac 助手相同，broker 会把时间线 `POST` 过去。Swift 骨架在 [`mac-helper/`](mac-helper/)。中文设计说明见 [`docs/设计说明.md`](docs/设计说明.md)。
- 扩展向 Cursor / VS Code 注册 MCP 定义提供者（`contributes.mcpServerDefinitionProviders`），信任工作区后自动挂上本机 MCP，不必先手抄配置。未信任的工作区不启 broker。
- 「打开授权设置」走助手 `POST /v1/auth/request`，返回 macOS 系统设置深链。
- 本机分发包：
  - lite：`npm run pack` → `release/local-control-plane-<ver>.tar.gz`（VSIX + CLI + 助手源码）
  - full：Mac 上 `npm run build:mac-helper` 后 `npm run pack:full`，或 `npm run compose:full -- --app <ControlPlaneHelper.app>`
  - CI 会分别产出 lite 与完整包 artifact

DeepSeek Harness 用仓库里的 [`dsh-plugin`](dsh-plugin/README.md) Cordis bundle，挂在已有 tools 之上。云端 Agent 不在范围内。

## 这一刀故意不做的事

- 不写 Swift，不做 Electron，不做菜单栏助手，不画不抢焦点的小原生窗口（用终端见证先顶上）。
- 不在 Linux 上假装能弹出 macOS 的屏幕录制或辅助功能授权。授权字段固定是占位。
- 不内置工具链，也不把某类芯片做成特殊分支。
- 不把 broker 监听地址暴露到回环之外。

## 小原生窗口与终端见证

Mac 上的那个进程要做两件事：一个签名的菜单栏助手，和一个不抢焦点的小原生窗口。窗口不能把键盘焦点从当前应用里抢走。这要靠 macOS 的窗口和菜单栏 API，还要签名。当前开发和测试在 Linux 上，做不出那个窗口，也不该模拟系统授权框。

所以事件契约先定下来。终端见证已经按同一份字段刷新：

```bash
# 先让扩展或 broker 在工作区里起来
npm run witness -- --workspace /绝对路径/你的工作区
# 只看一眼
npm run witness -- --workspace /绝对路径/你的工作区 --once
```

下一刀在 Mac 上让小原生窗口订阅**同一条**时间线，而不是再发明一种消息。

## 时间线事件

类型在 `src/contract/timeline.ts`。broker 把事件追加到：

```text
.controlplane/sessions/<会话 id>.jsonl
```

一行一个 JSON。扩展侧边栏读的是这份序列。将来的小窗口也读它。

小窗口只消费这些字段，并且自己不抢焦点：

- `actor`：谁在下任务，例如 `cursor` 或 `codex`。
- 最新一条 `phase: "started"` 的 `step`：正在做的一步。同一次调用的开始、本地循环和结束共用一个 `runId`。
- 同一 `runId` 上后面的 `phase: "finished"`：这一步结束。
- `receipt.status`：`passed`、`failed` 或 `rejected`。`started` 时 `receipt` 为 `null`。
- `auth`：授权状态。这一刀永远是下面这个占位，不代表已经拿到屏幕录制或辅助功能权限。

```json
{
  "id": "事件 id",
  "time": "2026-11-02T00:00:00.000Z",
  "runId": "同一次调用",
  "entry": "mcp",
  "verb": "verify",
  "actor": "cursor",
  "step": "验收第 1 轮",
  "summary": "test 通过",
  "stepKind": "local_loop",
  "phase": "finished",
  "receipt": {
    "status": "passed",
    "exitCode": 0,
    "diff": { "files": 0, "additions": 0, "deletions": 0 },
    "durationMs": 12,
    "rounds": 1
  },
  "auth": {
    "state": "placeholder",
    "screenRecording": "unknown",
    "accessibility": "unknown"
  }
}
```

`stepKind` 为 `model_turn` 是模型通过入口打来的一轮，`local_loop` 是 verify 在本机重试的一轮。模型那边仍然只看到一张总回执。

## 工作区命令

在工作区放 `.controlplane/commands.json`。值是 argv，不是 shell 字符串。`terminal` 和 `verify` 只接受这里的 id。

```json
{
  "commands": {
    "compile": ["npm", "run", "compile"],
    "test": ["npm", "test"]
  }
}
```

本仓库自己的声明就是上面这两条。没有声明的 id 会被拒绝，进程不会启动。模型如果夹带 `command`、`shell`、`argv` 或 `cwd`，也会被拒绝。

`verify` 的意图类似：

```json
{ "commandIds": ["test"], "maxRounds": 3 }
```

`maxRounds` 缺省是 1，大于 5 会按 5 算。某一轮里的命令全部退出码为 0 就停。

## 编译

需要 Node.js 18 或更新版本。

```bash
npm install
npm run compile
npm test
npm run package:vsix
npm run pack          # lite
# macOS 完整包：
# npm run build:mac-helper && npm run pack:full
# 或跨机合并：npm run compose:full -- --app path/to/ControlPlaneHelper.app
```

`npm run compile` 会用 tsc 编译 broker、MCP、见证、过程日志、初始化、doctor、helper、DeepSeek 插件和测试，再用 esbuild 把扩展打到 `extension/dist/extension.cjs`，并把 broker / MCP / 见证 / 日志 / 初始化 / doctor / helper 入口拷进扩展目录。`npm run smoke` 跑一遍失败→修补→通过→导出日志。`npm run pack` 打 lite 分发包；完整包还要带上 `ControlPlaneHelper.app`。

## DeepSeek Harness

见 [`dsh-plugin/README.md`](dsh-plugin/README.md)。先让扩展把 broker 拉起来，再把 `dsh-plugin` 加进 profile。五个动词与 MCP 相同，时间线入口标成 `dsh`。

## 安装 VSIX

```bash
npm run pack
tar -xzf release/local-control-plane-0.1.11.tar.gz
cd local-control-plane-0.1.11
./install.sh
# 完整包（含 .app）：
# tar -xzf release/local-control-plane-0.1.11-full.tar.gz
```

详情见分发包内 `INSTALL.md`。命令面板里有：初始化工作区命令、复制 MCP 配置、显示 broker 状态、运行 doctor、启动/停止演示助手、打开授权设置、打开终端见证、导出过程日志。Cursor / 新版 VS Code 会经扩展自动发现本机 MCP。

## 用 VS Code 扩展开发宿主打开

1. 用 VS Code 打开这个仓库的根目录。
2. 在终端执行上面的 `npm install`。按 F5 之前如果还没编译，启动任务也会先跑 `npm run compile`。
3. 按 F5，选择「运行本机控制面扩展」。
4. 在新开的扩展开发宿主里打开一个文件夹。扩展会为这个窗口生成 token，并只在 `127.0.0.1` 上启动 broker。扩展宿主里的 `process.execPath` 是 Electron，不是 Node，所以这里会去用 PATH 上的 `node`。编译用的那个 Node 18+ 要在 PATH 里。
5. 活动栏点「本机控制面」，打开「时间线」。还没有调用时，空状态会说明 MCP、五个动词和压缩回执，不是占位文案。

会话文件写在工作区的 `.controlplane/current` 和 `.controlplane/sessions/`，已加入 `.gitignore`。换一个窗口就是另一把 token。MCP 读的是当前这份指针，所以要配到**这个**已打开的文件夹。

扩展没激活、或者 `CONTROLPLANE_WORKSPACE` 指错文件夹时，MCP 会直接说 broker 还没启动，不会去猜一个命令来跑。

## 把 MCP 配给 Cursor

在项目的 `.cursor/mcp.json`，或用户级 MCP 配置里加上。把两个路径换成自己的绝对路径。先让上一节的扩展开发宿主开着，并且打开的就是下面这个工作区。

```json
{
  "mcpServers": {
    "controlplane": {
      "command": "node",
      "args": ["/绝对路径/本仓库/dist/mcp/stdio.js"],
      "env": {
        "CONTROLPLANE_WORKSPACE": "/绝对路径/你的工作区"
      }
    }
  }
}
```

五个工具是 `observe`、`edit`、`terminal`、`verify`、`trace`。描述里写了回执是压缩的，不要把全量日志要回去。工具结果里也不会有 stdout。

## 把 MCP 配给 Codex

写到 `~/.codex/config.toml`。路径同样换成绝对路径，工作区必须是扩展已经打开、broker 已经起来的那个文件夹。

```toml
[mcp_servers.controlplane]
command = "node"
args = ["/绝对路径/本仓库/dist/mcp/stdio.js"]
env = { CONTROLPLANE_WORKSPACE = "/绝对路径/你的工作区" }
```

Codex 和 Cursor 都走这一个 stdio 进程。它自己不监听端口，只按工作区里的会话文件去连 `127.0.0.1`。会话文件里的地址如果不是回环，MCP 会拒绝连接。

## 本机 REST

Broker 本身就是本机 HTTP。只会发 HTTP tool call 的 harness 可以直接打：

```bash
TOKEN=$(node -e "console.log(JSON.parse(require('fs').readFileSync('.controlplane/sessions/'+require('fs').readFileSync('.controlplane/current','utf8').trim()+'.json','utf8')).token)")
PORT=$(node -e "console.log(JSON.parse(require('fs').readFileSync('.controlplane/sessions/'+require('fs').readFileSync('.controlplane/current','utf8').trim()+'.json','utf8')).port)")
curl -sS -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"entry":"rest","actor":"script","commandIds":["test"],"maxRounds":2}' \
  "http://127.0.0.1:${PORT}/v1/verify"
```

`entry` 写成 `rest`，时间线上就会标成 REST 入口。仍然只绑 `127.0.0.1`，token 来自当前窗口的会话文件。
