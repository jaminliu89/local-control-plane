import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startBroker } from "../broker/server.js";
import { formatDoctorReport, runDoctor } from "../doctor/report.js";
import { startMockHelper } from "../helper/mockServer.js";

async function tempWorkspace(): Promise<string> {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), "lcp-doctor-"));
}

test("没有 commands.json 时 doctor 报告 FAIL", async () => {
  const workspace = await tempWorkspace();
  try {
    const report = await runDoctor(workspace);
    const commands = report.checks.find((check) => check.id === "commands");
    assert.equal(commands?.level, "fail");
    assert.equal(report.ok, false);
    assert.match(formatDoctorReport(report), /FAIL/);
  } finally {
    await fs.promises.rm(workspace, { recursive: true, force: true });
  }
});

test("有声明命令且 broker 在线时核心检查通过，Linux 上助手为 WARN", async () => {
  const workspace = await tempWorkspace();
  const token = crypto.randomBytes(16).toString("hex");
  const sessionId = crypto.randomBytes(4).toString("hex");
  await fs.promises.mkdir(path.join(workspace, ".controlplane"), { recursive: true });
  await fs.promises.writeFile(
    path.join(workspace, ".controlplane", "commands.json"),
    JSON.stringify({ commands: { test: [process.execPath, "--version"] } }),
  );
  const broker = await startBroker({ workspace, token, sessionId });
  try {
    const report = await runDoctor(workspace);
    assert.equal(report.ok, true);
    assert.equal(report.checks.find((check) => check.id === "commands")?.level, "ok");
    assert.equal(report.checks.find((check) => check.id === "broker")?.level, "ok");
    assert.equal(report.checks.find((check) => check.id === "helper")?.level, "warn");
    assert.match(formatDoctorReport(report), /核心检查通过/);
  } finally {
    await broker.close();
    await fs.promises.rm(workspace, { recursive: true, force: true });
  }
});

test("mock 助手 ready 时 helper 检查为 OK", async () => {
  const workspace = await tempWorkspace();
  const token = crypto.randomBytes(16).toString("hex");
  const sessionId = crypto.randomBytes(4).toString("hex");
  await fs.promises.mkdir(path.join(workspace, ".controlplane"), { recursive: true });
  await fs.promises.writeFile(
    path.join(workspace, ".controlplane", "commands.json"),
    JSON.stringify({ commands: { test: [process.execPath, "--version"] } }),
  );
  const helper = await startMockHelper(workspace, {
    state: "ready",
    screenRecording: "granted",
    accessibility: "granted",
  });
  const broker = await startBroker({ workspace, token, sessionId });
  try {
    const report = await runDoctor(workspace);
    assert.equal(report.ok, true);
    const helperCheck = report.checks.find((check) => check.id === "helper");
    assert.equal(helperCheck?.level, "ok");
    assert.match(helperCheck?.detail ?? "", /在线/);
  } finally {
    await broker.close();
    await helper.close();
    await fs.promises.rm(workspace, { recursive: true, force: true });
  }
});
