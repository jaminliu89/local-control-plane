import { spawn } from "node:child_process";

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export type CommandRunner = (argv: string[], cwd: string) => Promise<CommandResult>;

const CAPTURE_CAP = 64 * 1024;

/**
 * 直接 spawn argv，shell 恒为 false。
 * stdout / stderr 只在进程内截一段，用来取第一行错误，不会放进回执。
 */
export function spawnCommand(argv: string[], cwd: string, timeoutMs = 30_000): Promise<CommandResult> {
  const started = Date.now();
  if (argv.length === 0 || argv.some((part) => typeof part !== "string" || part.length === 0)) {
    return Promise.resolve({ exitCode: 127, stdout: "", stderr: "argv 不合法", durationMs: 0 });
  }
  return new Promise((resolve) => {
    const child = spawn(argv[0], argv.slice(1), {
      cwd,
      shell: false,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    let stdout = "";
    let stderr = "";
    const take = (into: string, chunk: Buffer): string => {
      if (into.length >= CAPTURE_CAP) return into;
      return into + chunk.toString("utf8").slice(0, CAPTURE_CAP - into.length);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = take(stdout, chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = take(stderr, chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        exitCode: 127,
        stdout: "",
        stderr: error.message,
        durationMs: Date.now() - started,
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
        durationMs: Date.now() - started,
      });
    });
  });
}
