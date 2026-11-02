#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scaffoldWorkspace } from "./scaffold.js";

function main(): void {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(
      [
        "用法: node dist/init/cli.js [--workspace <路径>] [--force]",
        "",
        "在工作区写入 .controlplane/commands.json。",
        "会从 package.json、pytest、go、cargo、cmake、make 里认出常见命令。",
        "",
      ].join("\n"),
    );
    return;
  }
  const flag = argv.indexOf("--workspace");
  const workspace =
    flag >= 0 && argv[flag + 1] && !argv[flag + 1]!.startsWith("--")
      ? path.resolve(argv[flag + 1]!)
      : process.env.CONTROLPLANE_WORKSPACE
        ? path.resolve(process.env.CONTROLPLANE_WORKSPACE)
        : process.cwd();
  const result = scaffoldWorkspace(workspace, { force: argv.includes("--force") });
  process.stdout.write(`已写入 ${result.path}\n`);
  for (const line of result.sources) process.stdout.write(`  ${line}\n`);
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entry === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : "初始化失败";
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
}
