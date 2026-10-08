"""Windows per-user instance lock and authenticated loopback activation.

The runtime directory inherits the user's LocalAppData permissions. No process
is terminated and the stable lock file is never removed. The injectable lock
backend lets the protocol and lifecycle run in tests on other platforms.
"""

import errno
import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import socket
import stat
import sys
import tempfile
import threading
import time
from pathlib import Path

logger = logging.getLogger(__name__)
_MAX_MESSAGE = 512
_CLIENT_TIMEOUT = 2.0
_TOKEN_PATTERN = re.compile(r'[0-9a-f]{64}')


class _MsvcrtFileLocks:
    """Lock byte zero without waiting; Windows permits locking beyond EOF."""

    def __init__(self):
        import msvcrt
        self._msvcrt = msvcrt

    def lock(self, fd):
        os.lseek(fd, 0, os.SEEK_SET)
        try:
            self._msvcrt.locking(fd, self._msvcrt.LK_NBLCK, 1)
        except OSError as error:
            if error.errno in (errno.EACCES, errno.EAGAIN, errno.EDEADLK):
                raise BlockingIOError(error.errno, str(error)) from error
            raise

    def unlock(self, fd):
        os.lseek(fd, 0, os.SEEK_SET)
        self._msvcrt.locking(fd, self._msvcrt.LK_UNLCK, 1)


def _check_path(path, *, directory=False):
    info = path.lstat()
    reparse = getattr(stat, 'FILE_ATTRIBUTE_REPARSE_POINT', 0x400)
    if (stat.S_ISLNK(info.st_mode)
            or getattr(info, 'st_file_attributes', 0) & reparse
            or not (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode))
            or (hasattr(os, 'getuid') and info.st_uid != os.getuid())):
        raise RuntimeError('桌面应用运行目录或文件不安全，无法启动')
    return info


class WindowsDesktopInstance:
    """DesktopInstance lifecycle using a byte lock and an activation token.

    ``file_locks`` may supply ``lock(fd)`` (nonblocking, raising
    BlockingIOError on contention) and ``unlock(fd)`` for isolated tests.
    ``stop_accepting`` retains the lock until the caller finishes teardown and
    calls ``close``. An activation callback should promptly queue GUI work.
    """

    def __init__(self, project, port, runtime_dir=None, file_locks=None):
        self.enabled = sys.platform == 'win32' or file_locks is not None
        identity = os.path.normcase(str(Path(project).resolve()))
        key = hashlib.sha256(f'{identity}:{port}'.encode()).hexdigest()[:20]
        local_appdata = os.environ.get('LOCALAPPDATA')
        base = Path(local_appdata) if local_appdata else Path.home() / 'AppData' / 'Local'
        self.folder = Path(runtime_dir) if runtime_dir is not None else base / 'Smart Notes' / 'runtime'
        self.path = self.folder / (key + '.json')
        self.lock_path = self.folder / (key + '.lock')
        self._file_locks = file_locks
        self._lock_fd = None
        self._socket = None
        self._token = None
        self._owns_metadata = False
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
            if self._file_locks is None:
                self._file_locks = _MsvcrtFileLocks()
            self.folder.mkdir(mode=0o700, parents=True, exist_ok=True)
            _check_path(self.folder, directory=True)
            if os.name != 'nt':
                self.folder.chmod(0o700)
            # Refuse links/reparse points before open; O_NOFOLLOW additionally
            # protects injected-backend tests on POSIX. LocalAppData is private
            # to the user; Windows file security inherits from that directory.
            if self.lock_path.exists() or self.lock_path.is_symlink():
                _check_path(self.lock_path)
            flags = os.O_CREAT | os.O_RDWR | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NOINHERIT', 0)
            fd = os.open(self.lock_path, flags, 0o600)
            try:
                info = _check_path(self.lock_path)
                opened = os.fstat(fd)
                if (info.st_dev, info.st_ino) != (opened.st_dev, opened.st_ino):
                    raise RuntimeError('桌面应用锁文件已改变，无法启动')
                self._file_locks.lock(fd)
            except BlockingIOError:
                os.close(fd)
                return False
            except Exception:
                os.close(fd)
                raise
            self._lock_fd = fd
            return True

    def _read_metadata(self):
        _check_path(self.folder, directory=True)
        _check_path(self.path)
        with self.path.open('rb') as stream:
            raw = stream.read(_MAX_MESSAGE + 1)
        if len(raw) > _MAX_MESSAGE:
            raise ValueError('Activation metadata is too large')
        metadata = json.loads(raw)
        if (not isinstance(metadata, dict)
                or set(metadata) != {'version', 'port', 'token'}
                or type(metadata['version']) is not int or metadata['version'] != 1
                or type(metadata['port']) is not int or not 1 <= metadata['port'] <= 65535
                or not isinstance(metadata['token'], str)
                or _TOKEN_PATTERN.fullmatch(metadata['token']) is None):
            raise ValueError('Invalid activation metadata')
        return metadata

    def activate_existing(self, timeout=15):
        if not self.enabled or self.stopping:
            return False
        deadline = time.monotonic() + max(0, timeout)
        while not self.stopping and time.monotonic() < deadline:
            try:
                metadata = self._read_metadata()
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as client:
                    client.settimeout(max(.001, deadline - time.monotonic()))
                    client.connect(('127.0.0.1', metadata['port']))
                    client.sendall(f"activate {metadata['token']}\n".encode('ascii'))
                    # EOF is part of the request, so trailing commands cannot
                    # race a valid prefix and the message is unambiguous.
                    client.shutdown(socket.SHUT_WR)
                    response = b''
                    while len(response) < 16:
                        client.settimeout(max(.001, deadline - time.monotonic()))
                        chunk = client.recv(16 - len(response))
                        if not chunk:
                            break
                        response += chunk
                    return response == b'ok\n' and not self.stopping
            except (OSError, ValueError, UnicodeError, RuntimeError):
                remaining = deadline - time.monotonic()
                if remaining > 0:
                    self._stopped.wait(min(.1, remaining))
        return False

    def _publish_metadata(self, port, token):
        # Only called under the lifecycle lock by the held lock's owner.
        fd, name = tempfile.mkstemp(prefix=self.path.stem + '-', suffix='.tmp', dir=self.folder)
        temporary = Path(name)
        try:
            with os.fdopen(fd, 'w', encoding='ascii') as stream:
                json.dump({'version': 1, 'port': port, 'token': token}, stream)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, self.path)
            self._owns_metadata = True
        finally:
            temporary.unlink(missing_ok=True)

    def _read_request(self, client):
        deadline = time.monotonic() + _CLIENT_TIMEOUT
        message = b''
        while not self.stopping:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return None
            client.settimeout(min(.1, remaining))
            try:
                chunk = client.recv(_MAX_MESSAGE - len(message))
            except socket.timeout:
                continue
            if not chunk:
                return message
            message += chunk
            if len(message) >= _MAX_MESSAGE:
                return None
        return None

    def _serve(self, listener, token, activate):
        expected = b'activate ' + token.encode('ascii') + b'\n'
        while not self.stopping:
            try:
                client, _ = listener.accept()
            except socket.timeout:
                continue
            except OSError:
                break
            with client:
                try:
                    message = self._read_request(client)
                    ok = (message is not None
                          and hmac.compare_digest(message, expected)
                          and not self.stopping
                          and activate() is True
                          and not self.stopping)
                    client.settimeout(.25)
                    client.sendall(b'ok\n' if ok else b'error\n')
                except OSError:
                    # Timeouts, abandoned clients and shutdown are expected.
                    pass
                except Exception:
                    logger.exception('Could not activate desktop window')
                    try:
                        client.settimeout(.25)
                        client.sendall(b'error\n')
                    except OSError:
                        pass

    def start(self, activate):
        with self._lifecycle_lock:
            if not self.enabled or self.stopping or self._socket is not None:
                return
            if self._lock_fd is None:
                raise RuntimeError('Desktop activation requires the instance lock')
            listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            try:
                if hasattr(socket, 'SO_EXCLUSIVEADDRUSE'):
                    listener.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
                listener.bind(('127.0.0.1', 0))
                listener.listen(8)
                listener.settimeout(.25)
                token = secrets.token_hex(32)
                self._publish_metadata(listener.getsockname()[1], token)
                self._socket = listener
                self._token = token
                self._worker = threading.Thread(
                    target=self._serve, args=(listener, token, activate),
                    daemon=True, name='smart-notes-activation')
                self._worker.start()
            except Exception:
                listener.close()
                self._socket = None
                self._worker = None
                if self._owns_metadata:
                    self._owns_metadata = False
                    self.path.unlink(missing_ok=True)
                raise

    def stop_accepting(self):
        """Reject activation while retaining the lock through backend teardown."""
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
            try:
                if self._owns_metadata:
                    self._owns_metadata = False
                    self.path.unlink(missing_ok=True)
            finally:
                if self._lock_fd is not None:
                    fd, self._lock_fd = self._lock_fd, None
                    try:
                        self._file_locks.unlock(fd)
                    finally:
                        os.close(fd)
