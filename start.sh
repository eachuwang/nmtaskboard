#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "请先安装 Node.js 22（LTS）：https://nodejs.org"
  exit 1
fi

echo "正在安装依赖（第一次会稍久）..."
npm install
echo "正在启动看板..."
exec npm start
