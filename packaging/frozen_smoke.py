"""Bounded release checks, always with a new temporary database and uploads."""
import json
import os
import platform
import socket
import sys
import tempfile
import threading
import time
import traceback
import urllib.request
from pathlib import Path


def run(report_path, gui=False):
    report = {'ok': False, 'frozen': bool(getattr(sys, 'frozen', False)),
              'platform': sys.platform, 'architecture': platform.machine(), 'checks': []}
    try:
        with tempfile.TemporaryDirectory(prefix='smart-notes-smoke-') as temporary:
            os.environ['SMART_NOTES_DATA_DIR'] = temporary
            # Avoid inheriting a developer's optional AI configuration.
            os.environ.pop('ZHIPU_API_KEY', None)
            from api import app, DB_PATH, UPLOADS_DIR, FRONTEND_DIR
            assert DB_PATH.parent.resolve() == Path(temporary).resolve()
            assert UPLOADS_DIR.parent.resolve() == Path(temporary).resolve()
            assert (FRONTEND_DIR / 'index.html').is_file()
            assert (FRONTEND_DIR / 'sticky.html').is_file()
            report['checks'].append('isolated-data-and-bundled-frontend')
            import uvicorn
            listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            listener.bind(('127.0.0.1', 0))
            listener.listen(16)
            listener.setblocking(False)
            port = listener.getsockname()[1]
            server = uvicorn.Server(uvicorn.Config(app, log_level='warning', access_log=False))
            worker = threading.Thread(target=server.run, kwargs={'sockets': [listener]}, daemon=True)
            worker.start()
            try:
                deadline = time.monotonic() + 20
                while not server.started and worker.is_alive() and time.monotonic() < deadline:
                    time.sleep(.05)
                assert server.started and worker.is_alive(), 'Backend failed to start'
                base = f'http://127.0.0.1:{port}'
                for path in ('/', '/sticky.html', '/api/notes', '/api/calendar'):
                    with urllib.request.urlopen(base + path, timeout=10) as response:
                        assert response.status == 200
                        if path == '/api/notes':
                            assert json.load(response) == [], 'Smoke database must start empty'
                report['checks'].append('backend-and-static-http')
                if gui:
                    import webview
                    from desktop_sticky import StickyWindowManager
                    failures, ready = [], threading.Event()
                    manager = StickyWindowManager(base, lambda _: False, webview)
                    window = webview.create_window('Smart Notes packaging smoke', base, width=600, height=600,
                                                   js_api=manager.bridge)
                    manager.attach_main(window)

                    def verify():
                        try:
                            assert window.events.loaded.wait(30), 'GUI page did not load'
                            assert window.evaluate_js('document.readyState') in ('interactive', 'complete')
                            assert window.evaluate_js('typeof window.pywebview.api.get_sticky_windows') == 'function'
                            report['checks'].append('native-window-renderer')
                            ready.set()
                        except Exception as error:
                            failures.append(str(error))
                        finally:
                            window.destroy()

                    webview.start(verify, gui='edgechromium' if sys.platform == 'win32' else 'cocoa')
                    assert ready.is_set() and not failures, '; '.join(failures) or 'GUI check incomplete'
            finally:
                server.should_exit = True
                worker.join(timeout=10)
                listener.close()
            report['ok'] = True
    except BaseException:
        report['error'] = traceback.format_exc()
    if report_path:
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, indent=2), flush=True)
    return 0 if report['ok'] else 1
