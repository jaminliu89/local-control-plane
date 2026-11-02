import type { AuthStatus, TimelineEvent } from "./timeline.js";

/**
 * Mac 菜单栏助手要讲的本机协议。
 *
 * Linux 上不实现签名 .app，也不假装已经拿到屏幕录制 / 辅助功能。
 * 下一刀在 Mac 上用固定 Bundle ID 实现这些端点，并订阅同一条时间线。
 */
export const HELPER_PROTOCOL_VERSION = 1 as const;

/** 助手只听 127.0.0.1。扩展 / broker 用窗口 token 呼叫它。 */
export interface HelperSessionHint {
  protocol: typeof HELPER_PROTOCOL_VERSION;
  host: "127.0.0.1";
  port: number;
  token: string;
  bundleId: "local.ide-control.helper";
}

export interface HelperAuthReport {
  protocol: typeof HELPER_PROTOCOL_VERSION;
  auth: AuthStatus | {
    state: "ready" | "missing_screen" | "missing_accessibility" | "missing_both";
    screenRecording: "granted" | "denied" | "unknown";
    accessibility: "granted" | "denied" | "unknown";
  };
}

export interface HelperCaptureRequest {
  protocol: typeof HELPER_PROTOCOL_VERSION;
  /** 只订 VS Code / Cursor 窗口；不订整块桌面。 */
  app: "vscode" | "cursor";
  windowTitleIncludes?: string;
}

export interface HelperCaptureResult {
  protocol: typeof HELPER_PROTOCOL_VERSION;
  /** 本机路径。默认不进模型上下文。 */
  imagePath: string;
  retainedUntil: string;
}

export interface HelperTimelinePush {
  protocol: typeof HELPER_PROTOCOL_VERSION;
  /** 小原生窗口与侧边栏读同一份事件。 */
  events: TimelineEvent[];
}

export interface HelperAuthRequest {
  protocol: typeof HELPER_PROTOCOL_VERSION;
  which: "screen" | "accessibility" | "both";
}

export interface HelperAuthRequestResult {
  protocol: typeof HELPER_PROTOCOL_VERSION;
  ok: true;
  which: "screen" | "accessibility" | "both";
  auth: AuthStatus;
  /** macOS 系统设置深链。 */
  openUrls: string[];
  note: string;
}

export const DEFAULT_HELPER_BUNDLE_ID = "local.ide-control.helper" as const;
