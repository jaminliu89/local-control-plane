import { brokerRequest } from "../broker/client.js";
import { loadSession } from "../broker/session.js";

const COMPACT = "回执是压缩的，只有退出码、失败名或第一段错误、diff 统计和耗时。不要把全量日志要回去。";

export const DSH_TOOL_DOCS = {
  observe: `压缩查看当前工作区：打开的编辑器、诊断计数、git 状态（若可取得）。${COMPACT}`,
  edit: `把 unified diff 应用到工作区内的文件。越出工作区会被拒绝。${COMPACT}`,
  terminal: `只运行工作区 .controlplane/commands.json 里声明过的命令 id。不接受任意 shell。${COMPACT}`,
  verify: `按意图里的验收命令在本机循环，最多 5 轮，通过就停，只回一张压缩回执。${COMPACT}`,
  trace: `只往时间线追加一条事件，不跑命令。${COMPACT}`,
  observe_ui: `读取编辑器窗口辅助功能树。需要 Mac 菜单栏助手。${COMPACT}`,
  capture_window: `截取 VS Code / Cursor 单窗口一帧，帧留本机。需要屏幕录制授权。${COMPACT}`,
  perform_ax: `辅助功能按 / 设值 / 输入。需要辅助功能授权。${COMPACT}`,
} as const;

export type DshVerb = keyof typeof DSH_TOOL_DOCS;

export function resolveDshWorkspace(configWorkspace?: string): string {
  if (configWorkspace && configWorkspace.trim().length > 0) return configWorkspace.trim();
  if (process.env.CONTROLPLANE_WORKSPACE) return process.env.CONTROLPLANE_WORKSPACE;
  return process.cwd();
}

/** DeepSeek Harness 工具统一走本机 broker，入口标成 dsh。 */
export async function callControlPlane(
  verb: DshVerb,
  args: Record<string, unknown>,
  workspace?: string,
): Promise<unknown> {
  const session = loadSession(resolveDshWorkspace(workspace));
  return brokerRequest(session, "POST", `/v1/${verb}`, {
    ...args,
    entry: "dsh",
    actor: typeof args.actor === "string" && args.actor.trim() ? args.actor.trim() : "deepseek",
  });
}

export function stripHeavyFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => stripHeavyFields(item));
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (/^(stdout|stderr|logs?)$/i.test(key)) continue;
    out[key] = stripHeavyFields(item);
  }
  return out;
}
