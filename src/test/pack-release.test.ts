import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("分发包脚本与安装脚本在仓库里齐全", () => {
  assert.equal(fs.existsSync(path.join(root, "scripts/pack-release.mjs")), true);
  assert.equal(fs.existsSync(path.join(root, "scripts/compose-full.mjs")), true);
  assert.equal(fs.existsSync(path.join(root, "scripts/install.sh")), true);
  assert.equal(fs.existsSync(path.join(root, "scripts/uninstall.sh")), true);
  assert.equal(fs.existsSync(path.join(root, "mac-helper/scripts/build-app.sh")), true);
  const install = fs.readFileSync(path.join(root, "scripts/install.sh"), "utf8");
  assert.match(install, /ControlPlaneHelper\.app/);
  assert.match(install, /controlplane-helper/);
  const pack = fs.readFileSync(path.join(root, "scripts/pack-release.mjs"), "utf8");
  assert.match(pack, /profile/);
  assert.match(pack, /full/);
  const compose = fs.readFileSync(path.join(root, "scripts/compose-full.mjs"), "utf8");
  assert.match(compose, /ControlPlaneHelper\.app/);
});

test("Mac 助手 Swift 源码覆盖协议路由", () => {
  const handler = fs.readFileSync(path.join(root, "mac-helper/Sources/ControlPlaneHelper/Handler.swift"), "utf8");
  for (const route of ["/v1/auth", "/v1/ui", "/v1/capture", "/v1/ax", "/v1/timeline", "/v1/auth/request"]) {
    assert.match(handler, new RegExp(route.replace("/", "\\/")));
  }
  assert.equal(fs.existsSync(path.join(root, "mac-helper/Sources/ControlPlaneHelper/Capture.swift")), true);
  assert.equal(fs.existsSync(path.join(root, "mac-helper/Sources/ControlPlaneHelper/Accessibility.swift")), true);
  assert.equal(fs.existsSync(path.join(root, "mac-helper/Sources/ControlPlaneHelper/HttpServer.swift")), true);
});
