import { cpSync, mkdirSync } from "node:fs";
import * as esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["src/extension/extension.ts"],
  bundle: true,
  outfile: "extension/dist/extension.cjs",
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node18",
  sourcemap: true,
  logLevel: "info",
});

/** 把 broker / MCP 打进扩展目录，F5 和 VSIX 都能找到本机入口。 */
mkdirSync("extension/dist", { recursive: true });
cpSync("dist/broker", "extension/dist/broker", { recursive: true });
cpSync("dist/contract", "extension/dist/contract", { recursive: true });
cpSync("dist/mcp", "extension/dist/mcp", { recursive: true });
cpSync("dist/witness", "extension/dist/witness", { recursive: true });
cpSync("dist/journal", "extension/dist/journal", { recursive: true });
cpSync("dist/init", "extension/dist/init", { recursive: true });
cpSync("dist/doctor", "extension/dist/doctor", { recursive: true });
cpSync("dist/helper", "extension/dist/helper", { recursive: true });
