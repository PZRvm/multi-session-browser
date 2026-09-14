#!/usr/bin/env bash
# 重签 dev 态 Electron 二进制（macOS 专属，其他平台直接跳过）。
#
# 背景：node_modules/electron/dist/Electron.app 官方分发即 ad-hoc 签名（linker-signed），
# macOS TCC 对 ad-hoc 应用的摄像头/麦克风授权弹窗与记录极不可靠（秒拒、弹窗时有时无、
# 授权无法落库），导致 npm run dev 下会话网页摄像头功能不可用。
# 用本机钥匙串里的真实证书重签后，TCC 弹窗可靠出现且授权持久生效。
#
# 用法：npm install（或任何重装 electron 二进制的操作）之后执行一次：
#   bash scripts/sign-electron-dev.sh
#
# 说明：
# - 只在 darwin + 已配置 codesigning 证书时生效；否则静默跳过（不影响 CI/非 mac 环境）
# - 证书 identities 可用 `security find-identity -v -p codesigning` 查看，改 SIGNTURE_FILTER
#   即可换用团队内其他证书
# - 重签只影响本机 node_modules 内的二进制，不进 git；打包产物由 electron-builder 按其
#   自身 identity 配置签名，与本脚本无关

set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  exit 0
fi

APP="node_modules/electron/dist/Electron.app"
if [[ ! -d "$APP" ]]; then
  echo "[sign-electron-dev] 未找到 $APP，跳过（尚未安装依赖？）"
  exit 0
fi

# 已是真实签名（非 ad-hoc）则无需重签
if ! codesign -dv "$APP" 2>&1 | grep -q "Signature=adhoc"; then
  echo "[sign-electron-dev] $APP 已是真实签名，跳过"
  exit 0
fi

# 取钥匙串里第一把可用的 codesigning 证书（优先 Apple Development / Developer ID）
IDENTITY=$(security find-identity -v -p codesigning 2>/dev/null | awk -F'"' '/Apple Development|Developer ID/ {print $2; exit}')
if [[ -z "$IDENTITY" ]]; then
  echo "[sign-electron-dev] 钥匙串中无可用 codesigning 证书，跳过重签。" \
    "dev 模式摄像头/麦克风授权将不可用（TCC 不信任 ad-hoc 签名）。"
  exit 1
fi

echo "[sign-electron-dev] 用「$IDENTITY」重签 $APP ..."
codesign --force --deep --sign "$IDENTITY" "$APP"

# 清掉该 bundle 旧的 TCC 授权残留（签名变了旧记录不再匹配）
tccutil reset Camera com.github.Electron >/dev/null 2>&1 || true
tccutil reset Microphone com.github.Electron >/dev/null 2>&1 || true

echo "[sign-electron-dev] 完成。首次在 dev 中触发摄像头/麦克风时，" \
  "请在系统弹窗中点「允许」（每个身份只需一次）。"
