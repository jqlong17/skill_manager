#!/bin/bash
# 将项目内 Skill管理器.app 的 Resources 同步到「应用程序」中的副本
SCRIPT_DIR="$(dirname "$0")"
PROJECT_RESOURCES="$SCRIPT_DIR/Contents/Resources"
APP_APPLICATIONS="/Applications/Skill管理器.app"
APP_RESOURCES="$APP_APPLICATIONS/Contents/Resources"

if [[ ! -d "$APP_RESOURCES" ]]; then
  APP_APPLICATIONS="$HOME/Applications/Skill管理器.app"
  APP_RESOURCES="$APP_APPLICATIONS/Contents/Resources"
fi

if [[ -d "$APP_RESOURCES" ]]; then
  cp "$PROJECT_RESOURCES/index.html" "$APP_RESOURCES/" 2>/dev/null && echo "已同步 index.html"
  cp "$PROJECT_RESOURCES/server.js"   "$APP_RESOURCES/" 2>/dev/null && echo "已同步 server.js"
  cp "$PROJECT_RESOURCES/config.json" "$APP_RESOURCES/" 2>/dev/null && echo "已同步 config.json"
  echo "已更新应用程序中的 Skill管理器.app"
else
  echo "未找到 Skill管理器.app（已检查 /Applications 与 ~/Applications）"
fi
