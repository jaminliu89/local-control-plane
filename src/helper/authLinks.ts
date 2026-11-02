/** macOS 系统设置深链。演示助手与将来的签名 .app 共用。 */
export const SCREEN_RECORDING_SETTINGS_URL =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";

export const ACCESSIBILITY_SETTINGS_URL =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility";

export type AuthRequestWhich = "screen" | "accessibility" | "both";

export function settingsUrlsFor(which: AuthRequestWhich): string[] {
  if (which === "screen") return [SCREEN_RECORDING_SETTINGS_URL];
  if (which === "accessibility") return [ACCESSIBILITY_SETTINGS_URL];
  return [SCREEN_RECORDING_SETTINGS_URL, ACCESSIBILITY_SETTINGS_URL];
}

export function authRequestNote(mode: "mock" | "mac"): string {
  if (mode === "mock") {
    return "演示助手不会改系统 TCC。可用 --auth 切换演示态；真机请装签名助手并在系统设置里授权。";
  }
  return "请在系统设置里为本机控制面助手打开对应权限。授权后助手会刷新 /v1/auth。";
}
