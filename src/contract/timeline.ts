/**
 * 时间线事件契约。
 *
 * 扩展侧边栏、终端见证（`controlplane-witness`）读这条序列。
 * 将来的 Mac 小原生窗口也订阅同一条序列，不另做一套事件。
 *
 * 小窗口 / 见证约定（只读这些字段；Mac 窗口还不抢焦点）：
 * - actor：谁在下任务
 * - 最新一条 phase 为 started 的 step：正在做的一步
 * - 同一 runId 上后续的 finished：这一步结束
 * - receipt.status：通过、失败或拒绝
 * - auth：授权状态。无 Mac 助手时为 placeholder；助手在线后写入四态之一
 */
export type EntryPoint = "mcp" | "extension" | "rest" | "dsh";

export type Verb =
  | "observe"
  | "edit"
  | "terminal"
  | "verify"
  | "trace"
  | "observe_ui"
  | "capture_window"
  | "perform_ax";

/** 模型轮次是一次入口调用；本地循环是 verify 在本机重试的一轮。 */
export type StepKind = "model_turn" | "local_loop";

export type Phase = "started" | "finished";

export type ReceiptStatus = "passed" | "failed" | "rejected";

export interface DiffStat {
  files: number;
  additions: number;
  deletions: number;
}

/**
 * 压缩回执。只有这些字段。
 * 没有 stdout、stderr，也没有完整日志。
 */
export interface Receipt {
  status: ReceiptStatus;
  exitCode: number | null;
  /** 失败名，或错误的第一段。没有失败时省略。 */
  failure?: string;
  diff: DiffStat;
  durationMs: number;
  /** verify 实际跑了几轮。通过就停，所以可能小于上限。 */
  rounds?: number;
}

export type AuthState =
  | "placeholder"
  | "helper_offline"
  | "ready"
  | "missing_screen"
  | "missing_accessibility"
  | "missing_both";

export type PermissionFlag = "granted" | "denied" | "unknown";

export interface AuthStatus {
  state: AuthState;
  screenRecording: PermissionFlag;
  accessibility: PermissionFlag;
}

/** 无 Mac 助手时的默认值。不等于已经授权。 */
export const AUTH_PLACEHOLDER: AuthStatus = {
  state: "placeholder",
  screenRecording: "unknown",
  accessibility: "unknown",
};

export const AUTH_HELPER_OFFLINE: AuthStatus = {
  state: "helper_offline",
  screenRecording: "unknown",
  accessibility: "unknown",
};

export interface TimelineEvent {
  id: string;
  /** ISO-8601 */
  time: string;
  /** 同一次动词调用的开始、本地循环和结束共用一个 runId。 */
  runId: string;
  entry: EntryPoint;
  verb: Verb;
  /** 谁在下任务，例如 cursor、codex。 */
  actor: string;
  /** 正在做或刚做完的一步，一句话。 */
  step: string;
  /** 改动摘要，不是日志。 */
  summary: string;
  stepKind: StepKind;
  phase: Phase;
  /** started 时还没有回执。 */
  receipt: Receipt | null;
  auth: AuthStatus;
}

export interface DiagnosticCounts {
  error: number;
  warning: number;
  info: number;
  hint: number;
}

export interface GitSummary {
  branch: string;
  changed: number;
  /** 至多二十个路径，不含文件内容。 */
  files: string[];
}

/** observe 交回模型的压缩摘要。不含文件正文。 */
export interface ObserveSummary {
  editors: string[];
  diagnostics: DiagnosticCounts;
  git: GitSummary | null;
}

export interface WorkspaceSnapshot {
  editors: string[];
  diagnostics: DiagnosticCounts;
}
