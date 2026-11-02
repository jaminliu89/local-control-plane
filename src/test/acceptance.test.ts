import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { compressGitStatus } from "../broker/git.js";
import { spawnCommand, type CommandResult, type CommandRunner } from "../broker/run.js";
import { MemoryTimelineStore } from "../broker/store.js";
import { firstErrorSegment, MAX_VERIFY_ROUNDS } from "../broker/text.js";
import { AUTH_PLACEHOLDER } from "../contract/timeline.js";
import { emptySnapshot, execute, type VerbContext } from "../broker/verbs.js";
import { timelineHtml } from "../extension/timelineHtml.js";

const SECRET = "SENTINEL_FULL_LOG_do_not_return";

async function tempWorkspace(commands?: Record<string, string[]>): Promise<string> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "lcp-"));
  await fs.promises.mkdir(path.join(dir, ".controlplane"), { recursive: true });
  if (commands) {
    await fs.promises.writeFile(
      path.join(dir, ".controlplane", "commands.json"),
      JSON.stringify({ commands }),
      "utf8",
    );
  }
  return dir;
}

function harness(workspace: string, run: CommandRunner): { ctx: VerbContext; store: MemoryTimelineStore } {
  const store = new MemoryTimelineStore();
  return {
    store,
    ctx: { workspace, store, run, snapshot: emptySnapshot(), auth: AUTH_PLACEHOLDER },
  };
}

function counting(handler: (call: number) => CommandResult): { run: CommandRunner; calls: () => number } {
  let calls = 0;
  return {
    calls: () => calls,
    run: (argv) => {
      calls += 1;
      assert.ok(Array.isArray(argv));
      assert.equal(argv.some((part) => part.includes(SECRET)), false);
      return Promise.resolve(handler(calls));
    },
  };
}

function assertCompact(value: unknown, secret = SECRET): void {
  const json = JSON.stringify(value);
  assert.equal(json.includes(secret), false);
  assert.equal(json.includes('"stdout"'), false);
  assert.equal(json.includes('"stderr"'), false);
  assert.equal(json.includes(secret.slice(0, 12) + secret.slice(12)), false);
}

test("verify 通过即停，回执不含完整 stdout", async () => {
  const workspace = await tempWorkspace({ test: ["node", "ok.js"] });
  try {
    const runner = counting(() => ({
      exitCode: 0,
      stdout: `ok\n${SECRET}\n${"x".repeat(400)}`,
      stderr: "",
      durationMs: 3,
    }));
    const { ctx, store } = harness(workspace, runner.run);
    const outcome = await execute(ctx, "verify", { commandIds: ["test"], maxRounds: 4, actor: "cursor" });
    assert.equal(runner.calls(), 1);
    assert.equal(outcome.receipt.status, "passed");
    assert.equal(outcome.receipt.exitCode, 0);
    assert.equal(outcome.receipt.rounds, 1);
    assert.equal(outcome.receipt.failure, undefined);
    assertCompact(outcome.receipt);
    assertCompact(store.list());
    const phases = store.list().map((event) => `${event.phase}:${event.stepKind}`);
    assert.deepEqual(phases, ["started:model_turn", "finished:local_loop", "finished:model_turn"]);
  } finally {
    await fs.promises.rm(workspace, { recursive: true, force: true });
  }
});

test("verify 失败再跑直到上限，回执只有第一段错误", async () => {
  const workspace = await tempWorkspace({ test: ["node", "bad.js"] });
  try {
    const tail = "TAIL_SHOULD_NOT_APPEAR";
    const runner = counting((call) => ({
      exitCode: 2,
      stdout: "",
      stderr: `Error: boom ${call}\n${SECRET}\n${"y".repeat(300)}${tail}`,
      durationMs: 4,
    }));
    const { ctx, store } = harness(workspace, runner.run);
    const outcome = await execute(ctx, "verify", { commandIds: ["test"], maxRounds: 3, actor: "codex" });
    assert.equal(runner.calls(), 3);
    assert.equal(outcome.receipt.status, "failed");
    assert.equal(outcome.receipt.exitCode, 2);
    assert.equal(outcome.receipt.rounds, 3);
    assert.match(outcome.receipt.failure ?? "", /^test: Error: boom 3/);
    assert.ok((outcome.receipt.failure ?? "").length <= 180);
    assertCompact(outcome);
    assertCompact(store.list());
    assert.equal(JSON.stringify(store.list()).includes(tail), false);
    const loops = store.list().filter((event) => event.stepKind === "local_loop");
    assert.equal(loops.length, 3);
    assert.ok(store.list().some((event) => event.stepKind === "model_turn" && event.phase === "finished"));
  } finally {
    await fs.promises.rm(workspace, { recursive: true, force: true });
  }
});

test("verify 第二轮通过就停，并且超过上限的轮次会被夹到 5", async () => {
  const workspace = await tempWorkspace({ test: ["node", "flaky.js"] });
  try {
    const passOnSecond = counting((call) => ({
      exitCode: call === 1 ? 1 : 0,
      stdout: call === 1 ? "" : `passed\n${SECRET}`,
      stderr: call === 1 ? "Error: not yet" : "",
      durationMs: 1,
    }));
    const early = harness(workspace, passOnSecond.run);
    const passed = await execute(early.ctx, "verify", { commandIds: ["test"], maxRounds: 4 });
    assert.equal(passOnSecond.calls(), 2);
    assert.equal(passed.receipt.status, "passed");
    assert.equal(passed.receipt.rounds, 2);
    assertCompact(early.store.list());

    const alwaysFail = counting(() => ({
      exitCode: 1,
      stdout: SECRET,
      stderr: "Error: still",
      durationMs: 1,
    }));
    const limited = harness(workspace, alwaysFail.run);
    const failed = await execute(limited.ctx, "verify", { commandIds: ["test"], maxRounds: 99 });
    assert.equal(MAX_VERIFY_ROUNDS, 5);
    assert.equal(alwaysFail.calls(), MAX_VERIFY_ROUNDS);
    assert.equal(failed.receipt.rounds, MAX_VERIFY_ROUNDS);
    assert.equal(failed.receipt.status, "failed");
    assertCompact(failed);
  } finally {
    await fs.promises.rm(workspace, { recursive: true, force: true });
  }
});

test("未声明的命令和任意 shell 都被拒绝，且不会执行", async () => {
  const workspace = await tempWorkspace({ build: ["node", "build.js"] });
  try {
    let calls = 0;
    const run: CommandRunner = (argv) => {
      calls += 1;
      return Promise.resolve({ exitCode: 0, stdout: argv.join(" "), stderr: "", durationMs: 1 });
    };
    const { ctx } = harness(workspace, run);
    const missing = await execute(ctx, "terminal", { commandId: "rm-rf" });
    assert.equal(missing.receipt.status, "rejected");
    assert.match(missing.receipt.failure ?? "", /未声明的命令/);
    const shell = await execute(ctx, "terminal", { commandId: "build", command: "rm -rf /" });
    assert.equal(shell.receipt.status, "rejected");
    assert.match(shell.receipt.failure ?? "", /不接受任意 shell/);
    const verifyShell = await execute(ctx, "verify", { commandIds: ["build"], shell: "bash" });
    assert.equal(verifyShell.receipt.status, "rejected");
    const verifyMissing = await execute(ctx, "verify", { commandIds: ["not-declared"], maxRounds: 3 });
    assert.equal(verifyMissing.receipt.status, "rejected");
    assert.equal(calls, 0);

    const ok = await execute(ctx, "terminal", { commandId: "build", actor: "cursor" });
    assert.equal(ok.receipt.status, "passed");
    assert.equal(calls, 1);
  } finally {
    await fs.promises.rm(workspace, { recursive: true, force: true });
  }
});

test("补丁不能逃出工作区，也不能改控制面文件；工作区内的补丁可以打上", async () => {
  const workspace = await tempWorkspace({ test: ["node", "test.js"] });
  const outsideName = `lcp-escape-${crypto.randomBytes(6).toString("hex")}.txt`;
  const outsideFile = path.join(path.dirname(workspace), outsideName);
  const absoluteFile = path.join(os.tmpdir(), `lcp-abs-${crypto.randomBytes(6).toString("hex")}.txt`);
  const outsideDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "lcp-out-"));
  try {
    let calls = 0;
    const run: CommandRunner = () => {
      calls += 1;
      return Promise.resolve({ exitCode: 0, stdout: "", stderr: "", durationMs: 1 });
    };
    const { ctx } = harness(workspace, run);
    await fs.promises.writeFile(path.join(workspace, "a.txt"), "one\ntwo\nthree\n", "utf8");

    const escape = await execute(ctx, "edit", {
      patch: ["--- /dev/null", `+++ b/../${outsideName}`, "@@ -0,0 +1 @@", "+nope", ""].join("\n"),
    });
    assert.equal(escape.receipt.status, "rejected");
    assert.equal(fs.existsSync(outsideFile), false);

    const absolute = await execute(ctx, "edit", {
      patch: ["--- /dev/null", `+++ ${absoluteFile}`, "@@ -0,0 +1 @@", "+nope", ""].join("\n"),
    });
    assert.equal(absolute.receipt.status, "rejected");
    assert.equal(fs.existsSync(absoluteFile), false);

    await fs.promises.symlink(outsideDir, path.join(workspace, "leak"));
    const linked = await execute(ctx, "edit", {
      patch: ["--- /dev/null", "+++ b/leak/pwned.txt", "@@ -0,0 +1 @@", "+nope", ""].join("\n"),
    });
    assert.equal(linked.receipt.status, "rejected");
    assert.equal(fs.existsSync(path.join(outsideDir, "pwned.txt")), false);

    const partial = await execute(ctx, "edit", {
      patch: [
        "--- /dev/null",
        "+++ b/ok.txt",
        "@@ -0,0 +1 @@",
        "+ok",
        "--- /dev/null",
        `+++ b/../${outsideName}`,
        "@@ -0,0 +1 @@",
        "+no",
        "",
      ].join("\n"),
    });
    assert.equal(partial.receipt.status, "rejected");
    assert.equal(fs.existsSync(path.join(workspace, "ok.txt")), false);
    assert.equal(fs.existsSync(outsideFile), false);

    const declared = path.join(workspace, ".controlplane", "commands.json");
    const before = await fs.promises.readFile(declared, "utf8");
    const rewrite = await execute(ctx, "edit", {
      patch: [
        "--- a/.controlplane/commands.json",
        "+++ b/.controlplane/commands.json",
        "@@ -1 +1 @@",
        `-${before.split("\n")[0]}`,
        "+{}",
        "",
      ].join("\n"),
    });
    assert.equal(rewrite.receipt.status, "rejected");
    assert.equal(await fs.promises.readFile(declared, "utf8"), before);

    const applied = await execute(ctx, "edit", {
      actor: "cursor",
      patch: [
        "--- a/a.txt",
        "+++ b/a.txt",
        "@@ -1,3 +1,3 @@",
        " one",
        "-two",
        "+TWO",
        " three",
        "",
      ].join("\n"),
    });
    assert.equal(applied.receipt.status, "passed");
    assert.equal(applied.receipt.exitCode, 0);
    assert.deepEqual(applied.receipt.diff, { files: 1, additions: 1, deletions: 1 });
    assert.equal(await fs.promises.readFile(path.join(workspace, "a.txt"), "utf8"), "one\nTWO\nthree\n");
    assert.equal(calls, 0);
    assertCompact(applied.receipt, "two");
  } finally {
    await fs.promises.rm(workspace, { recursive: true, force: true });
    await fs.promises.rm(outsideDir, { recursive: true, force: true });
    await fs.promises.rm(outsideFile, { force: true });
    await fs.promises.rm(absoluteFile, { force: true });
  }
});

test("spawn 不走 shell，星号不会被展开", async () => {
  const workspace = await tempWorkspace();
  try {
    await fs.promises.writeFile(path.join(workspace, "a.txt"), "a", "utf8");
    await fs.promises.writeFile(path.join(workspace, "b.txt"), "b", "utf8");
    const result = await spawnCommand(
      [process.execPath, "-e", "process.stdout.write(process.argv.at(-1) ?? '')", "*"],
      workspace,
    );
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "*");
  } finally {
    await fs.promises.rm(workspace, { recursive: true, force: true });
  }
});

test("失败回执跳过 TAP 套头，留下 not ok", () => {
  const stdout = [
    "TAP version 13",
    "# Subtest: 灯的下一状态是翻转",
    "not ok 1 - 灯的下一状态是翻转",
    "  ---",
    "  error: |-",
    "    Expected values to be strictly equal:",
    "  name: AssertionError",
    "  ...",
    "1..1",
    "# tests 1",
    "# fail 1",
  ].join("\n");
  const line = firstErrorSegment("", stdout);
  assert.equal(line, "not ok 1 - 灯的下一状态是翻转");
});

test("git 状态被压成分支、变更数和有限路径", () => {
  const summary = compressGitStatus("## main...origin/main [ahead 1]\n M src/a.ts\n?? b.txt\nR  old.ts -> new.ts\n");
  assert.equal(summary.branch, "main");
  assert.equal(summary.changed, 3);
  assert.deepEqual(summary.files, ["src/a.ts", "b.txt", "new.ts"]);
});

test("时间线空状态写的是真实说明", () => {
  const html = timelineHtml("nonce123");
  assert.match(html, /时间线还是空的/);
  assert.match(html, /入口/);
  assert.match(html, /动词/);
  assert.match(html, /改动摘要/);
  assert.match(html, /回执/);
  assert.match(html, /本地循环/);
  assert.match(html, /模型轮次/);
  assert.match(html, /经扩展/);
  assert.match(html, /不要把全量日志要回去/);
  assert.match(html, /正在做/);
  assert.match(html, /初始化工作区命令/);
  assert.equal(/lorem|placeholder text|TODO/i.test(html), false);
});
