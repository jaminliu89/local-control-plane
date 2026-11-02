import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  AUTH_PLACEHOLDER,
  type AuthStatus,
  type DiffStat,
  type EntryPoint,
  type ObserveSummary,
  type Phase,
  type Receipt,
  type StepKind,
  type TimelineEvent,
  type Verb,
  type WorkspaceSnapshot,
} from "../contract/timeline.js";
import { helperCaptureWindow, helperObserveUi, helperPerformAx, probeHelperAuth } from "../helper/client.js";
import { isCommandId, loadCommands } from "./commands.js";
import { readDiffStat, readGitSummary } from "./git.js";
import { applyHunks, diffStatFromFiles, parseUnifiedDiff, type ParsedFile } from "./patch.js";
import { PathEscapeError, ProtectedPathError, resolveInsideWorkspace } from "./paths.js";
import type { CommandRunner } from "./run.js";
import type { TimelineStore } from "./store.js";
import { clipText, EMPTY_DIFF, FAILURE_MAX, firstErrorSegment, MAX_VERIFY_ROUNDS, PATCH_MAX_BYTES, SUMMARY_MAX } from "./text.js";

export interface VerbContext {
  workspace: string;
  store: TimelineStore;
  run: CommandRunner;
  snapshot: WorkspaceSnapshot;
  auth: AuthStatus;
}

export interface VerbOutcome {
  receipt: Receipt;
  summary?: ObserveSummary;
  ui?: { outline: string; nodeCount: number };
  artifact?: { kind: "window_frame"; path: string; retainedUntil: string };
}

const SHELL_FIELDS = ["command", "shell", "argv", "cwd", "env"] as const;

export function emptySnapshot(): WorkspaceSnapshot {
  return { editors: [], diagnostics: { error: 0, warning: 0, info: 0, hint: 0 } };
}

export function makeReceipt(input: {
  status: Receipt["status"];
  exitCode: number | null;
  failure?: string;
  diff?: DiffStat;
  durationMs: number;
  rounds?: number;
}): Receipt {
  const receipt: Receipt = {
    status: input.status,
    exitCode: input.exitCode,
    diff: input.diff ?? EMPTY_DIFF,
    durationMs: Math.max(0, Math.round(input.durationMs)),
  };
  if (input.failure && input.failure.trim().length > 0) {
    receipt.failure = clipText(input.failure, FAILURE_MAX);
  }
  if (input.rounds !== undefined) receipt.rounds = input.rounds;
  return receipt;
}

function who(body: Record<string, unknown>): { entry: EntryPoint; actor: string } {
  let entry: EntryPoint = "mcp";
  if (body.entry === "extension") entry = "extension";
  else if (body.entry === "rest") entry = "rest";
  else if (body.entry === "dsh") entry = "dsh";
  let actor = "unknown";
  if (typeof body.actor === "string") {
    const trimmed = body.actor.trim();
    if (trimmed.length > 0 && trimmed.length <= 80) actor = trimmed;
  }
  return { entry, actor };
}

function hasShellField(body: Record<string, unknown>): boolean {
  return SHELL_FIELDS.some((field) => field in body);
}

function pushEvent(
  ctx: VerbContext,
  input: {
    runId: string;
    entry: EntryPoint;
    verb: Verb;
    actor: string;
    step: string;
    summary: string;
    stepKind: StepKind;
    phase: Phase;
    receipt: Receipt | null;
  },
): void {
  const event: TimelineEvent = {
    id: crypto.randomUUID(),
    time: new Date().toISOString(),
    runId: input.runId,
    entry: input.entry,
    verb: input.verb,
    actor: input.actor,
    step: clipText(input.step, SUMMARY_MAX),
    summary: clipText(input.summary, SUMMARY_MAX),
    stepKind: input.stepKind,
    phase: input.phase,
    receipt: input.receipt,
    auth: ctx.auth,
  };
  ctx.store.append(event);
}

async function refreshAuth(ctx: VerbContext): Promise<void> {
  ctx.auth = await probeHelperAuth(ctx.workspace);
}

function rejectNow(
  ctx: VerbContext,
  verb: Verb,
  body: Record<string, unknown>,
  failure: string,
  started: number,
): VerbOutcome {
  const { entry, actor } = who(body);
  const receipt = makeReceipt({
    status: "rejected",
    exitCode: null,
    failure,
    durationMs: Date.now() - started,
  });
  pushEvent(ctx, {
    runId: crypto.randomUUID(),
    entry,
    verb,
    actor,
    step: "拒绝",
    summary: failure,
    stepKind: "model_turn",
    phase: "finished",
    receipt,
  });
  return { receipt };
}

const ALL_VERBS = new Set<Verb>([
  "observe",
  "edit",
  "terminal",
  "verify",
  "trace",
  "observe_ui",
  "capture_window",
  "perform_ax",
]);

export async function execute(ctx: VerbContext, verb: string, body: Record<string, unknown>): Promise<VerbOutcome> {
  if (!ALL_VERBS.has(verb as Verb)) {
    throw new Error("未知动词");
  }
  if ((verb === "terminal" || verb === "verify") && hasShellField(body)) {
    return rejectNow(ctx, verb as Verb, body, "不接受任意 shell，只能运行已声明的命令 id", Date.now());
  }
  switch (verb as Verb) {
    case "observe":
      return observe(ctx, body);
    case "edit":
      return edit(ctx, body);
    case "terminal":
      return terminal(ctx, body);
    case "verify":
      return verify(ctx, body);
    case "trace":
      return trace(ctx, body);
    case "observe_ui":
      return observeUi(ctx, body);
    case "capture_window":
      return captureWindow(ctx, body);
    case "perform_ax":
      return performAx(ctx, body);
    default:
      throw new Error("未知动词");
  }
}

async function observe(ctx: VerbContext, body: Record<string, unknown>): Promise<VerbOutcome> {
  const started = Date.now();
  const { entry, actor } = who(body);
  const runId = crypto.randomUUID();
  pushEvent(ctx, {
    runId,
    entry,
    verb: "observe",
    actor,
    step: "压缩工作区摘要",
    summary: "正在收集编辑器、诊断和 git 状态",
    stepKind: "model_turn",
    phase: "started",
    receipt: null,
  });
  const editors = ctx.snapshot.editors.slice(0, 30);
  const git = await readGitSummary(ctx.workspace);
  const diff = await readDiffStat(ctx.workspace);
  const summary: ObserveSummary = {
    editors,
    diagnostics: { ...ctx.snapshot.diagnostics },
    git,
  };
  const receipt = makeReceipt({ status: "passed", exitCode: null, diff, durationMs: Date.now() - started });
  const gitText = git ? `git ${git.branch} 变更 ${git.changed}` : "git 不可用";
  pushEvent(ctx, {
    runId,
    entry,
    verb: "observe",
    actor,
    step: "工作区摘要",
    summary: `编辑器 ${editors.length}，错误 ${summary.diagnostics.error}，${gitText}`,
    stepKind: "model_turn",
    phase: "finished",
    receipt,
  });
  return { receipt, summary };
}

async function edit(ctx: VerbContext, body: Record<string, unknown>): Promise<VerbOutcome> {
  const started = Date.now();
  const { entry, actor } = who(body);
  if (typeof body.patch !== "string" || body.patch.trim().length === 0) {
    return rejectNow(ctx, "edit", body, "补丁是空的", started);
  }
  if (Buffer.byteLength(body.patch, "utf8") > PATCH_MAX_BYTES) {
    return rejectNow(ctx, "edit", body, "补丁过大", started);
  }
  let files: ParsedFile[];
  try {
    files = parseUnifiedDiff(body.patch);
  } catch (error) {
    const message = error instanceof Error ? error.message : "补丁无法解析";
    return rejectNow(ctx, "edit", body, message, started);
  }

  const writes: Array<{ kind: "write"; file: string; text: string } | { kind: "delete"; file: string }> = [];
  try {
    for (const file of files) {
      if (file.kind === "create") {
        const target = resolveInsideWorkspace(ctx.workspace, file.newPath);
        if (fs.existsSync(target)) throw new Error(`文件已存在：${file.newPath}`);
        writes.push({ kind: "write", file: target, text: applyHunks("", file.hunks) });
        continue;
      }
      const source = resolveInsideWorkspace(ctx.workspace, file.oldPath);
      const target = resolveInsideWorkspace(ctx.workspace, file.newPath);
      if (!fs.existsSync(source)) throw new Error(`找不到文件：${file.oldPath}`);
      const next = applyHunks(fs.readFileSync(source, "utf8"), file.hunks);
      if (file.kind === "delete") {
        writes.push({ kind: "delete", file: source });
        continue;
      }
      if (source !== target) writes.push({ kind: "delete", file: source });
      writes.push({ kind: "write", file: target, text: next });
    }
  } catch (error) {
    const message = error instanceof PathEscapeError || error instanceof ProtectedPathError
      ? error.message
      : error instanceof Error
        ? error.message
        : "补丁被拒绝";
    return rejectNow(ctx, "edit", body, message, started);
  }

  for (const write of writes) {
    if (write.kind === "delete") {
      fs.rmSync(write.file, { force: true });
      continue;
    }
    fs.mkdirSync(path.dirname(write.file), { recursive: true });
    fs.writeFileSync(write.file, write.text, "utf8");
  }

  const diff = diffStatFromFiles(files);
  const names = files.map((file) => file.newPath).slice(0, 8).join(", ");
  const receipt = makeReceipt({ status: "passed", exitCode: 0, diff, durationMs: Date.now() - started });
  pushEvent(ctx, {
    runId: crypto.randomUUID(),
    entry,
    verb: "edit",
    actor,
    step: "应用工作区内补丁",
    summary: `${names} +${diff.additions} -${diff.deletions}`,
    stepKind: "model_turn",
    phase: "finished",
    receipt,
  });
  return { receipt };
}

async function terminal(ctx: VerbContext, body: Record<string, unknown>): Promise<VerbOutcome> {
  const started = Date.now();
  const { entry, actor } = who(body);
  const commandId = body.commandId;
  if (typeof commandId !== "string" || !isCommandId(commandId)) {
    return rejectNow(ctx, "terminal", body, "缺少已声明的命令 id", started);
  }
  let argv: string[] | undefined;
  try {
    argv = loadCommands(ctx.workspace).get(commandId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "commands.json 无法读取";
    return rejectNow(ctx, "terminal", body, message, started);
  }
  if (!argv) return rejectNow(ctx, "terminal", body, `未声明的命令：${commandId}`, started);

  const runId = crypto.randomUUID();
  pushEvent(ctx, {
    runId,
    entry,
    verb: "terminal",
    actor,
    step: `运行已声明命令 ${commandId}`,
    summary: commandId,
    stepKind: "model_turn",
    phase: "started",
    receipt: null,
  });
  const result = await ctx.run(argv, ctx.workspace);
  const failed = result.exitCode !== 0;
  const failure = failed ? `${commandId}: ${firstErrorSegment(result.stderr, result.stdout) ?? "失败"}` : undefined;
  const diff = await readDiffStat(ctx.workspace);
  const receipt = makeReceipt({
    status: failed ? "failed" : "passed",
    exitCode: result.exitCode,
    failure,
    diff,
    durationMs: Date.now() - started,
  });
  pushEvent(ctx, {
    runId,
    entry,
    verb: "terminal",
    actor,
    step: `已声明命令 ${commandId}`,
    summary: failed ? `${commandId} 失败` : `${commandId} 通过`,
    stepKind: "model_turn",
    phase: "finished",
    receipt,
  });
  return { receipt };
}

async function verify(ctx: VerbContext, body: Record<string, unknown>): Promise<VerbOutcome> {
  const started = Date.now();
  const { entry, actor } = who(body);
  const commandIds = body.commandIds;
  if (!Array.isArray(commandIds) || commandIds.length === 0 || commandIds.some((id) => typeof id !== "string")) {
    return rejectNow(ctx, "verify", body, "验收命令是空的", started);
  }
  const ids = commandIds as string[];
  if (ids.some((id) => !isCommandId(id))) {
    return rejectNow(ctx, "verify", body, "验收命令 id 不合法", started);
  }
  const requestedRounds = body.maxRounds;
  let maxRounds = 1;
  if (requestedRounds !== undefined) {
    if (typeof requestedRounds !== "number" || !Number.isInteger(requestedRounds) || requestedRounds < 1) {
      return rejectNow(ctx, "verify", body, "maxRounds 必须是正整数", started);
    }
    maxRounds = Math.min(requestedRounds, MAX_VERIFY_ROUNDS);
  }

  let commands: Map<string, string[]>;
  try {
    commands = loadCommands(ctx.workspace);
  } catch (error) {
    const message = error instanceof Error ? error.message : "commands.json 无法读取";
    return rejectNow(ctx, "verify", body, message, started);
  }
  for (const id of ids) {
    if (!commands.has(id)) return rejectNow(ctx, "verify", body, `未声明的命令：${id}`, started);
  }

  const runId = crypto.randomUUID();
  pushEvent(ctx, {
    runId,
    entry,
    verb: "verify",
    actor,
    step: `验收循环，最多 ${maxRounds} 轮`,
    summary: ids.join(", "),
    stepKind: "model_turn",
    phase: "started",
    receipt: null,
  });

  let rounds = 0;
  let exitCode: number | null = null;
  let failure: string | undefined;
  let passed = false;

  for (let round = 1; round <= maxRounds; round += 1) {
    rounds = round;
    let roundFailed = false;
    for (const id of ids) {
      const argv = commands.get(id);
      if (!argv) {
        roundFailed = true;
        exitCode = null;
        failure = `未声明的命令：${id}`;
        break;
      }
      const result = await ctx.run(argv, ctx.workspace);
      if (result.exitCode !== 0) {
        roundFailed = true;
        exitCode = result.exitCode;
        failure = `${id}: ${firstErrorSegment(result.stderr, result.stdout) ?? "失败"}`;
        const roundReceipt = makeReceipt({
          status: "failed",
          exitCode: result.exitCode,
          failure,
          durationMs: result.durationMs,
          rounds: round,
        });
        pushEvent(ctx, {
          runId,
          entry,
          verb: "verify",
          actor,
          step: `验收第 ${round} 轮`,
          summary: `${id} 失败`,
          stepKind: "local_loop",
          phase: "finished",
          receipt: roundReceipt,
        });
        break;
      }
    }
    if (!roundFailed) {
      passed = true;
      exitCode = 0;
      failure = undefined;
      pushEvent(ctx, {
        runId,
        entry,
        verb: "verify",
        actor,
        step: `验收第 ${round} 轮`,
        summary: `${ids.join(", ")} 通过`,
        stepKind: "local_loop",
        phase: "finished",
        receipt: makeReceipt({ status: "passed", exitCode: 0, durationMs: Date.now() - started, rounds: round }),
      });
      break;
    }
  }

  const diff = await readDiffStat(ctx.workspace);
  const receipt = makeReceipt({
    status: passed ? "passed" : "failed",
    exitCode,
    failure: passed ? undefined : failure,
    diff,
    durationMs: Date.now() - started,
    rounds,
  });
  pushEvent(ctx, {
    runId,
    entry,
    verb: "verify",
    actor,
    step: "验收结束",
    summary: passed ? `通过，${rounds} 轮` : `失败，${rounds} 轮`,
    stepKind: "model_turn",
    phase: "finished",
    receipt,
  });
  return { receipt };
}

function trace(ctx: VerbContext, body: Record<string, unknown>): VerbOutcome {
  const started = Date.now();
  const { entry, actor } = who(body);
  if (typeof body.summary !== "string" || body.summary.trim().length === 0) {
    return rejectNow(ctx, "trace", body, "trace 需要一句摘要", started);
  }
  if (body.summary.trim().length > SUMMARY_MAX) {
    return rejectNow(ctx, "trace", body, "trace 摘要过长", started);
  }
  const stepKind: StepKind = body.stepKind === "local_loop" ? "local_loop" : "model_turn";
  const receipt = makeReceipt({ status: "passed", exitCode: null, durationMs: Date.now() - started });
  pushEvent(ctx, {
    runId: crypto.randomUUID(),
    entry,
    verb: "trace",
    actor,
    step: body.summary.trim(),
    summary: body.summary.trim(),
    stepKind,
    phase: "finished",
    receipt,
  });
  return { receipt };
}

async function observeUi(ctx: VerbContext, body: Record<string, unknown>): Promise<VerbOutcome> {
  const started = Date.now();
  const { entry, actor } = who(body);
  await refreshAuth(ctx);
  const runId = crypto.randomUUID();
  pushEvent(ctx, {
    runId,
    entry,
    verb: "observe_ui",
    actor,
    step: "读取辅助功能树",
    summary: "只读当前编辑器窗口的控件大纲",
    stepKind: "model_turn",
    phase: "started",
    receipt: null,
  });
  try {
    const ui = await helperObserveUi(ctx.workspace);
    await refreshAuth(ctx);
    const receipt = makeReceipt({ status: "passed", exitCode: null, durationMs: Date.now() - started });
    pushEvent(ctx, {
      runId,
      entry,
      verb: "observe_ui",
      actor,
      step: "辅助功能树",
      summary: `节点 ${ui.nodeCount}`,
      stepKind: "model_turn",
      phase: "finished",
      receipt,
    });
    return { receipt, ui };
  } catch (error) {
    const message = error instanceof Error ? error.message : "读取界面失败";
    const receipt = makeReceipt({
      status: "rejected",
      exitCode: null,
      failure: message,
      durationMs: Date.now() - started,
    });
    pushEvent(ctx, {
      runId,
      entry,
      verb: "observe_ui",
      actor,
      step: "辅助功能树",
      summary: message,
      stepKind: "model_turn",
      phase: "finished",
      receipt,
    });
    return { receipt };
  }
}

async function captureWindow(ctx: VerbContext, body: Record<string, unknown>): Promise<VerbOutcome> {
  const started = Date.now();
  const { entry, actor } = who(body);
  await refreshAuth(ctx);
  const app = body.app === "cursor" ? "cursor" : "vscode";
  const runId = crypto.randomUUID();
  pushEvent(ctx, {
    runId,
    entry,
    verb: "capture_window",
    actor,
    step: `截取 ${app} 窗口`,
    summary: "帧留在本机，默认不进模型",
    stepKind: "model_turn",
    phase: "started",
    receipt: null,
  });
  try {
    const frame = await helperCaptureWindow(ctx.workspace, {
      app,
      windowTitleIncludes: typeof body.windowTitleIncludes === "string" ? body.windowTitleIncludes : undefined,
    });
    await refreshAuth(ctx);
    const receipt = makeReceipt({ status: "passed", exitCode: null, durationMs: Date.now() - started });
    pushEvent(ctx, {
      runId,
      entry,
      verb: "capture_window",
      actor,
      step: `已截 ${app}`,
      summary: path.basename(frame.imagePath),
      stepKind: "model_turn",
      phase: "finished",
      receipt,
    });
    return {
      receipt,
      artifact: { kind: "window_frame", path: frame.imagePath, retainedUntil: frame.retainedUntil },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "截帧失败";
    const receipt = makeReceipt({
      status: "rejected",
      exitCode: null,
      failure: message,
      durationMs: Date.now() - started,
    });
    pushEvent(ctx, {
      runId,
      entry,
      verb: "capture_window",
      actor,
      step: "截帧",
      summary: message,
      stepKind: "model_turn",
      phase: "finished",
      receipt,
    });
    return { receipt };
  }
}

async function performAx(ctx: VerbContext, body: Record<string, unknown>): Promise<VerbOutcome> {
  const started = Date.now();
  const { entry, actor } = who(body);
  await refreshAuth(ctx);
  const action = body.action;
  const target = body.target;
  if (action !== "press" && action !== "set_value" && action !== "type") {
    return rejectNow(ctx, "perform_ax", body, "action 只能是 press、set_value 或 type", started);
  }
  if (typeof target !== "string" || target.trim().length === 0 || target.trim().length > 120) {
    return rejectNow(ctx, "perform_ax", body, "需要控件 target", started);
  }
  if ((action === "set_value" || action === "type") && typeof body.value !== "string") {
    return rejectNow(ctx, "perform_ax", body, "set_value / type 需要 value", started);
  }
  const runId = crypto.randomUUID();
  pushEvent(ctx, {
    runId,
    entry,
    verb: "perform_ax",
    actor,
    step: `${action} ${target.trim()}`,
    summary: "辅助功能动作",
    stepKind: "model_turn",
    phase: "started",
    receipt: null,
  });
  try {
    await helperPerformAx(ctx.workspace, {
      action,
      target: target.trim(),
      value: typeof body.value === "string" ? body.value : undefined,
    });
    await refreshAuth(ctx);
    const receipt = makeReceipt({ status: "passed", exitCode: null, durationMs: Date.now() - started });
    pushEvent(ctx, {
      runId,
      entry,
      verb: "perform_ax",
      actor,
      step: `${action} 完成`,
      summary: target.trim(),
      stepKind: "model_turn",
      phase: "finished",
      receipt,
    });
    return { receipt };
  } catch (error) {
    const message = error instanceof Error ? error.message : "辅助功能动作失败";
    const receipt = makeReceipt({
      status: "rejected",
      exitCode: null,
      failure: message,
      durationMs: Date.now() - started,
    });
    pushEvent(ctx, {
      runId,
      entry,
      verb: "perform_ax",
      actor,
      step: `${action} 失败`,
      summary: message,
      stepKind: "model_turn",
      phase: "finished",
      receipt,
    });
    return { receipt };
  }
}
