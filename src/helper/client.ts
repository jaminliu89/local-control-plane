import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import {
  DEFAULT_HELPER_BUNDLE_ID,
  HELPER_PROTOCOL_VERSION,
  type HelperAuthReport,
  type HelperCaptureRequest,
  type HelperCaptureResult,
  type HelperSessionHint,
} from "../contract/helper.js";
import type { AuthStatus, TimelineEvent } from "../contract/timeline.js";
import { AUTH_HELPER_OFFLINE, AUTH_PLACEHOLDER } from "../contract/timeline.js";

export function helperHintFile(workspace: string): string {
  return path.join(workspace, ".controlplane", "helper.json");
}

export function readHelperHint(workspace: string): HelperSessionHint | null {
  const file = helperHintFile(workspace);
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<HelperSessionHint>;
    if (parsed.protocol !== HELPER_PROTOCOL_VERSION) return null;
    if (parsed.host !== "127.0.0.1") return null;
    if (typeof parsed.port !== "number" || parsed.port < 1 || parsed.port > 65535) return null;
    if (typeof parsed.token !== "string" || parsed.token.length < 16) return null;
    if (parsed.bundleId !== DEFAULT_HELPER_BUNDLE_ID) return null;
    return {
      protocol: HELPER_PROTOCOL_VERSION,
      host: "127.0.0.1",
      port: parsed.port,
      token: parsed.token,
      bundleId: DEFAULT_HELPER_BUNDLE_ID,
    };
  } catch {
    return null;
  }
}

export function writeHelperHint(workspace: string, hint: HelperSessionHint): void {
  const file = helperHintFile(workspace);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${JSON.stringify(hint)}\n`, { encoding: "utf8", mode: 0o600 });
}

function helperRequest(hint: HelperSessionHint, method: "GET" | "POST", route: string, body?: unknown): Promise<unknown> {
  const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: hint.port,
        path: route,
        method,
        headers: {
          authorization: `Bearer ${hint.token}`,
          ...(payload
            ? { "content-type": "application/json", "content-length": payload.length }
            : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let parsed: unknown = {};
          if (text.length > 0) {
            try {
              parsed = JSON.parse(text);
            } catch {
              reject(new Error("助手返回的不是 JSON"));
              return;
            }
          }
          if ((res.statusCode ?? 500) >= 400) {
            const failure =
              parsed && typeof parsed === "object" && "failure" in parsed && typeof (parsed as { failure: unknown }).failure === "string"
                ? (parsed as { failure: string }).failure
                : `助手 HTTP ${res.statusCode}`;
            reject(new Error(failure.slice(0, 180)));
            return;
          }
          resolve(parsed);
        });
      },
    );
    req.setTimeout(5_000, () => req.destroy(new Error("助手超时")));
    req.on("error", reject);
    if (payload) req.end(payload);
    else req.end();
  });
}

export async function probeHelperAuth(workspace: string): Promise<AuthStatus> {
  const hint = readHelperHint(workspace);
  if (!hint) return AUTH_PLACEHOLDER;
  try {
    const report = (await helperRequest(hint, "GET", "/v1/auth")) as HelperAuthReport;
    if (report.protocol !== HELPER_PROTOCOL_VERSION || !report.auth) return AUTH_HELPER_OFFLINE;
    return report.auth as AuthStatus;
  } catch {
    return AUTH_HELPER_OFFLINE;
  }
}

/** 把时间线推给助手小窗口。失败静默，不挡动词。 */
export async function pushTimelineToHelper(workspace: string, events: TimelineEvent[]): Promise<void> {
  const hint = readHelperHint(workspace);
  if (!hint) return;
  try {
    await helperRequest(hint, "POST", "/v1/timeline", {
      protocol: HELPER_PROTOCOL_VERSION,
      events: events.slice(-80),
    });
  } catch {
    // 助手离线时扩展和见证仍可读 broker。
  }
}

export interface HelperAuthRequestResult {
  ok: true;
  which: "screen" | "accessibility" | "both";
  auth: AuthStatus;
  openUrls: string[];
  note: string;
  mode?: string;
}

/** 请助手引导用户去系统设置授权。演示助手只返回深链与说明。 */
export async function requestHelperAuth(
  workspace: string,
  which: "screen" | "accessibility" | "both" = "both",
): Promise<HelperAuthRequestResult> {
  const hint = requireHint(workspace);
  const body = (await helperRequest(hint, "POST", "/v1/auth/request", {
    protocol: HELPER_PROTOCOL_VERSION,
    which,
  })) as Partial<HelperAuthRequestResult>;
  if (!body.ok || !Array.isArray(body.openUrls)) {
    throw new Error("助手授权引导应答不完整");
  }
  return {
    ok: true,
    which: body.which === "screen" || body.which === "accessibility" || body.which === "both" ? body.which : which,
    auth: (body.auth as AuthStatus) ?? AUTH_PLACEHOLDER,
    openUrls: body.openUrls.filter((item): item is string => typeof item === "string"),
    note: typeof body.note === "string" ? body.note : "",
    mode: typeof body.mode === "string" ? body.mode : undefined,
  };
}

export async function helperObserveUi(workspace: string): Promise<{ outline: string; nodeCount: number }> {
  const hint = requireHint(workspace);
  const body = (await helperRequest(hint, "GET", "/v1/ui")) as { outline?: string; nodeCount?: number };
  const outline = typeof body.outline === "string" ? body.outline.slice(0, 1800) : "";
  const nodeCount = typeof body.nodeCount === "number" ? Math.max(0, Math.floor(body.nodeCount)) : 0;
  return { outline, nodeCount };
}

export async function helperCaptureWindow(
  workspace: string,
  request: Omit<HelperCaptureRequest, "protocol">,
): Promise<HelperCaptureResult> {
  const hint = requireHint(workspace);
  const body = (await helperRequest(hint, "POST", "/v1/capture", {
    protocol: HELPER_PROTOCOL_VERSION,
    ...request,
  })) as HelperCaptureResult;
  if (body.protocol !== HELPER_PROTOCOL_VERSION || typeof body.imagePath !== "string") {
    throw new Error("助手截帧应答不完整");
  }
  return body;
}

export async function helperPerformAx(
  workspace: string,
  input: { action: "press" | "set_value" | "type"; target: string; value?: string },
): Promise<{ ok: true }> {
  const hint = requireHint(workspace);
  const body = (await helperRequest(hint, "POST", "/v1/ax", {
    protocol: HELPER_PROTOCOL_VERSION,
    ...input,
  })) as { ok?: boolean; failure?: string };
  if (!body.ok) throw new Error(body.failure ?? "辅助功能动作失败");
  return { ok: true };
}

function requireHint(workspace: string): HelperSessionHint {
  const hint = readHelperHint(workspace);
  if (!hint) {
    throw new Error("需要 Mac 菜单栏助手。Linux 上没有屏幕录制 / 辅助功能；请在 Mac 上安装签名助手。");
  }
  return hint;
}
