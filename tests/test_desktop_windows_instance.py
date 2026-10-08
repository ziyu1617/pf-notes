"""Windows instance isolation: temporary files and loopback, no app or database."""

import errno
import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from desktop_windows_instance import WindowsDesktopInstance, _MsvcrtFileLocks


class FakeFileLocks:
    """Descriptor-aware nonblocking lock backend for lifecycle/protocol tests."""

    def __init__(self):
        self.owners = {}
        self.mutex = threading.Lock()

    def lock(self, fd):
        info = os.fstat(fd)
        key = (info.st_dev, info.st_ino)
        with self.mutex:
            if key in self.owners:
                raise BlockingIOError(errno.EACCES, 'Already locked')
            self.owners[key] = fd

    def unlock(self, fd):
        info = os.fstat(fd)
        key = (info.st_dev, info.st_ino)
        with self.mutex:
            if self.owners.get(key) != fd:
                raise AssertionError('Unlock requires ownership')
            del self.owners[key]


class WindowsDesktopInstanceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='sn-win-ipc-')
        self.backend = FakeFileLocks()
        self.instances = []

    def tearDown(self):
        for instance in reversed(self.instances):
            instance.close()
        self.temp.cleanup()

    def instance(self, **kwargs):
        options = {'runtime_dir': Path(self.temp.name) / 'runtime', 'file_locks': self.backend}
        options.update(kwargs)
        instance = WindowsDesktopInstance('/example/project', 8000, **options)
        self.instances.append(instance)
        return instance

    def metadata(self, instance):
        return json.loads(instance.path.read_text())

    def request(self, instance, request, *, eof=True):
        metadata = self.metadata(instance)
        with socket.create_connection(('127.0.0.1', metadata['port']), timeout=3) as client:
            client.sendall(request)
            if eof:
                client.shutdown(socket.SHUT_WR)
            return client.recv(64)

    def test_second_launch_activates_owner_without_taking_or_removing_lock(self):
        first, second = self.instance(), self.instance()
        self.assertTrue(first.acquire())
        self.assertTrue(first.acquire())
        calls = []
        first.start(lambda: calls.append(True) is None)
        self.assertFalse(second.acquire())
        self.assertTrue(second.activate_existing(timeout=2))
        second.close()
        self.assertTrue(first.path.exists())
        self.assertTrue(first.lock_path.exists())
        self.assertEqual(calls, [True])
        metadata = self.metadata(first)
        self.assertEqual(set(metadata), {'version', 'port', 'token'})
        self.assertRegex(metadata['token'], r'^[0-9a-f]{64}$')
        self.assertEqual(first._socket.getsockname()[0], '127.0.0.1')

    def test_waits_for_startup_and_recovers_stale_metadata(self):
        first, second = self.instance(), self.instance()
        self.assertTrue(first.acquire())
        result = []
        waiter = threading.Thread(target=lambda: result.append(second.activate_existing(timeout=2)))
        waiter.start()
        first.start(lambda: True)
        waiter.join(3)
        self.assertFalse(waiter.is_alive())
        self.assertEqual(result, [True])
        old_token = self.metadata(first)['token']
        lock_inode = first.lock_path.stat().st_ino
        first.close()
        self.assertTrue(second.acquire())
        second.path.write_text('{stale or interrupted publication')
        second.start(lambda: True)
        self.assertNotEqual(self.metadata(second)['token'], old_token)
        self.assertEqual(second.lock_path.stat().st_ino, lock_inode)
        self.assertTrue(self.instance().activate_existing(timeout=2))

    def test_failed_activation_does_not_report_success(self):
        first, second = self.instance(), self.instance()
        self.assertTrue(first.acquire())
        first.start(lambda: False)
        self.assertFalse(second.activate_existing(timeout=2))
        self.assertFalse(second.acquire())

    def test_activation_exception_reports_error_and_keeps_listener_alive(self):
        first, second = self.instance(), self.instance()
        self.assertTrue(first.acquire())
        activate = Mock(side_effect=[RuntimeError('GUI unavailable'), True])
        first.start(activate)
        with self.assertLogs('desktop_windows_instance', level='ERROR'):
            self.assertFalse(second.activate_existing(timeout=2))
        self.assertTrue(second.activate_existing(timeout=2))

    def test_strict_authenticated_protocol_rejects_invalid_and_oversized_messages(self):
        first = self.instance()
        self.assertTrue(first.acquire())
        calls = []
        first.start(lambda: calls.append(True) is None)
        token = self.metadata(first)['token'].encode('ascii')
        valid = b'activate ' + token + b'\n'
        invalid = [b'activate\n', b'delete ' + token + b'\n',
                   b'activate ' + b'0' * 64 + b'\n', valid + b'activate\n',
                   valid.rstrip(), valid.replace(b'\n', b'\r\n'), b'x' * 512,
                   b'\xff' * 100]
        for message in invalid:
            with self.subTest(message=message[:12]):
                self.assertEqual(self.request(first, message), b'error\n')
        self.assertEqual(calls, [])
        self.assertEqual(self.request(first, valid), b'ok\n')
        self.assertEqual(calls, [True])

    def test_incomplete_client_times_out_and_does_not_block_next_activation(self):
        first = self.instance()
        self.assertTrue(first.acquire())
        first.start(lambda: True)
        with patch('desktop_windows_instance._CLIENT_TIMEOUT', .15):
            started = time.monotonic()
            self.assertEqual(self.request(first, b'act', eof=False), b'error\n')
            self.assertLess(time.monotonic() - started, 1)
        self.assertTrue(self.instance().activate_existing(timeout=2))

    def test_stop_rejects_partial_accepted_request_and_holds_lock_until_close(self):
        first, second = self.instance(), self.instance()
        self.assertTrue(first.acquire())
        entered = threading.Event()
        read_request = first._read_request
        calls = []

        def observed(client):
            entered.set()
            return read_request(client)

        first._read_request = observed
        first.start(lambda: calls.append(True) is None)
        metadata = self.metadata(first)
        with socket.create_connection(('127.0.0.1', metadata['port']), timeout=2) as client:
            client.sendall(b'act')
            self.assertTrue(entered.wait(2))
            first.stop_accepting()
            self.assertTrue(first.stopping)
            self.assertFalse(second.acquire())
            client.sendall(('ivate ' + metadata['token'] + '\n').encode('ascii'))
            client.shutdown(socket.SHUT_WR)
            self.assertEqual(client.recv(64), b'error\n')
        self.assertEqual(calls, [])
        first.close()
        self.assertFalse(first.path.exists())
        self.assertTrue(first.lock_path.exists())
        self.assertTrue(second.acquire())
        second.start(lambda: True)
        first.close()
        self.assertTrue(second.path.exists())
        self.assertTrue(self.instance().activate_existing(timeout=2))

    def test_activation_finishing_after_stop_returns_false(self):
        first, second = self.instance(), self.instance()
        self.assertTrue(first.acquire())
        entered, release = threading.Event(), threading.Event()

        def activate():
            entered.set()
            return release.wait(2)

        first.start(activate)
        result = []
        client = threading.Thread(target=lambda: result.append(second.activate_existing(timeout=3)))
        client.start()
        try:
            self.assertTrue(entered.wait(2))
            first.stop_accepting()
        finally:
            release.set()
            client.join(3)
        self.assertFalse(client.is_alive())
        self.assertEqual(result, [False])

    def test_start_requires_lock_and_cannot_restart_after_stop(self):
        first = self.instance()
        with self.assertRaisesRegex(RuntimeError, 'instance lock'):
            first.start(lambda: True)
        self.assertTrue(first.acquire())
        first.stop_accepting()
        first.start(lambda: True)
        self.assertFalse(first.path.exists())
        self.assertIsNone(first._worker)
        first.close()
        self.assertFalse(first.acquire())

    def test_close_serializes_with_listener_creation(self):
        first = self.instance()
        self.assertTrue(first.acquire())
        entered, release, closed = threading.Event(), threading.Event(), threading.Event()
        errors = []

        class DelayedListener(socket.socket):
            def bind(self, address):
                entered.set()
                if not release.wait(2):
                    raise RuntimeError('Listener was not released')
                return super().bind(address)

        def start():
            try:
                first.start(lambda: True)
            except Exception as error:
                errors.append(error)

        starter = threading.Thread(target=start)
        closer = threading.Thread(target=lambda: (first.close(), closed.set()))
        with patch('desktop_windows_instance.socket.socket', DelayedListener):
            starter.start()
            self.assertTrue(entered.wait(2))
            closer.start()
            self.assertFalse(closed.is_set())
            release.set()
            starter.join(3)
            closer.join(3)
        self.assertEqual(errors, [])
        self.assertFalse(starter.is_alive())
        self.assertFalse(closer.is_alive())
        self.assertFalse(first.path.exists())
        self.assertTrue(self.instance().acquire())

    def test_bad_metadata_is_bounded_and_never_contacts_non_loopback_host(self):
        first, second = self.instance(), self.instance()
        self.assertTrue(first.acquire())
        for metadata in [b'x' * 513, b'[]', b'{broken',
                         json.dumps({'version': 1, 'port': True, 'token': 'a' * 64}).encode(),
                         json.dumps({'version': 1, 'port': 1234, 'token': 'a' * 64,
                                     'host': 'example.com'}).encode()]:
            first.path.write_bytes(metadata)
            with patch('desktop_windows_instance.socket.socket') as sockets:
                self.assertFalse(second.activate_existing(timeout=.01))
                sockets.assert_not_called()

    def test_failed_publication_preserves_lock_and_cleans_temporary_file(self):
        first, second = self.instance(), self.instance()
        self.assertTrue(first.acquire())
        with patch('desktop_windows_instance.os.replace', side_effect=PermissionError('denied')):
            with self.assertRaises(PermissionError):
                first.start(lambda: True)
        self.assertIsNone(first._socket)
        self.assertFalse(second.acquire())
        self.assertEqual(list(first.folder.glob('*.tmp')), [])
        first.start(lambda: True)
        self.assertTrue(second.activate_existing(timeout=2))

    def test_failed_worker_start_removes_metadata_and_close_releases_lock(self):
        first, second = self.instance(), self.instance()
        self.assertTrue(first.acquire())
        with patch('desktop_windows_instance.threading.Thread.start', side_effect=RuntimeError('failed')):
            with self.assertRaisesRegex(RuntimeError, 'failed'):
                first.start(lambda: True)
        self.assertFalse(first.path.exists())
        self.assertIsNone(first._worker)
        self.assertFalse(second.acquire())
        first.close()
        self.assertTrue(second.acquire())

    def test_failed_metadata_cleanup_cannot_delete_later_owners_metadata(self):
        first, second = self.instance(), self.instance()
        self.assertTrue(first.acquire())
        first.start(lambda: True)
        with patch('desktop_windows_instance.Path.unlink', side_effect=PermissionError('denied')):
            with self.assertRaises(PermissionError):
                first.close()
        self.assertTrue(second.acquire())
        second.start(lambda: True)
        first.close()
        self.assertTrue(second.path.exists())
        self.assertTrue(self.instance().activate_existing(timeout=2))

    @unittest.skipIf(sys.platform == 'win32', 'Windows symlink creation can require privileges')
    def test_rejects_symlink_runtime_and_lock_without_modifying_target(self):
        target = Path(self.temp.name) / 'target'
        target.mkdir()
        folder = Path(self.temp.name) / 'runtime'
        folder.symlink_to(target, target_is_directory=True)
        first = self.instance()
        with self.assertRaises(RuntimeError):
            first.acquire()
        folder.unlink()
        folder.mkdir()
        secret = target / 'other'
        secret.write_text('preserve')
        first.lock_path.symlink_to(secret)
        with self.assertRaises(RuntimeError):
            first.acquire()
        self.assertEqual(secret.read_text(), 'preserve')

    def test_default_directory_is_users_localappdata(self):
        with patch.dict(os.environ, {'LOCALAPPDATA': self.temp.name}):
            instance = WindowsDesktopInstance('/project', 8000, file_locks=self.backend)
        self.assertEqual(instance.folder, Path(self.temp.name) / 'Smart Notes' / 'runtime')

    def test_msvcrt_backend_locks_byte_zero_nonblocking_and_translates_contention(self):
        fake = Mock(LK_NBLCK=2, LK_UNLCK=0)
        with patch.dict(sys.modules, {'msvcrt': fake}):
            backend = _MsvcrtFileLocks()
        with tempfile.TemporaryFile() as stream:
            stream.seek(9)
            backend.lock(stream.fileno())
            self.assertEqual(stream.tell(), 0)
            fake.locking.assert_called_with(stream.fileno(), 2, 1)
            stream.seek(5)
            backend.unlock(stream.fileno())
            self.assertEqual(stream.tell(), 0)
            fake.locking.assert_called_with(stream.fileno(), 0, 1)
            fake.locking.side_effect = OSError(errno.EACCES, 'locked')
            with self.assertRaises(BlockingIOError):
                backend.lock(stream.fileno())
            fake.locking.side_effect = OSError(errno.EBADF, 'bad descriptor')
            with self.assertRaises(OSError) as raised:
                backend.lock(stream.fileno())
            self.assertEqual(raised.exception.errno, errno.EBADF)


@unittest.skipUnless(sys.platform == 'win32', 'Real msvcrt locks require Windows')
class NativeWindowsLockTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='sn-native-lock-')
        self.addCleanup(self.temp.cleanup)
        self.project = str(Path(self.temp.name) / 'project')
        self.runtime = str(Path(self.temp.name) / 'runtime')

    def child(self, *, abandon=False):
        script = (
            'import os, sys\n'
            'from desktop_windows_instance import WindowsDesktopInstance\n'
            'instance = WindowsDesktopInstance(sys.argv[1], 8000, sys.argv[2])\n'
            'print(instance.acquire(), flush=True)\n'
            + ('os._exit(0)\n' if abandon else 'instance.close()\n')
        )
        return subprocess.run([sys.executable, '-c', script, self.project, self.runtime],
                              cwd=Path(__file__).resolve().parents[1], capture_output=True,
                              text=True, timeout=10, check=True).stdout.strip()

    def test_real_byte_lock_excludes_another_process_until_close(self):
        instance = WindowsDesktopInstance(self.project, 8000, self.runtime)
        self.addCleanup(instance.close)
        self.assertTrue(instance.acquire())
        self.assertEqual(self.child(), 'False')
        instance.stop_accepting()
        self.assertEqual(self.child(), 'False')
        instance.close()
        self.assertEqual(self.child(), 'True')
        self.assertTrue(instance.lock_path.exists())

    def test_process_exit_releases_real_lock_without_deleting_lock_file(self):
        self.assertEqual(self.child(abandon=True), 'True')
        instance = WindowsDesktopInstance(self.project, 8000, self.runtime)
        self.addCleanup(instance.close)
        self.assertTrue(instance.lock_path.exists())
        self.assertTrue(instance.acquire())


if __name__ == '__main__':
    unittest.main()
