import { callControlPlane, DSH_TOOL_DOCS, resolveDshWorkspace, stripHeavyFields, type DshVerb } from "./bridge.js";

/** 与 defineTool 同形的定义。正式挂到 DSH 时，可甠官方 defineTool 再包一层。 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  output: {
    schema: { type: string };
    render: (args: unknown, value: unknown) => Array<{ type: "text"; text: string }>;
  };
  execute: (args: Record<string, unknown>, exec?: { signal?: AbortSignal }) => Promise<unknown>;
}

export interface DshPluginConfig {
  /** 工作区绝对路径。缺省读 CONTROLPLANE_WORKSPACE 或 cwd。 */
  workspace?: string;
}

export interface ToolsService {
  register: (tool: ToolDefinition) => unknown;
}

export interface CordisLikeContext {
  tools: ToolsService;
}

function renderJson(_args: unknown, value: unknown): Array<{ type: "text"; text: string }> {
  return [{ type: "text", text: JSON.stringify(stripHeavyFields(value)) }];
}

export function buildControlPlaneTools(workspace?: string): ToolDefinition[] {
  const root = resolveDshWorkspace(workspace);
  const verbs: Array<{
    name: DshVerb;
    parameters: Record<string, unknown>;
  }> = [
    {
      name: "observe",
      parameters: {
        actor: { type: "string", description: "谁在下任务" },
      },
    },
    {
      name: "edit",
      parameters: {
        actor: { type: "string" },
        patch: { type: "string", required: true, description: "unified diff，路径必须留在工作区内" },
      },
    },
    {
      name: "terminal",
      parameters: {
        actor: { type: "string" },
        commandId: { type: "string", required: true, description: "commands.json 里的命令 id" },
      },
    },
    {
      name: "verify",
      parameters: {
        actor: { type: "string" },
        commandIds: {
          type: "array",
          required: true,
          items: { type: "string" },
          description: "已声明的验收命令 id",
        },
        maxRounds: { type: "number" },
      },
    },
    {
      name: "trace",
      parameters: {
        actor: { type: "string" },
        summary: { type: "string", required: true, description: "这一步的一句话摘要" },
        stepKind: { type: "string" },
      },
    },
    {
      name: "observe_ui",
      parameters: { actor: { type: "string" } },
    },
    {
      name: "capture_window",
      parameters: {
        actor: { type: "string" },
        app: { type: "string" },
        windowTitleIncludes: { type: "string" },
      },
    },
    {
      name: "perform_ax",
      parameters: {
        actor: { type: "string" },
        action: { type: "string", required: true },
        target: { type: "string", required: true },
        value: { type: "string" },
      },
    },
  ];

  return verbs.map((verb) => ({
    name: verb.name,
    description: DSH_TOOL_DOCS[verb.name],
    parameters: verb.parameters,
    output: {
      schema: { type: "object" },
      render: renderJson,
    },
    async execute(args) {
      return stripHeavyFields(await callControlPlane(verb.name, args, root));
    },
  }));
}

export const name = "local-control-plane";
export const inject = ["tools"];

/** Cordis / DeepSeek Harness 插件入口。挂在已有 tools / approval 之上，不另写 agent loop。 */
export function apply(ctx: CordisLikeContext, config: DshPluginConfig = {}): void {
  for (const tool of buildControlPlaneTools(config.workspace)) {
    ctx.tools.register(tool);
  }
}
