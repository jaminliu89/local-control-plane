import type { DiffStat, GitSummary } from "../contract/timeline.js";
import { EMPTY_DIFF } from "./text.js";
import { spawnCommand } from "./run.js";

const MAX_GIT_FILES = 20;

export function compressGitStatus(porcelain: string): GitSummary {
  const files: string[] = [];
  let branch = "unknown";
  for (const raw of porcelain.split(/\r?\n/)) {
    if (raw.length === 0) continue;
    if (raw.startsWith("## ")) {
      let label = raw.slice(3).split("...")[0]?.trim() ?? "unknown";
      const fresh = /^No commits yet on (.+)$/.exec(label);
      if (fresh) label = fresh[1] ?? label;
      branch = label || "unknown";
      continue;
    }
    if (raw.length < 4) continue;
    let file = raw.slice(3).trim();
    const arrow = file.lastIndexOf(" -> ");
    if (arrow >= 0) file = file.slice(arrow + 4).trim();
    if (file.length > 0) files.push(file);
  }
  return { branch, changed: files.length, files: files.slice(0, MAX_GIT_FILES) };
}

export function compressNumstat(numstat: string): DiffStat {
  let files = 0;
  let additions = 0;
  let deletions = 0;
  for (const line of numstat.split(/\r?\n/)) {
    const match = /^(\d+|-)\t(\d+|-)\t/.exec(line);
    if (!match) continue;
    files += 1;
    if (match[1] !== "-") additions += Number(match[1]);
    if (match[2] !== "-") deletions += Number(match[2]);
  }
  return { files, additions, deletions };
}

export async function readGitSummary(workspace: string): Promise<GitSummary | null> {
  const modern = await spawnCommand(
    ["git", "status", "--porcelain=v1", "-b", "--no-optional-locks"],
    workspace,
    8_000,
  );
  const result =
    modern.exitCode === 0 || !/unknown option/.test(modern.stderr)
      ? modern
      : await spawnCommand(["git", "status", "--porcelain=v1", "-b"], workspace, 8_000);
  if (result.exitCode !== 0) return null;
  return compressGitStatus(result.stdout);
}

export async function readDiffStat(workspace: string): Promise<DiffStat> {
  const result = await spawnCommand(["git", "diff", "--numstat"], workspace, 8_000);
  if (result.exitCode !== 0) return EMPTY_DIFF;
  return compressNumstat(result.stdout);
}
