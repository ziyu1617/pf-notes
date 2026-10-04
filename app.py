#!/usr/bin/env python3
"""Smart Notes Desktop - 原生窗口启动器
启动 FastAPI 后端 + 静态前端，然后用 PyWebView 打开原生桌面窗口。
"""

import threading
import time
import sys
import os
from pathlib import Path
import webview
import uvicorn
from desktop_instance import DesktopInstance, reserve_backend_socket
from desktop_sticky import StickyWindowManager


def wait_for_backend(server, worker, timeout=15):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if not worker.is_alive():
            return False
        if server.started:
            return True
        time.sleep(.05)
    return False


def get_db():
    from api import get_db as connect
    return connect()


def sticky_exists(note_id):
    conn = get_db()
    try:
        return conn.execute(
            "SELECT id FROM sticky_notes WHERE id = ? AND deleted_at IS NULL", (note_id,)
        ).fetchone() is not None
    finally:
        conn.close()


def main():
    try:
        port = int(os.environ.get('SMART_NOTES_PORT', '8000'))
        if not 1 <= port <= 65535:
            raise ValueError
    except ValueError:
        print("✗ SMART_NOTES_PORT 必须是 1–65535 之间的端口号")
        sys.exit(1)

    instance = DesktopInstance(Path(__file__).parent, port)
    server = listener = worker = None
    try:
        if not instance.acquire():
            if instance.activate_existing():
                print('✓ 已显示正在运行的 Smart Notes 窗口')
                return
            # The former owner may have exited during activation. Reclaim its
            # released lock once; never stop it or any other port owner.
            if not instance.acquire():
                raise RuntimeError('现有 Smart Notes 暂时没有响应，请稍后再次打开。')

        # A second launch must activate the first before importing the API or
        # opening its database. Keep ownership of the real listening socket.
        listener = reserve_backend_socket(port)
        from api import app, FRONTEND_DIR
        if not FRONTEND_DIR.exists():
            raise RuntimeError('找不到前端构建产物，请先运行 NEXT_OUTPUT=export npm run build')
        server = uvicorn.Server(uvicorn.Config(app, host='127.0.0.1', port=port, log_level='warning'))
        worker = threading.Thread(target=server.run, kwargs={'sockets': [listener]}, daemon=True)
        worker.start()
        if not wait_for_backend(server, worker):
            raise RuntimeError('后端启动失败，未打开空白窗口')

        base_url = f'http://127.0.0.1:{port}'
        sticky_windows = StickyWindowManager(base_url, sticky_exists, webview)

        def create_main():
            if instance.stopping:
                return None
            return webview.create_window(
                'Smart Notes - 智能记事本', base_url, js_api=sticky_windows.bridge,
                width=1200, height=800, min_size=(500, 600),
            )

        sticky_windows.attach_main(create_main())
        print('✓ 后端就绪，打开窗口...', flush=True)
        webview.settings['ALLOW_DOWNLOADS'] = True
        # pywebview starts this callback alongside GUI initialization. The
        # manager waits for the first window's shown event before activation.
        webview.start(lambda: instance.start(lambda: sticky_windows.open_main_window(create_main)))
    except (RuntimeError, OSError) as error:
        print(f'✗ {error}', file=sys.stderr)
        sys.exit(1)
    finally:
        instance.stop_accepting()
        if server:
            server.should_exit = True
        if worker:
            worker.join(timeout=2)
        if listener:
            listener.close()
        instance.close()


if __name__ == "__main__":
    main()
