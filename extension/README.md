# 本机控制面

模型只交紧凑意图。本机 broker 在 `127.0.0.1` 执行声明过的命令，回执保持压缩。侧边栏时间线给人看编程怎么发生。

## 用法

1. 打开一个本地工作区并信任它（未信任不启 broker）。
2. 活动栏打开「本机控制面」看时间线。
3. 新仓库先运行「初始化工作区命令」，从常见脚本写出 `.controlplane/commands.json`。
4. Cursor / 新版 VS Code 会经扩展自动发现「本机控制面」MCP；Codex 仍用「复制 MCP 配置」。
5. 命令面板还可：显示 broker 状态、运行 doctor、启动/停止演示助手、打开授权设置、打开终端见证、导出编程过程日志。

侧边栏顶部有授权条和「正在做」，与终端见证、演示助手小窗口读同一份事件。过程日志写在 `.controlplane/journals/`。DeepSeek Harness 用仓库里的 `dsh-plugin` bundle。Mac 助手见仓库 `mac-helper/`；Linux 上用「启动演示助手」跑同协议进程。完整本机分发包用仓库根目录 `npm run pack`。
