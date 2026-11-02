import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { discoverCommands, scaffoldWorkspace } from "../init/scaffold.js";

test("从 package.json 收出 test 和 compile", async () => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "lcp-init-"));
  try {
    await fs.promises.writeFile(
      path.join(dir, "package.json"),
      JSON.stringify({
        scripts: {
          test: "node --test",
          compile: "tsc -p .",
          lint: "eslint .",
        },
      }),
    );
    const found = discoverCommands(dir);
    assert.deepEqual(found.commands.test, ["npm", "run", "test"]);
    assert.deepEqual(found.commands.compile, ["npm", "run", "compile"]);
    assert.deepEqual(found.commands.lint, ["npm", "run", "lint"]);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
});

test("scaffold 写入 commands.json，重复调用需 --force", async () => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "lcp-init-"));
  try {
    await fs.promises.writeFile(path.join(dir, "go.mod"), "module example\n");
    const first = scaffoldWorkspace(dir);
    assert.equal(first.created, true);
    assert.deepEqual(first.commands.gotest, ["go", "test", "./..."]);
    const raw = JSON.parse(await fs.promises.readFile(first.path, "utf8")) as {
      commands: Record<string, string[]>;
    };
    assert.deepEqual(raw.commands.gotest, ["go", "test", "./..."]);
    assert.throws(() => scaffoldWorkspace(dir), /已存在/);
    const again = scaffoldWorkspace(dir, { force: true });
    assert.equal(again.created, true);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
});
