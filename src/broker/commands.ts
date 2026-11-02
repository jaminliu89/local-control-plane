import fs from "node:fs";
import path from "node:path";

const ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const MAX_BYTES = 256 * 1024;

export function commandsFile(workspace: string): string {
  return path.join(workspace, ".controlplane", "commands.json");
}

/** 读取工作区声明的 argv。文件不存在时返回空表，调用方据此拒绝执行。 */
export function loadCommands(workspace: string): Map<string, string[]> {
  const file = commandsFile(workspace);
  if (!fs.existsSync(file)) return new Map();
  const stat = fs.statSync(file);
  if (!stat.isFile()) throw new Error("commands.json 不是文件");
  if (stat.size > MAX_BYTES) throw new Error("commands.json 过大");
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw new Error("commands.json 无法解析");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("commands.json 格式不对");
  }
  const commands = (parsed as { commands?: unknown }).commands;
  if (!commands || typeof commands !== "object" || Array.isArray(commands)) {
    throw new Error("commands.json 缺少 commands 对象");
  }
  const map = new Map<string, string[]>();
  for (const [id, argv] of Object.entries(commands)) {
    if (!ID_PATTERN.test(id)) throw new Error(`命令 id 不合法：${id}`);
    if (!Array.isArray(argv) || argv.length === 0 || argv.some((part) => typeof part !== "string" || part.length === 0)) {
      throw new Error(`命令 ${id} 的 argv 必须是非空字符串数组`);
    }
    map.set(id, argv);
  }
  return map;
}

export function isCommandId(value: string): boolean {
  return ID_PATTERN.test(value);
}
