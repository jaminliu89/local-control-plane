import { timingSafeEqual } from "node:crypto";
import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { BrokerSession } from "../contract/session.js";
import { AUTH_PLACEHOLDER, type DiagnosticCounts, type TimelineEvent, type WorkspaceSnapshot } from "../contract/timeline.js";
import { probeHelperAuth, pushTimelineToHelper } from "../helper/client.js";
import { spawnCommand, type CommandRunner } from "./run.js";
import { clearCurrent, timelineFile, writeCurrent, writeSessionFile } from "./session.js";
import { FileTimelineStore, type TimelineStore } from "./store.js";
import { emptySnapshot, execute, type VerbContext } from "./verbs.js";

/** 追加后把事件推给助手小窗口。失败不挡动词。 */
class HelperPushStore implements TimelineStore {
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly inner: TimelineStore,
    private readonly workspace: string,
  ) {}

  append(event: TimelineEvent): void {
    this.inner.append(event);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void pushTimelineToHelper(this.workspace, this.inner.list());
    }, 40);
  }

  list(): TimelineEvent[] {
    return this.inner.list();
  }
}

const POST_ROUTES = new Set([
  "observe",
  "edit",
  "terminal",
  "verify",
  "trace",
  "observe_ui",
  "capture_window",
  "perform_ax",
  "snapshot",
]);
const BODY_LIMIT = 1024 * 1024;

export interface RunningBroker {
  host: "127.0.0.1";
  port: number;
  close: () => Promise<void>;
}

export interface BrokerOptions {
  workspace: string;
  token: string;
  sessionId: string;
  port?: number;
  run?: CommandRunner;
}

function tokenMatches(expected: string, got: string | undefined): boolean {
  if (!got) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(got);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function bearer(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization;
  if (typeof header !== "string") return undefined;
  const match = /^Bearer (\S+)$/.exec(header);
  return match?.[1];
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > BODY_LIMIT) throw new Error("请求过大");
    chunks.push(buffer);
  }
  if (size === 0) return {};
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("请求必须是 JSON 对象");
  return parsed as Record<string, unknown>;
}

function numberCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return 0;
  return Math.min(100_000, Math.floor(value));
}

function parseSnapshot(body: Record<string, unknown>): WorkspaceSnapshot {
  const editors = Array.isArray(body.editors)
    ? body.editors.filter((item): item is string => typeof item === "string").map((item) => item.slice(0, 180)).slice(0, 30)
    : [];
  const diagnostics = (body.diagnostics ?? {}) as Partial<DiagnosticCounts>;
  return {
    editors,
    diagnostics: {
      error: numberCount(diagnostics.error),
      warning: numberCount(diagnostics.warning),
      info: numberCount(diagnostics.info),
      hint: numberCount(diagnostics.hint),
    },
  };
}

export function startBroker(options: BrokerOptions): Promise<RunningBroker> {
  if (!/^[A-Za-z0-9._~-]{16,128}$/.test(options.token)) {
    return Promise.reject(new Error("token 不合法"));
  }
  const snapshot = emptySnapshot();
  const store = new HelperPushStore(
    new FileTimelineStore(timelineFile(options.workspace, options.sessionId)),
    options.workspace,
  );
  const ctx: VerbContext = {
    workspace: options.workspace,
    store,
    run: options.run ?? spawnCommand,
    snapshot,
    auth: AUTH_PLACEHOLDER,
  };

  const server = http.createServer((req, res) => {
    void handle(req, res).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "请求失败";
      if (!res.headersSent) {
        sendJson(res, 400, {
          receipt: {
            status: "rejected",
            exitCode: null,
            failure: message.slice(0, 180),
            diff: { files: 0, additions: 0, deletions: 0 },
            durationMs: 0,
          },
        });
      } else {
        res.end();
      }
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!tokenMatches(options.token, bearer(req))) {
      sendJson(res, 401, {
        receipt: {
          status: "rejected",
          exitCode: null,
          failure: "token 不对",
          diff: { files: 0, additions: 0, deletions: 0 },
          durationMs: 0,
        },
      });
      return;
    }
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const route = url.pathname.replace(/^\/v1\//, "");
    if (req.method === "GET" && route === "health") {
      sendJson(res, 200, { ok: true, host: "127.0.0.1" });
      return;
    }
    if (req.method === "GET" && route === "timeline") {
      sendJson(res, 200, { events: store.list() });
      return;
    }
    if (req.method === "GET" && route === "auth") {
      ctx.auth = await probeHelperAuth(options.workspace);
      sendJson(res, 200, { auth: ctx.auth });
      return;
    }
    if (req.method !== "POST" || !POST_ROUTES.has(route)) {
      sendJson(res, 404, {
        receipt: {
          status: "rejected",
          exitCode: null,
          failure: "没有这个动词",
          diff: { files: 0, additions: 0, deletions: 0 },
          durationMs: 0,
        },
      });
      return;
    }
    const body = await readBody(req);
    if (route === "snapshot") {
      const next = parseSnapshot(body);
      snapshot.editors = next.editors;
      snapshot.diagnostics = next.diagnostics;
      sendJson(res, 200, { ok: true });
      return;
    }
    const outcome = await execute(ctx, route, body);
    const payload: {
      receipt: typeof outcome.receipt;
      summary?: typeof outcome.summary;
      ui?: typeof outcome.ui;
      artifact?: typeof outcome.artifact;
      auth?: typeof ctx.auth;
    } = { receipt: outcome.receipt, auth: ctx.auth };
    if (outcome.summary) payload.summary = outcome.summary;
    if (outcome.ui) payload.ui = outcome.ui;
    if (outcome.artifact) payload.artifact = outcome.artifact;
    sendJson(res, 200, payload);
  }

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string" || address.address !== "127.0.0.1") {
        server.close();
        reject(new Error("broker 必须绑在 127.0.0.1"));
        return;
      }
      const session: BrokerSession = {
        id: options.sessionId,
        host: "127.0.0.1",
        port: address.port,
        token: options.token,
        pid: process.pid,
      };
      writeSessionFile(options.workspace, session);
      writeCurrent(options.workspace, options.sessionId);
      resolve({
        host: "127.0.0.1",
        port: address.port,
        close: () =>
          new Promise((done, fail) => {
            clearCurrent(options.workspace, options.sessionId);
            server.close((error) => (error ? fail(error) : done()));
          }),
      });
    });
  });
}
