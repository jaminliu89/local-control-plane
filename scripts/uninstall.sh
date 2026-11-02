#!/usr/bin/env bash
# 本机控制面卸载脚本。由 npm run pack 打进分发包根目录。
set -euo pipefail

PREFIX="${CONTROLPLANE_PREFIX:-$HOME/.local}"
BIN_DIR="$PREFIX/bin"
SHARE_DIR="$PREFIX/share/local-control-plane"
MAC_APP_DST="${CONTROLPLANE_MAC_APP_DIR:-$HOME/Applications}/ControlPlaneHelper.app"

find_editor() {
  if [[ -n "${CONTROLPLANE_EDITOR:-}" ]]; then
    command -v "$CONTROLPLANE_EDITOR" >/dev/null 2>&1 && { printf '%s\n' "$CONTROLPLANE_EDITOR"; return; }
  fi
  if command -v cursor >/dev/null 2>&1; then printf '%s\n' cursor; return; fi
  if command -v code >/dev/null 2>&1; then printf '%s\n' code; return; fi
  printf '%s\n' ""
}

editor="$(find_editor)"
if [[ -n "$editor" ]]; then
  "$editor" --uninstall-extension local-control-plane.local-control-plane >/dev/null 2>&1 || true
fi

rm -f \
  "$BIN_DIR/controlplane-mcp" \
  "$BIN_DIR/controlplane-witness" \
  "$BIN_DIR/controlplane-broker" \
  "$BIN_DIR/controlplane-journal" \
  "$BIN_DIR/controlplane-init" \
  "$BIN_DIR/controlplane-doctor" \
  "$BIN_DIR/controlplane-helper"
rm -rf "$SHARE_DIR"

if [[ -d "$MAC_APP_DST" ]]; then
  rm -rf "$MAC_APP_DST"
  printf '已移除 %s\n' "$MAC_APP_DST"
fi

printf '已移除 CLI 与 %s。若扩展仍在，请在编辑器里手动卸载「本机控制面」。\n' "$SHARE_DIR"
