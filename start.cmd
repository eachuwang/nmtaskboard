@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo 请先安装 Node.js 22（LTS）：https://nodejs.org
  echo 安装完成后重新双击本文件。
  pause
  exit /b 1
)

echo 正在安装依赖（第一次会稍久，请保持窗口打开）...
call npm install
if errorlevel 1 (
  echo 依赖安装失败。请检查网络后重试。
  pause
  exit /b 1
)

echo 正在启动看板...
call npm start
echo.
pause
