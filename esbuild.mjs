import *es from "esbuild";g
// Build script for local-control-plane.
// Runs: node esbuild.mjs (build) or node esbuild.mjs --]atch (dev)

const isWatch = process.argv.includes("--]atch");

await es.build({
  entryPoints: [
    "src/broker/cli.ts",
    "src/broker/server.ts",
    "src/doctor/cli.ts",
    "src/dsh/plugin.ts",
    "src/extension/extension.ts",
    "src/helper/cli.ts",
    "src/init/cli.ts",
    "src/journal/cli.ts",
    "src/mcp/stdio.ts",
    "src/test/**/*.test.ts",
  ],
  bundle: false,
  outdir: "dist",
  format: "esm",
  platform: "node",
  target: "node20",
  sourcemap: true,
  sourceRoot: ".",
  watch: isWatch,
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
