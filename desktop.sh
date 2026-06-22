#!/bin/bash
# Smart Notes 桌面版启动器 - 双击即可使用
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$HOME/Downloads/日记本"

# 确保端口是空闲的
lsof -ti :8000 | xargs kill -9 2>/dev/null

# 如果前端没有构建过，自动构建
if [ ! -d "$FRONTEND_DIR/out" ]; then
    echo "首次运行：正在构建前端（约 30 秒）..."
    cd "$FRONTEND_DIR"
    NEXT_OUTPUT=export npm run build
fi

# 启动桌面窗口
cd "$SCRIPT_DIR"
python3 app.py
