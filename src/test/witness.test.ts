import assert from "node:assert/strict";
import test from "node:test";
import { AUTH_PLACEHOLDER, type TimelineEvent } from "../contract/timeline.js";
import { assertPanelAesthetic, panelDocument } from "../witness/panelHtml.js";
import { buildWitnessFrame, formatWitnessFrame } from "../witness/render.js";

function event(partial: Partial<TimelineEvent> & Pick<TimelineEvent, "id" | "runId" | "verb" | "step" | "phase">): TimelineEvent {
  return {
    time: "2026-11-02T08:00:00.000Z",
    entry: "mcp",
    actor: "cursor",
    summary: partial.step,
    stepKind: "model_turn",
    receipt: null,
    auth: AUTH_PLACEHOLDER,
    ...partial,
  };
}

test("见证面板抽出谁在下任务、正在做的一步和通过失败", () => {
  const events: TimelineEvent[] = [
    event({
      id: "1",
      runId: "r1",
      verb: "observe",
      step: "压缩工作区摘要",
      phase: "started",
    }),
    event({
      id: "2",
      runId: "r1",
      verb: "observe",
      step: "工作区摘要",
      phase: "finished",
      receipt: {
        status: "passed",
        exitCode: null,
        diff: { files: 0, additions: 0, deletions: 0 },
        durationMs: 7,
      },
    }),
    event({
      id: "3",
      runId: "r2",
      verb: "verify",
      step: "验收循环，最多 2 轮",
      phase: "started",
    }),
    event({
      id: "4",
      runId: "r2",
      verb: "verify",
      step: "验收第 1 轮",
      phase: "finished",
      stepKind: "local_loop",
      receipt: {
        status: "failed",
        exitCode: 1,
        failure: "check: not ok 1 - 灯的下一状态是翻转",
        diff: { files: 0, additions: 0, deletions: 0 },
        durationMs: 80,
        rounds: 1,
      },
    }),
  ];
  const frame = buildWitnessFrame(events, { sessionId: "demo", host: "127.0.0.1", port: 34567 });
  assert.equal(frame.actor, "cursor");
  assert.equal(frame.entry, "mcp");
  assert.equal(frame.tone, "failed");
  assert.match(frame.currentStep, /验收第 1 轮/);
  assert.match(frame.statusLine, /failed/);
  assert.match(frame.statusLine, /not ok 1/);
  assert.match(frame.authLine, /placeholder/);
  assert.ok(frame.recentItems.some((item) => item.tone === "failed" && item.stepKind === "本地循环"));
  const text = formatWitnessFrame(frame);
  assert.match(text, /本机控制面 · 见证/);
  assert.match(text, /Prism/);
  assert.match(text, /谁在下任务/);
  assert.equal(/lorem/i.test(text), false);
});

test("没有事件时见证面板仍可阅读", () => {
  const frame = buildWitnessFrame([], { sessionId: "empty", host: "127.0.0.1", port: 1 });
  assert.equal(frame.currentStep, "等待第一步");
  assert.equal(frame.statusLine, "还没有步骤");
  assert.equal(frame.tone, "idle");
  assert.equal(frame.auth.state, "placeholder");
  assert.deepEqual(frame.recent, []);
  assert.deepEqual(frame.recentItems, []);
});

test("小窗口 HTML 走 Prism 指挥台构图", () => {
  const html = panelDocument();
  assertPanelAesthetic(html);
  assert.match(html, /最近/);
  assert.match(html, /backdrop-filter/);
  assert.equal(/\bInter\b|\bRoboto\b|Comic Sans/i.test(html), false);
});
