import type { AuthStatus } from "../contract/timeline.js";
import { startHelperServer, type RunningHelper } from "./server.js";

export type MockHelper = RunningHelper;

/** 仅供测试。协议与演示助手相同，不是真正的 macOS 授权。 */
export function startMockHelper(workspace: string, auth: AuthStatus): Promise<MockHelper> {
  return startHelperServer({ workspace, auth, mode: "mock" });
}
