import fs from "node:fs";
import path from "node:path";

export class PathEscapeError extends Error {
  readonly path: string;

  constructor(candidate: string) {
    super(`补丁路径越出工作区：${candidate}`);
    this.name = "PathEscapeError";
    this.path = candidate;
  }
}

export class ProtectedPathError extends Error {
  constructor(candidate: string) {
    super(`不能用补丁修改控制面文件：${candidate}`);
    this.name = "ProtectedPathError";
  }
}

function escapes(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  );
}

function isControlPlanePath(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === ".controlplane" || relative.startsWith(`.controlplane${path.sep}`);
}

/**
 * 把补丁路径解析到工作区里面。
 * 绝对路径、`..`、以及指向工作区外的符号链接都拒绝。
 * `.controlplane` 也拒绝，避免补丁改写命令声明或会话 token。
 */
export function resolveInsideWorkspace(workspace: string, candidate: string): string {
  if (typeof candidate !== "string" || candidate.length === 0 || candidate.includes("\0")) {
    throw new PathEscapeError(String(candidate));
  }
  const root = fs.realpathSync(workspace);
  const lexical = path.resolve(root, candidate);
  if (escapes(root, lexical)) throw new PathEscapeError(candidate);

  const suffixes: string[] = [];
  let current = lexical;
  while (true) {
    if (fs.existsSync(current)) {
      const real = fs.realpathSync(current);
      if (escapes(root, real)) throw new PathEscapeError(candidate);
      const rebuilt = path.resolve(real, ...suffixes.reverse());
      if (escapes(root, rebuilt)) throw new PathEscapeError(candidate);
      if (isControlPlanePath(root, rebuilt) || isControlPlanePath(root, lexical)) {
        throw new ProtectedPathError(candidate);
      }
      return rebuilt;
    }
    const parent = path.dirname(current);
    if (parent === current) throw new PathEscapeError(candidate);
    suffixes.push(path.basename(current));
    current = parent;
  }
}
