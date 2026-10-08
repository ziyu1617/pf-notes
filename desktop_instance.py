"""Per-user desktop activation channel; it never kills another process."""

import errno
import hashlib
import logging
import os
import socket
import stat
import sys
import threading
import time
from pathlib import Path

try:
    import fcntl
except ImportError:  # Other platforms retain the ordinary port conflict check.
    fcntl = None

logger = logging.getLogger(__name__)


class PosixDesktopInstance:
    def __init__(self, project, port, runtime_dir=None):
        self.enabled = fcntl is not None and hasattr(socket, 'AF_UNIX')
        key = hashlib.sha256(f'{Path(project).resolve()}:{port}'.encode()).hexdigest()[:20]
        self.folder = Path(runtime_dir or f'/tmp/smart-notes-{os.getuid() if hasattr(os, "getuid") else "desktop"}')
        self.path = self.folder / (key + '.sock')
        self.lock_path = self.folder / (key + '.lock')
        self._lock_fd = None
        self._socket = None
        self._owns_socket_path = False
        self._lifecycle_lock = threading.RLock()
        self._stopped = threading.Event()
        self._worker = None

    @property
    def stopping(self):
        return self._stopped.is_set()

    def acquire(self):
        with self._lifecycle_lock:
            if self.stopping:
                return False
            if not self.enabled or self._lock_fd is not None:
                return True
            self.folder.mkdir(mode=0o700, parents=True, exist_ok=True)
            info = self.folder.lstat()
            if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid():
                raise RuntimeError('桌面应用运行目录不安全，无法启动')
            self.folder.chmod(0o700)
            fd = os.open(self.lock_path, os.O_CREAT | os.O_RDWR | getattr(os, 'O_NOFOLLOW', 0), 0o600)
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                os.close(fd)
                return False
            except Exception:
                os.close(fd)
                raise
            self._lock_fd = fd
            return True

    def activate_existing(self, timeout=15):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
                    client.settimeout(max(.1, deadline - time.monotonic()))
                    client.connect(str(self.path))
                    client.sendall(b'activate\n')
                    return client.recv(64).strip() == b'ok'
            except (ConnectionRefusedError, ConnectionResetError, BrokenPipeError,
                    FileNotFoundError, socket.timeout):
                time.sleep(.1)
        return False

    def start(self, activate):
        def serve():
            while not self._stopped.is_set():
                try:
                    client, _ = listener.accept()
                except socket.timeout:
                    continue
                except OSError:
                    break
                with client:
                    try:
                        client.settimeout(2)
                        message = b''
                        while b'\n' not in message and len(message) < 64:
                            chunk = client.recv(64 - len(message))
                            if not chunk:
                                break
                            message += chunk
                        # A client accepted before shutdown may finish sending
                        # later. Never run its activation after stopping.
                        ok = (message == b'activate\n' and not self.stopping
                              and activate() is True and not self.stopping)
                        client.sendall(b'ok\n' if ok else b'error\n')
                    except Exception:
                        logger.exception('Could not activate desktop window')
                        try:
                            client.sendall(b'error\n')
                        except OSError:
                            pass

        with self._lifecycle_lock:
            if not self.enabled or self.stopping or self._socket is not None:
                return
            if self._lock_fd is None:
                raise RuntimeError('Desktop activation requires the instance lock')
            # Only the lock owner removes an abandoned socket. Never remove
            # the lock file: another process may already hold its inode open.
            self.path.unlink(missing_ok=True)
            listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            try:
                listener.bind(str(self.path))
                self._owns_socket_path = True
                os.chmod(self.path, 0o600)
                listener.listen(8)
                listener.settimeout(.25)
            except Exception:
                listener.close()
                if self._owns_socket_path:
                    self.path.unlink(missing_ok=True)
                    self._owns_socket_path = False
                raise
            self._socket = listener
            self._worker = threading.Thread(target=serve, daemon=True, name='smart-notes-activation')
            self._worker.start()

    def stop_accepting(self):
        """Reject new activations while retaining ownership during teardown."""
        with self._lifecycle_lock:
            self._stopped.set()
            listener = self._socket
            self._socket = None
            if listener is not None:
                listener.close()

    def close(self):
        self.stop_accepting()
        worker = self._worker
        if worker is not None and worker is not threading.current_thread():
            worker.join(timeout=1)
        with self._lifecycle_lock:
            if self._owns_socket_path:
                self.path.unlink(missing_ok=True)
                self._owns_socket_path = False
            if self._lock_fd is not None:
                fcntl.flock(self._lock_fd, fcntl.LOCK_UN)
                os.close(self._lock_fd)
                self._lock_fd = None


def reserve_backend_socket(port):
    """Reserve the actual listener, eliminating bind-check/start races."""
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        if sys.platform == 'win32':
            # Windows REUSEADDR may allow another listener to steal traffic.
            # EXCLUSIVEADDRUSE reserves the endpoint without terminating it.
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        else:
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind(('127.0.0.1', port))
        listener.listen(128)
        listener.setblocking(False)
        return listener
    except OSError as error:
        listener.close()
        if error.errno == errno.EADDRINUSE:
            raise RuntimeError(f'端口 {port} 正被其他实例或程序使用；未关闭任何进程。') from error
        raise RuntimeError(f'无法启动本地服务：{error}') from error


if sys.platform == 'win32':
    from desktop_windows_instance import WindowsDesktopInstance as DesktopInstance
else:
    DesktopInstance = PosixDesktopInstance
