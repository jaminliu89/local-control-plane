# local-control-plane-dsh

把本机控制面的五个动词挂进 DeepSeek Harness。挂在已有 `tools` / approval / sandbox 之上，不另写 agent loop，也不再包一层 bash。

## 前提

1. 本机 VS Code / Cursor 已激活「本机控制面」扩展，broker 在 `127.0.0.1` 起来。
2. 仓库根目录执行过 `npm run compile`。
3. 环境变量 `CONTROLPLANE_WORKSPACE` 指向那个已打开的工作区，或在 patch 里写死路径。

## 挂到 profile

在 DeepSeek Harness 的 profile 里把本目录加为 bundle，例如：

```bash
dsh plugin --profile web add /绝对路径/本仓库/dsh-plugin
```

或在 profile 的 `package.json` 里：

```json
{
  "dependencies": {
    "local-control-plane-dsh": "link:/绝对路径/本仓库/dsh-plugin"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "local-control-plane-dsh"
      ]
    }
  }
}
```

模型会看到 `observe`、`edit`、`terminal`、`verify`、`trace`。回执是压缩的。时间线入口标成 `dsh`。
