import fs from "node:fs";
import path from "node:path";

export type CommandMap = Record<string, string[]>;

export interface ScaffoldResult {
  commands: CommandMap;
  created: boolean;
  path: string;
  sources: string[];
}

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
}

function add(commands: CommandMap, sources: string[], id: string, argv: string[], source: string): void {
  if (commands[id]) return;
  if (argv.some((part) => part.length === 0)) return;
  commands[id] = argv;
  sources.push(`${id} ← ${source}`);
}

/** 从常见项目文件收出声明命令。不执行任何东西，只写 argv。 */
export function discoverCommands(workspace: string): { commands: CommandMap; sources: string[] } {
  const commands: CommandMap = {};
  const sources: string[] = [];
  const pkgFile = path.join(workspace, "package.json");
  if (fs.existsSync(pkgFile)) {
    const pkg = readJson(pkgFile) as { scripts?: Record<string, string> };
    const scripts = pkg.scripts ?? {};
    const mapping: Array<[string, string]> = [
      ["test", "test"],
      ["compile", "compile"],
      ["build", "build"],
      ["lint", "lint"],
      ["typecheck", "typecheck"],
      ["check", "check"],
    ];
    for (const [id, script] of mapping) {
      if (typeof scripts[script] === "string") {
        add(commands, sources, id, ["npm", "run", script], `package.json#scripts.${script}`);
      }
    }
  }

  if (fs.existsSync(path.join(workspace, "pytest.ini")) || fs.existsSync(path.join(workspace, "pyproject.toml"))) {
    add(commands, sources, "pytest", ["python", "-m", "pytest", "-q"], "python 项目");
  }
  if (fs.existsSync(path.join(workspace, "go.mod"))) {
    add(commands, sources, "gotest", ["go", "test", "./..."], "go.mod");
  }
  if (fs.existsSync(path.join(workspace, "Cargo.toml"))) {
    add(commands, sources, "cargo-test", ["cargo", "test"], "Cargo.toml");
  }
  if (fs.existsSync(path.join(workspace, "CMakeLists.txt"))) {
    add(commands, sources, "cmake-build", ["cmake", "--build", "build"], "CMakeLists.txt");
  }
  if (fs.existsSync(path.join(workspace, "Makefile")) || fs.existsSync(path.join(workspace, "makefile"))) {
    add(commands, sources, "make-test", ["make", "test"], "Makefile");
  }

  return { commands, sources };
}

export function scaffoldWorkspace(workspace: string, options: { force?: boolean } = {}): ScaffoldResult {
  const dir = path.join(workspace, ".controlplane");
  const file = path.join(dir, "commands.json");
  if (fs.existsSync(file) && !options.force) {
    throw new Error(`${file} 已存在。若要覆盖，加 --force。`);
  }
  const { commands, sources } = discoverCommands(workspace);
  if (Object.keys(commands).length === 0) {
    commands.check = ["node", "-e", "console.log('ok');"];
    sources.push("check ← 默认占位（项目里没识别到常见脚本）");
  }
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${JSON.stringify({ commands }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return { commands, created: true, path: file, sources };
}
