export const MAX_VERIFY_ROUNDS = 5;
export const FAILURE_MAX = 180;
export const SUMMARY_MAX = 200;
export const PATCH_MAX_BYTES = 512 * 1024;

export const EMPTY_DIFF = { files: 0, additions: 0, deletions: 0 };

/** 收成一行并截断。回执和摘要都不能带多行日志。 */
export function clipText(text: string, max: number): string {
  const oneLine = text.replace(/[\r\n]+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return oneLine.slice(0, max);
}

const TAP_NOISE = [
  /^TAP version \d+$/i,
  /^# Subtest:/,
  /^# tests \d+/,
  /^# suites \d+/,
  /^# pass \d+/,
  /^# fail \d+/,
  /^# cancelled \d+/,
  /^# skipped \d+/,
  /^# todo \d+/,
  /^# duration_ms\b/,
  /^\d+\.\.\d+$/,
  /^ok \d+/,
];

function linesOf(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function isSignal(line: string): boolean {
  return (
    /^not ok\b/i.test(line) ||
    /^Error:/.test(line) ||
    /^# (Error|AssertionError)\b/.test(line) ||
    line.includes("AssertionError")
  );
}

function isNoise(line: string): boolean {
  return TAP_NOISE.some((pattern) => pattern.test(line));
}

/** 跳过 TAP 套头，留下断言或 Error 那一行。两边都没有信号时，用第一条非空内容。 */
export function firstErrorSegment(stderr: string, stdout: string): string | undefined {
  const lines = [...linesOf(stderr), ...linesOf(stdout)];
  if (lines.length === 0) return undefined;
  const signal = lines.find((line) => isSignal(line));
  if (signal) return clipText(signal, FAILURE_MAX);
  const useful = lines.find((line) => !isNoise(line));
  return clipText(useful ?? lines[0] ?? "", FAILURE_MAX);
}
