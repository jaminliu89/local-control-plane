import type { AuthStatus, ReceiptStatus, TimelineEvent } from "../contract/timeline.js";
import { AUTH_PLACEHOLDER } from "../contract/timeline.js";

export type WitnessTone = "idle" | "running" | "passed" | "failed" | "rejected";

export interface WitnessRecentItem {
  verb: string;
  step: string;
  summary: string;
  status: string;
  stepKind: string;
  tone: WitnessTone;
  time: string;
}

export interface WitnessFrame {
  sessionId: string;
  host: string;
  port: number;
  actor: string;
  entry: string;
  currentStep: string;
  statusLine: string;
  authLine: string;
  auth: AuthStatus;
  tone: WitnessTone;
  recent: string[];
  recentItems: WitnessRecentItem[];
}

export function toneFromReceipt(
  receipt: TimelineEvent["receipt"],
  phase: TimelineEvent["phase"] | undefined,
): WitnessTone {
  if (receipt?.status === "passed") return "passed";
  if (receipt?.status === "failed") return "failed";
  if (receipt?.status === "rejected") return "rejected";
  if (phase === "started") return "running";
  return "idle";
}

function toneLabel(tone: WitnessTone): string {
  switch (tone) {
    case "passed":
      return "通过";
    case "failed":
      return "失败";
    case "rejected":
      return "拒绝";
    case "running":
      return "进行中";
    default:
      return "空闲";
  }
}

/** 从时间线抽出小窗口要看的那几行。Mac 原生窗口以后读同一份事件。 */
export function buildWitnessFrame(
  events: TimelineEvent[],
  meta: { sessionId: string; host: string; port: number },
): WitnessFrame {
  const latest = events.length > 0 ? events[events.length - 1] : undefined;
  const started = [...events].reverse().find((event) => event.phase === "started");
  const finishedForStarted = started
    ? [...events].reverse().find((event) => event.runId === started.runId && event.phase === "finished")
    : undefined;
  const focus = finishedForStarted ?? started ?? latest;

  let statusLine = "还没有步骤";
  if (focus?.receipt) {
    const parts: string[] = [focus.receipt.status];
    if (focus.receipt.exitCode !== null && focus.receipt.exitCode !== undefined) {
      parts.push(`退出码 ${focus.receipt.exitCode}`);
    }
    if (focus.receipt.failure) parts.push(focus.receipt.failure);
    if (focus.receipt.rounds) parts.push(`${focus.receipt.rounds} 轮`);
    parts.push(`${focus.receipt.durationMs} ms`);
    statusLine = parts.join(" · ");
  } else if (focus?.phase === "started") {
    statusLine = "进行中";
  }

  const auth = focus?.auth ?? AUTH_PLACEHOLDER;
  const authLine = `${auth.state}（屏幕录制 ${auth.screenRecording}，辅助功能 ${auth.accessibility}）`;

  const recentItems = events
    .slice()
    .reverse()
    .filter((event) => event.phase === "finished" || event.receipt !== null)
    .slice(0, 8)
    .map((event) => {
      const tone = toneFromReceipt(event.receipt, event.phase);
      const status = event.receipt?.status ?? event.phase;
      return {
        verb: event.verb,
        step: event.step,
        summary: event.summary,
        status,
        stepKind: event.stepKind === "local_loop" ? "本地循环" : "模型轮次",
        tone,
        time: event.time,
      };
    });

  const recent = recentItems.map(
    (item) => `${item.verb} · ${item.step} · ${item.status} · ${item.stepKind}`,
  );

  return {
    sessionId: meta.sessionId,
    host: meta.host,
    port: meta.port,
    actor: focus?.actor ?? "—",
    entry: focus?.entry ?? "—",
    currentStep: focus ? `${focus.step} · ${focus.verb}` : "等待第一步",
    statusLine,
    authLine,
    auth,
    tone: toneFromReceipt(focus?.receipt ?? null, focus?.phase),
    recent,
    recentItems,
  };
}

export function formatWitnessFrame(frame: WitnessFrame): string {
  const lines = [
    "本机控制面 · 见证",
    "（终端面板。图形小窗口用 npm run witness -- --ui，审美对齐 Prism 指挥台。）",
    "",
    `会话  ${frame.sessionId}`,
    `地址  ${frame.host}:${frame.port}`,
    `谁在下任务  ${frame.actor}（${frame.entry}）`,
    `正在做的一步  ${frame.currentStep}`,
    `状态  ${toneLabel(frame.tone)} · ${frame.statusLine}`,
    `授权  ${frame.authLine}`,
    "",
    "最近",
  ];
  if (frame.recent.length === 0) {
    lines.push("  （还没有事件）");
  } else {
    for (const item of frame.recent) lines.push(`  · ${item}`);
  }
  lines.push("");
  lines.push("Ctrl+C 退出。画面和长日志仍留在本机，默认不进模型。");
  return lines.join("\n");
}

export function statusTone(status: ReceiptStatus | "started" | "idle" | string): WitnessTone {
  if (status === "passed") return "passed";
  if (status === "failed") return "failed";
  if (status === "rejected") return "rejected";
  if (status === "started") return "running";
  return "idle";
}
