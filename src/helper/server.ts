import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import {
  DEFAULT_HELPER_BUNDLE_ID,
  HELPER_PROTOCOL_VERSION,
  type HelperSessionHint,
} from "../contract/helper.js";
import type { AuthStatus, TimelineEvent } from "../contract/timeline.js";
import { panelDocument } from "../witness/panelHtml.js";
import { buildWitnessFrame } from "../witness/render.js";
import { authRequestNote, settingsUrlsFor, type AuthRequestWhich } from "./authLinks.js";
import { writeHelperHint } from "./client.js";

export type HelperMode = "mock" | "mac";

export interface HelperServerOptions {
  workspace: string;
  auth: AuthStatus;
  /** mock = Linux 演示；mac 留给签名助手。当前进程永远是 mock。 */
  mode?: HelperMode;
  token?: string;
  port?: number;
  /** 同时提供 Prism 构图小窗口预览。 */
  ui?: boolean;
}

export interface RunningHelper {
  hint: HelperSessionHint;
  mode: HelperMode;
  panelUrl: string | null;
  setAuth: (auth: AuthStatus) => void;
  events: () => TimelineEvent[];
  close: () => Promise<void>;
}

const MINI_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function readJson(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 2_000_000) {
        reject(new Error("请求过大"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (size === 0) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          reject(new Error("请求必须是 JSON 对象"));
          return;
        }
        resolve(parsed as Record<string, unknown>);
      } catch {
        reject(new Error("JSON 无法解析"));
      }
    });
    req.on("error", reject);
  });
}

function capturePath(workspace: string): string {
  const dir = path.join(workspace, ".controlplane", "frames");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `mock-frame-${Date.now()}.png`);
  fs.writeFileSync(file, MINI_PNG, { mode: 0o600 });
  return file;
}

/**
 * Linux / 测试用演示助手。协议与将来的签名 Mac `.app` 相同，
 * 但不调用 ScreenCaptureKit / AXUIElement，也不假装系统已授权。
 */
export function startHelperServer(options: HelperServerOptions): Promise<RunningHelper> {
  const token = options.token ?? crypto.randomBytes(24).toString("hex");
  const mode: HelperMode = options.mode ?? "mock";
  let current = options.auth;
  let events: TimelineEvent[] = [];
  const html = panelDocument();

  const server = http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const send = (code: number, payload: unknown, type = "application/json; charset=utf-8"): void => {
        const body = typeof payload === "string" ? payload : JSON.stringify(payload);
        res.writeHead(code, {
          "content-type": type,
          "content-length": Buffer.byteLength(body),
          "cache-control": "no-store",
        });
        res.end(body);
      };

      if (options.ui && req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
        send(200, html, "text/html; charset=utf-8");
        return;
      }
      if (options.ui && req.method === "GET" && url.pathname === "/frame") {
        const frame = buildWitnessFrame(events, {
          sessionId: "helper",
          host: "127.0.0.1",
          port: hintPort(),
        });
        frame.auth = current;
        frame.authLine = `${current.state}（屏幕录制 ${current.screenRecording}，辅助功能 ${current.accessibility}）`;
        send(200, frame);
        return;
      }

      const header = req.headers.authorization ?? "";
      if (header !== `Bearer ${token}`) {
        send(401, { failure: "token 不对" });
        return;
      }

      if (req.method === "GET" && url.pathname === "/v1/auth") {
        send(200, { protocol: HELPER_PROTOCOL_VERSION, auth: current });
        return;
      }
      if (req.method === "GET" && url.pathname === "/v1/health") {
        send(200, { ok: true, mode, protocol: HELPER_PROTOCOL_VERSION });
        return;
      }
      if (req.method === "GET" && url.pathname === "/v1/ui") {
        if (current.state !== "ready" && current.state !== "missing_screen") {
          send(403, { failure: "需要辅助功能授权" });
          return;
        }
        send(200, {
          outline: "Window\n  Group\n    Button 构建\n    StaticText Ready",
          nodeCount: 4,
          mode,
        });
        return;
      }
      if (req.method === "POST" && url.pathname === "/v1/capture") {
        if (current.state !== "ready" && current.state !== "missing_accessibility") {
          send(403, { failure: "需要屏幕录制授权" });
          return;
        }
        const body = await readJson(req);
        const app = body.app === "cursor" ? "cursor" : "vscode";
        send(200, {
          protocol: HELPER_PROTOCOL_VERSION,
          imagePath: capturePath(options.workspace),
          retainedUntil: new Date(Date.now() + 60_000).toISOString(),
          app,
          mode,
        });
        return;
      }
      if (req.method === "POST" && url.pathname === "/v1/ax") {
        if (current.state !== "ready" && current.state !== "missing_screen") {
          send(403, { failure: "需要辅助功能授权" });
          return;
        }
        await readJson(req);
        send(200, { ok: true, mode });
        return;
      }
      if (req.method === "POST" && url.pathname === "/v1/timeline") {
        const body = await readJson(req);
        if (body.protocol !== HELPER_PROTOCOL_VERSION) {
          send(400, { failure: "协议版本不对" });
          return;
        }
        const next = Array.isArray(body.events) ? (body.events as TimelineEvent[]) : [];
        events = next.slice(-300);
        send(200, { ok: true, count: events.length });
        return;
      }
      if (req.method === "POST" && url.pathname === "/v1/auth/request") {
        const body = await readJson(req);
        if (body.protocol !== HELPER_PROTOCOL_VERSION) {
          send(400, { failure: "协议版本不对" });
          return;
        }
        const whichRaw = body.which;
        const which: AuthRequestWhich =
          whichRaw === "screen" || whichRaw === "accessibility" || whichRaw === "both" ? whichRaw : "both";
        send(200, {
          protocol: HELPER_PROTOCOL_VERSION,
          ok: true,
          which,
          auth: current,
          openUrls: settingsUrlsFor(which),
          note: authRequestNote(mode),
          mode,
        });
        return;
      }
      send(404, { failure: "没有这个助手路由" });
    })().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "助手错误";
      if (!res.headersSent) {
        const body = JSON.stringify({ failure: message.slice(0, 180) });
        res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
        res.end(body);
      }
    });
  });

  let boundPort = 0;
  function hintPort(): number {
    return boundPort;
  }

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string" || address.address !== "127.0.0.1") {
        server.close();
        reject(new Error("助手必须绑在 127.0.0.1"));
        return;
      }
      boundPort = address.port;
      const hint: HelperSessionHint = {
        protocol: HELPER_PROTOCOL_VERSION,
        host: "127.0.0.1",
        port: address.port,
        token,
        bundleId: DEFAULT_HELPER_BUNDLE_ID,
      };
      writeHelperHint(options.workspace, hint);
      resolve({
        hint,
        mode,
        panelUrl: options.ui ? `http://127.0.0.1:${address.port}/` : null,
        setAuth: (next) => {
          current = next;
        },
        events: () => events.slice(),
        close: () =>
          new Promise((done, fail) => {
            server.close((error) => (error ? fail(error) : done()));
          }),
      });
    });
  });
}

export function authFromFlag(flag: string): AuthStatus {
  switch (flag) {
    case "ready":
      return { state: "ready", screenRecording: "granted", accessibility: "granted" };
    case "missing_screen":
      return { state: "missing_screen", screenRecording: "denied", accessibility: "granted" };
    case "missing_accessibility":
      return { state: "missing_accessibility", screenRecording: "granted", accessibility: "denied" };
    case "missing_both":
      return { state: "missing_both", screenRecording: "denied", accessibility: "denied" };
    case "helper_offline":
      return { state: "helper_offline", screenRecording: "unknown", accessibility: "unknown" };
    case "placeholder":
    default:
      return { state: "placeholder", screenRecording: "unknown", accessibility: "unknown" };
  }
}
