import assert from "node:assert/strict";
import test from "node:test";
import { AUTH_PLACEHOLDER, type TimelineEvent } from "../contract/timeline.js";
import { formatJournal } from "../journal/format.js";

function event(partial: Partial<TimelineEvent> & Pick<TimelineEvent, "id" | "runId" | "verb" | "step" | "phase">): TimelineEvent {
  return {
    time: "2026-11-02T08:00:00.000Z",
    entry: "mcp",
    actor: "cursor",
    summary: partial.summary ?? partial.step,
    stepKind: "model_turn",
    receipt: null,
    auth: AUTH_PLACEHOLDER,
    ...partial,
  };
}

test("过程日志写出谁在下任务、本地循环和压缩回执", () => {
  const events: TimelineEvent[] = [
    event({
      id: "1",
      runId: "r1",
      verb: "verify",
      step: "验收循环，最多 2 轮",
      phase: "started",
    }),
    event({
      id: "2",
      runId: "r1",
      verb: "verify",
      step: "验收第 1 轮",
      phase: "finished",
      stepKind: "local_loop",
      summary: "check 失败",
      receipt: {
        status: "failed",
        exitCode: 1,
        failure: "check: not ok 1 - 灯的下一状态是翻转",
        diff: { files: 0, additions: 0, deletions: 0 },
        durationMs: 80,
        rounds: 1,
      },
    }),
    event({
      id: "3",
      runId: "r1",
      verb: "verify",
      step: "验收结束",
      phase: "finished",
      summary: "失败，1 轮",
      receipt: {
        status: "failed",
        exitCode: 1,
        failure: "check: not ok 1 - 灯的下一状态是翻转",
        diff: { files: 0, additions: 0, deletions: 0 },
        durationMs: 90,
        rounds: 1,
      },
    }),
  ];
  const text = formatJournal(events, { sessionId: "demo", exportedAt: "2026-11-02T09:00:00.000Z" });
  assert.match(text, /# 编程过程日志/);
  assert.match(text, /cursor\/mcp/);
  assert.match(text, /本地验收循环/);
  assert.match(text, /not ok 1/);
  assert.match(text, /怎么读/);
  assert.equal(/stdout|lorem/i.test(text), false);
  // started 且后面有 finished 时不单独占一节
  assert.equal((text.match(/^### /gm) ?? []).length, 2);
});

test("空时间线也有可读说明", () => {
  const text = formatJournal([], { sessionId: "empty", exportedAt: "2026-11-02T09:00:00.000Z" });
  assert.match(text, /还没有步骤/);
});
