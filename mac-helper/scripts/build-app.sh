#!/usr/bin/env bash
# 在 macOS 上把 Swift 产物打成 ControlPlaneHelper.app（可再 codesign）。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="${CONTROLPLANE_MAC_DIST:-$ROOT/dist}"
APP="$DIST/ControlPlaneHelper.app"
BIN_NAME="ControlPlaneHelper"
IDENTITY="${CONTROLPLANE_CODESIGN_IDENTITY:-}"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "build-app.sh 只能在 macOS 上跑。Linux 请用 npm run helper 演示协议，或把真机打好的 .app 交给 npm run pack:full。" >&2
  exit 2
fi

command -v swift >/dev/null || { echo "需要 swift" >&2; exit 1; }

cd "$ROOT"
echo "swift build -c release …"
swift build -c release

BIN="$(swift build -c release --show-bin-path)/$BIN_NAME"
[[ -f "$BIN" ]] || { echo "找不到二进制 $BIN" >&2; exit 1; }

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/$BIN_NAME"
chmod +x "$APP/Contents/MacOS/$BIN_NAME"
cp "$ROOT/Resources/Info.plist" "$APP/Contents/Info.plist"
cp "$ROOT/Resources/ControlPlaneHelper.entitlements" "$APP/Contents/Resources/ControlPlaneHelper.entitlements"

# PkgInfo
printf 'APPL????' >"$APP/Contents/PkgInfo"

if [[ -n "$IDENTITY" ]]; then
  echo "codesign with $IDENTITY …"
  codesign --force --deep --options runtime \
    --entitlements "$ROOT/Resources/ControlPlaneHelper.entitlements" \
    --sign "$IDENTITY" \
    "$APP"
  codesign --verify --verbose=2 "$APP"
else
  echo "未设置 CONTROLPLANE_CODESIGN_IDENTITY，产出未签名 .app（开发用）。"
fi

# 方便 pack:full 发现
mkdir -p "$ROOT/../release/artifacts"
rm -rf "$ROOT/../release/artifacts/ControlPlaneHelper.app"
cp -R "$APP" "$ROOT/../release/artifacts/ControlPlaneHelper.app"

echo "完成：$APP"
echo "运行示例："
echo "  open \"$APP\" --args --workspace \"\$PWD\" --ui"
