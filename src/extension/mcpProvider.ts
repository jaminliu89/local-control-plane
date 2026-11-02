import fs from "node:fs";
import path from "node:path";
import * as vscode from "vscode";

/** 是否具备 MCP 定义提供者 API（Cursor / 较新的 VS Code）。 */
export function canRegisterMcpProvider(): boolean {
  return typeof vscode.lm?.registerMcpServerDefinitionProvider === "function";
}

export function buildControlPlaneMcpDefinition(input: {
  label: string;
  mcpEntry: string;
  workspace: string;
  version: string;
}): vscode.McpStdioServerDefinition {
  const def = new vscode.McpStdioServerDefinition(
    input.label,
    "node",
    [input.mcpEntry],
    { CONTROLPLANE_WORKSPACE: input.workspace },
    input.version,
  );
  def.cwd = vscode.Uri.file(input.workspace);
  return def;
}

export function mcpEntryFromExtension(extensionPath: string): string | undefined {
  const inside = path.join(extensionPath, "dist", "mcp", "stdio.js");
  if (fs.existsSync(inside)) return inside;
  const sibling = path.resolve(extensionPath, "..", "dist", "mcp", "stdio.js");
  if (fs.existsSync(sibling)) return sibling;
  return undefined;
}
