#!/bin/bash
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$HOME/Downloads/日记本"

echo "启动 Smart Notes..."
echo ""

# 启动 Python 后端
echo "[1/2] 启动后端 API (端口 8000)..."
cd "$SCRIPT_DIR"
python3 -m uvicorn api:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!

sleep 2

# 启动前端
echo "[2/2] 启动前端 (端口 3000)..."
cd "$FRONTEND_DIR"
npm run dev &
FRONTEND_PID=$!

echo ""
echo "✓ 已启动！请在浏览器打开 http://localhost:3000"
echo "  按 Ctrl+C 退出"
echo ""

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; echo '已退出'" INT TERM
wait
