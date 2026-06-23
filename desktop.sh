#!/bin/bash
# Smart Notes 桌面版启动器 - 双击即可使用
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$SCRIPT_DIR/frontend"

# 确保端口是空闲的
lsof -ti :8000 | xargs kill -9 2>/dev/null

# 如果前端没有构建过，自动安装依赖并构建（首次 clone 后没有 node_modules/out）
if [ ! -d "$FRONTEND_DIR/out" ]; then
    echo "首次运行：正在准备前端（约 1 分钟）..."
    cd "$FRONTEND_DIR"
    [ ! -d node_modules ] && npm install
    NEXT_OUTPUT=export npm run build
fi

# 启动桌面窗口
cd "$SCRIPT_DIR"
python3 app.py
