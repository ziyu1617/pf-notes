#!/usr/bin/env python3
"""Smart Notes Desktop - 原生窗口启动器
启动 FastAPI 后端 + 静态前端，然后用 PyWebView 打开原生桌面窗口。
"""

import threading
import time
import socket
import sys
import webview
import uvicorn
from api import app, FRONTEND_DIR


def wait_for_port(host: str, port: int, timeout: float = 10.0):
    """等待端口可访问"""
    start = time.time()
    while time.time() - start < timeout:
        try:
            with socket.create_connection((host, port), timeout=0.5):
                return True
        except (ConnectionRefusedError, OSError):
            time.sleep(0.1)
    return False


def start_backend():
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="warning")


def main():
    if not FRONTEND_DIR.exists():
        print("✗ 找不到前端构建产物：", FRONTEND_DIR)
        print("请先在前端目录运行：NEXT_OUTPUT=export npm run build")
        sys.exit(1)

    # 后端在守护线程中启动
    threading.Thread(target=start_backend, daemon=True).start()

    if not wait_for_port("127.0.0.1", 8000):
        print("✗ 后端启动失败")
        sys.exit(1)

    print("✓ 后端就绪，打开窗口...")

    webview.create_window(
        "Smart Notes - 智能记事本",
        "http://127.0.0.1:8000",
        width=1200,
        height=800,
        min_size=(500, 600),
    )
    webview.start()


if __name__ == "__main__":
    main()
