"""Launch/activation isolation tests. No application database or GUI is opened."""

import errno
import os
import socket
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from desktop_instance import PosixDesktopInstance as DesktopInstance, reserve_backend_socket


@unittest.skipUnless(os.name == 'posix', 'Unix socket/flock regression; Windows has a separate suite')
class DesktopInstanceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='sn-ipc-', dir='/tmp')
        self.instances = []

    def tearDown(self):
        for instance in reversed(self.instances):
            instance.close()
        self.temp.cleanup()

    def instance(self):
        instance = DesktopInstance('/example/project', 8000, Path(self.temp.name) / 'runtime')
        self.instances.append(instance)
        return instance

    def test_second_launch_activates_existing_owner_and_does_not_take_lock(self):
        first, second = self.instance(), self.instance()
        self.assertTrue(first.acquire())
        calls = []
        first.start(lambda: calls.append('activate') is None)
        self.assertFalse(second.acquire())
        self.assertTrue(second.activate_existing(timeout=2))
        self.assertEqual(calls, ['activate'])
        second.close()
        self.assertTrue(first.path.exists())

    def test_waits_for_starting_gui_and_recovers_after_owner_exits(self):
        first, second = self.instance(), self.instance()
        self.assertTrue(first.acquire())
        result = []
        waiter = threading.Thread(target=lambda: result.append(second.activate_existing(timeout=2)))
        waiter.start()
        first.start(lambda: True)
        waiter.join(timeout=3)
        self.assertEqual(result, [True])
        first.close()
        self.assertTrue(second.acquire())
        # An abandoned socket from a terminated process is replaced only by
        # the next lock owner, while the lock file itself remains stable.
        second.path.write_text('stale')
        second.start(lambda: True)
        self.assertTrue(self.instance().activate_existing(timeout=2))

    def test_failed_activation_does_not_report_success_or_kill_owner(self):
        first, second = self.instance(), self.instance()
        self.assertTrue(first.acquire())
        first.start(lambda: False)
        self.assertFalse(second.activate_existing(timeout=2))
        self.assertFalse(second.acquire())

    def test_stop_accepting_keeps_lock_until_backend_teardown_finishes(self):
        first, second = self.instance(), self.instance()
        self.assertTrue(first.acquire())
        first.start(lambda: True)
        first.stop_accepting()
        self.assertTrue(first.stopping)
        self.assertFalse(second.acquire())
        first.close()
        self.assertFalse(first.path.exists())
        self.assertTrue(second.acquire())
        second.start(lambda: True)
        first.close()  # A repeated old cleanup must not remove the new socket.
        self.assertTrue(second.path.exists())
        self.assertTrue(self.instance().activate_existing(timeout=2))

    def test_start_after_stop_or_close_cannot_recreate_socket(self):
        first = self.instance()
        self.assertTrue(first.acquire())
        first.stop_accepting()
        first.start(lambda: True)
        self.assertIsNone(first._worker)
        self.assertFalse(first.path.exists())
        first.close()
        first.start(lambda: True)
        self.assertFalse(first.path.exists())

    def test_close_serializes_with_listener_creation(self):
        first = self.instance()
        self.assertTrue(first.acquire())
        entered, release, closed = threading.Event(), threading.Event(), threading.Event()
        errors = []

        class DelayedListener(socket.socket):
            def bind(self, address):
                entered.set()
                if not release.wait(2):
                    raise RuntimeError('Test did not release socket creation')
                return super().bind(address)

        def start():
            try:
                first.start(lambda: True)
            except Exception as error:
                errors.append(error)

        starter = threading.Thread(target=start)
        closer = threading.Thread(target=lambda: (first.close(), closed.set()))
        with patch('desktop_instance.socket.socket', DelayedListener):
            starter.start()
            self.assertTrue(entered.wait(2))
            closer.start()
            self.assertFalse(closed.is_set())
            release.set()
            starter.join(3)
            closer.join(3)
        self.assertFalse(starter.is_alive())
        self.assertFalse(closer.is_alive())
        self.assertEqual(errors, [])
        self.assertTrue(closed.is_set())
        self.assertTrue(first.stopping)
        self.assertFalse(first.path.exists())
        self.assertTrue(self.instance().acquire())

    def test_partial_command_cannot_activate_after_stop(self):
        first = self.instance()
        self.assertTrue(first.acquire())
        accepted = threading.Event()
        calls = []

        class ObservedListener(socket.socket):
            def accept(self):
                result = super().accept()
                accepted.set()
                return result

        with patch('desktop_instance.socket.socket', ObservedListener):
            first.start(lambda: calls.append(True) is None)
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            client.settimeout(2)
            client.connect(str(first.path))
            client.sendall(b'act')
            self.assertTrue(accepted.wait(2))
            first.stop_accepting()
            client.sendall(b'ivate\n')
            self.assertEqual(client.recv(64), b'error\n')
        self.assertEqual(calls, [])

    def test_activation_finishing_during_shutdown_does_not_report_success(self):
        first, second = self.instance(), self.instance()
        self.assertTrue(first.acquire())
        entered, release = threading.Event(), threading.Event()

        def activate():
            entered.set()
            return release.wait(2)

        first.start(activate)
        results = []
        client = threading.Thread(target=lambda: results.append(second.activate_existing(timeout=3)))
        client.start()
        self.assertTrue(entered.wait(2))
        first.stop_accepting()
        release.set()
        client.join(3)
        self.assertFalse(client.is_alive())
        self.assertEqual(results, [False])

    def test_unknown_command_cannot_activate_and_socket_is_private(self):
        first = self.instance()
        self.assertTrue(first.acquire())
        calls = []
        first.start(lambda: calls.append(True) is None)
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            client.connect(str(first.path))
            client.sendall(b'delete\n')
            self.assertEqual(client.recv(64), b'error\n')
        self.assertEqual(calls, [])
        self.assertEqual(first.folder.stat().st_mode & 0o777, 0o700)
        self.assertEqual(first.path.stat().st_mode & 0o777, 0o600)

    def test_reservation_blocks_foreign_listener_and_preserves_it(self):
        owner = reserve_backend_socket(0)
        try:
            port = owner.getsockname()[1]
            with self.assertRaisesRegex(RuntimeError, '未关闭任何进程'):
                reserve_backend_socket(port)
            with socket.create_connection(('127.0.0.1', port), timeout=1):
                pass
        finally:
            owner.close()

    def test_permission_failure_is_not_misreported_as_port_occupied(self):
        with patch('desktop_instance.socket.socket') as mock:
            mock.return_value.bind.side_effect = PermissionError(errno.EPERM, 'denied')
            with self.assertRaisesRegex(RuntimeError, '无法启动本地服务'):
                reserve_backend_socket(8000)
            mock.return_value.close.assert_called_once()


class BackendSocketPlatformTests(unittest.TestCase):
    def test_windows_reserves_exclusive_endpoint_instead_of_reusing_another_listener(self):
        with patch('desktop_instance.sys.platform', 'win32'), \
                patch('desktop_instance.socket.SO_EXCLUSIVEADDRUSE', -5, create=True), \
                patch('desktop_instance.socket.socket') as factory:
            listener = reserve_backend_socket(8000)
        listener.setsockopt.assert_called_once_with(socket.SOL_SOCKET, -5, 1)
        listener.bind.assert_called_once_with(('127.0.0.1', 8000))
        listener.listen.assert_called_once_with(128)
        listener.setblocking.assert_called_once_with(False)


if __name__ == '__main__':
    unittest.main()
