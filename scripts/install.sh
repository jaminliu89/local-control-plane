#!/usr/bin/env bash
# 本机控制面安装脚本。由 npm run pack / pack:full 打进分发包根目录。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
VERSION_FILE="$ROOT/VERSION"
VERSION="$(tr -d '[:space:]' <"$VERSION_FILE" 2>/dev/null || echo "0.0.0")"
PROFILE="$(tr -d '[:space:]' <"$ROOT/PROFILE" 2>/dev/null || echo "lite")"
VSIX="$ROOT/local-control-plane-${VERSION}.vsix"
PREFIX="${CONTROLPLANE_PREFIX:-$HOME/.local}"
BIN_DIR="$PREFIX/bin"
SHARE_DIR="$PREFIX/share/local-control-plane"
MAC_APP_SRC="$ROOT/ControlPlaneHelper.app"
MAC_APP_DST="${CONTROLPLANE_MAC_APP_DIR:-$HOME/Applications}/ControlPlaneHelper.app"

die() {
  printf '%s\n' "$*" >&2
  exit 1
}

need_node() {
  command -v node >/dev/null 2>&1 || die "需要 Node.js >= 18。先安装 Node 再跑安装。"
  local major
  major="$(node -p "process.versions.node.split('.')[0]")"
  if [[ "$major" -lt 18 ]]; then
    die "需要 Node.js >= 18，当前 $(node -v)"
  fi
}

find_editor() {
  if [[ -n "${CONTROLPLANE_EDITOR:-}" ]]; then
    command -v "$CONTROLPLANE_EDITOR" >/dev/null 2>&1 || die "CONTROLPLANE_EDITOR=$CONTROLPLANE_EDITOR 不在 PATH"
    printf '%s\n' "$CONTROLPLANE_EDITOR"
    return
  fi
  if command -v cursor >/dev/null 2>&1; then
    printf '%s\n' cursor
    return
  fi
  if command -v code >/dev/null 2>&1; then
    printf '%s\n' code
    return
  fi
  printf '%s\n' ""
}

install_vsix() {
  [[ -f "$VSIX" ]] || die "找不到 $VSIX"
  local editor
  editor="$(find_editor)"
  if [[ -z "$editor" ]]; then
    printf '未找到 cursor 或 code 命令。请手动安装扩展：\n  %s\n' "$VSIX"
    return 0
  fi
  printf '用 %s 安装扩展…\n' "$editor"
  "$editor" --install-extension "$VSIX"
}

write_bin() {
  local name="$1"
  local rel="$2"
  local target="$BIN_DIR/controlplane-$name"
  cat >"$target" <<EOF
#!/usr/bin/env bash
exec node "$SHARE_DIR/dist/$rel" "\$@"
EOF
  chmod +x "$target"
}

install_runtime() {
  mkdir -p "$BIN_DIR"
  rm -rf "$SHARE_DIR"
  mkdir -p "$SHARE_DIR"
  cp -R "$ROOT/dist" "$SHARE_DIR/dist"
  cp -R "$ROOT/dsh-plugin" "$SHARE_DIR/dsh-plugin"
  cp -R "$ROOT/mac-helper" "$SHARE_DIR/mac-helper"
  cp "$ROOT/README.md" "$SHARE_DIR/README.md"
  cp "$ROOT/INSTALL.md" "$SHARE_DIR/INSTALL.md"
  cp "$VERSION_FILE" "$SHARE_DIR/VERSION"
  [[ -f "$ROOT/PROFILE" ]] && cp "$ROOT/PROFILE" "$SHARE_DIR/PROFILE"
  if [[ -d "$ROOT/docs" ]]; then
    cp -R "$ROOT/docs" "$SHARE_DIR/docs"
  fi

  write_bin mcp mcp/stdio.js
  write_bin witness witness/watch.js
  write_bin broker broker/cli.js
  write_bin journal journal/cli.js
  write_bin init init/cli.js
  write_bin doctor doctor/cli.js
  write_bin helper helper/cli.js
}

install_mac_app() {
  if [[ ! -d "$MAC_APP_SRC" ]]; then
    printf '本包无 ControlPlaneHelper.app（profile=%s）。Mac 真机可稍后 compose:full。\n' "$PROFILE"
    return 0
  fi
  if [[ "$(uname -s)" != "Darwin" ]]; then
    printf '检测到 ControlPlaneHelper.app，但当前不是 macOS，已跳过安装到 Applications。\n'
    mkdir -p "$SHARE_DIR"
    rm -rf "$SHARE_DIR/ControlPlaneHelper.app"
    cp -R "$MAC_APP_SRC" "$SHARE_DIR/ControlPlaneHelper.app"
    return 0
  fi
  mkdir -p "$(dirname "$MAC_APP_DST")"
  rm -rf "$MAC_APP_DST"
  cp -R "$MAC_APP_SRC" "$MAC_APP_DST"
  printf '已安装菜单栏助手：%s\n' "$MAC_APP_DST"
}

print_next() {
  cat <<EOF

已安装本机控制面 ${VERSION}（${PROFILE}）

扩展：已尝试装进 Cursor / VS Code（见上方输出）
CLI：${BIN_DIR}/controlplane-{mcp,witness,broker,journal,init,doctor,helper}
运行时：${SHARE_DIR}
EOF
  if [[ -d "$MAC_APP_DST" ]]; then
    cat <<EOF
Mac 助手：${MAC_APP_DST}
  open "${MAC_APP_DST}" --args --workspace "<工作区>" --ui
EOF
  elif [[ -d "$SHARE_DIR/ControlPlaneHelper.app" ]]; then
    cat <<EOF
Mac 助手（已放到运行时目录，待拷到 macOS）：
  ${SHARE_DIR}/ControlPlaneHelper.app
EOF
  else
    cat <<EOF
Mac 助手：本包未含 .app。真机构建后 npm run compose:full
EOF
  fi
  cat <<EOF

请确认 ${BIN_DIR} 在 PATH 里，例如：
  export PATH="${BIN_DIR}:\$PATH"

下一步：
  1. 用 Cursor / VS Code 打开并信任一个工作区
  2. 命令面板运行「本机控制面: 初始化工作区命令」
  3. 命令面板运行「本机控制面: 运行 doctor 自检」
  4. Linux 演示助手：controlplane-helper --workspace <路径> --auth ready --ui

卸载：
  ./uninstall.sh
EOF
}

main() {
  need_node
  install_vsix
  install_runtime
  install_mac_app
  print_next
}

main "$@"
