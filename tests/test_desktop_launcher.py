"""Launcher decisions with fake API, GUI, server, sockets, and worker threads."""

import builtins
import contextlib
import importlib.util
import io
import unittest
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import MagicMock, patch


class DesktopLauncherTests(unittest.TestCase):
    def setUp(self):
        self.stack = contextlib.ExitStack()
        self.addCleanup(self.stack.close)
        self.events = []
        self.api_imports = []
        self.activations = []
        self.api_allowed = True

        self.fake_api = ModuleType('api')
        self.fake_api.app = object()
        self.fake_api.FRONTEND_DIR = MagicMock()
        self.fake_api.FRONTEND_DIR.exists.return_value = True
        self.webview = ModuleType('webview')
        self.webview.settings = {}
        self.webview.create_window = MagicMock(return_value=object())
        self.webview.start = MagicMock(side_effect=lambda callback: callback())

        events = self.events

        class Server:
            started = True
            run = MagicMock()

            @property
            def should_exit(self):
                return False

            @should_exit.setter
            def should_exit(self, value):
                if value:
                    events.append('server_shutdown')

        self.server = Server()
        self.uvicorn = ModuleType('uvicorn')
        self.uvicorn.Config = MagicMock()
        self.uvicorn.Server = MagicMock(return_value=self.server)
        self.stack.enter_context(patch.dict('sys.modules', {
            'api': self.fake_api, 'webview': self.webview, 'uvicorn': self.uvicorn,
        }))

        original_import = builtins.__import__

        def import_module(name, *args, **kwargs):
            if name == 'api':
                self.api_imports.append(name)
                if not self.api_allowed:
                    raise AssertionError('This launch path must not import the API')
            return original_import(name, *args, **kwargs)

        self.stack.enter_context(patch('builtins.__import__', side_effect=import_module))
        spec = importlib.util.spec_from_file_location(
            '_smart_notes_launcher_test', Path(__file__).resolve().parents[1] / 'app.py')
        self.app = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.app)
        self.assertEqual(self.api_imports, [])

        self.instance = MagicMock()
        self.instance.acquire.return_value = True
        self.instance.stopping = False
        self.instance.start.side_effect = self.activations.append

        def stop_accepting():
            self.events.append('stop_accepting')
            self.instance.stopping = True

        self.instance.stop_accepting.side_effect = stop_accepting
        self.instance.close.side_effect = lambda: self.events.append('instance_close')
        self.listener = MagicMock()
        self.listener.close.side_effect = lambda: self.events.append('listener_close')
        self.worker = MagicMock()
        self.worker.start.side_effect = lambda: self.events.append('worker_start')
        self.worker.join.side_effect = lambda **kwargs: self.events.append('worker_join')
        self.manager = MagicMock()
        self.manager.open_main_window.side_effect = lambda factory: factory() is not None
        self.stack.enter_context(patch.object(self.app, 'DesktopInstance', return_value=self.instance))
        self.reserve = self.stack.enter_context(patch.object(
            self.app, 'reserve_backend_socket', return_value=self.listener))
        self.thread = self.stack.enter_context(patch.object(
            self.app.threading, 'Thread', return_value=self.worker))
        self.stack.enter_context(patch.object(self.app, 'StickyWindowManager', return_value=self.manager))
        self.wait_for_backend = self.app.wait_for_backend
        self.ready = self.stack.enter_context(patch.object(self.app, 'wait_for_backend', return_value=True))
        self.stack.enter_context(patch.dict('os.environ', {'SMART_NOTES_PORT': '8015'}))
        self.stdout = self.stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
        self.stderr = self.stack.enter_context(contextlib.redirect_stderr(io.StringIO()))

    def test_second_launch_activates_without_api_server_or_new_window(self):
        self.api_allowed = False
        self.instance.acquire.return_value = False
        self.instance.activate_existing.return_value = True
        self.app.main()
        self.instance.activate_existing.assert_called_once_with()
        self.assertEqual(self.api_imports, [])
        self.reserve.assert_not_called()
        self.thread.assert_not_called()
        self.uvicorn.Server.assert_not_called()
        self.webview.create_window.assert_not_called()
        self.assertEqual(self.events, ['stop_accepting', 'instance_close'])

    def test_owner_exiting_during_activation_allows_one_reacquire_and_startup(self):
        self.instance.acquire.side_effect = [False, True]
        self.instance.activate_existing.return_value = False
        self.app.main()
        self.assertEqual(self.instance.acquire.call_count, 2)
        self.reserve.assert_called_once_with(8015)
        self.assertEqual(self.api_imports, ['api'])
        self.webview.create_window.assert_called_once()
        self.webview.start.assert_called_once()

    def test_unresponsive_owner_that_keeps_lock_does_not_start_another_backend(self):
        self.api_allowed = False
        self.instance.acquire.return_value = False
        self.instance.activate_existing.return_value = False
        with self.assertRaises(SystemExit) as raised:
            self.app.main()
        self.assertEqual(raised.exception.code, 1)
        self.assertEqual(self.instance.acquire.call_count, 2)
        self.reserve.assert_not_called()
        self.webview.create_window.assert_not_called()

    def test_foreign_port_error_never_kills_or_starts_any_process(self):
        self.api_allowed = False
        self.reserve.side_effect = RuntimeError('端口 8015 正被其他实例或程序使用；未关闭任何进程。')
        with patch('os.kill') as kill:
            with self.assertRaises(SystemExit) as raised:
                self.app.main()
            kill.assert_not_called()
        self.assertEqual(raised.exception.code, 1)
        self.assertIn('未关闭任何进程', self.stderr.getvalue())
        self.thread.assert_not_called()
        self.webview.create_window.assert_not_called()

    def test_backend_not_ready_cannot_create_a_blank_window(self):
        self.ready.return_value = False
        with self.assertRaises(SystemExit) as raised:
            self.app.main()
        self.assertEqual(raised.exception.code, 1)
        self.webview.create_window.assert_not_called()
        self.webview.start.assert_not_called()
        self.assertEqual(self.events, [
            'worker_start', 'stop_accepting', 'server_shutdown', 'worker_join',
            'listener_close', 'instance_close',
        ])

    def test_startup_uses_reserved_socket_and_cleans_up_before_unlocking(self):
        self.app.main()
        self.thread.assert_called_once_with(
            target=self.server.run, kwargs={'sockets': [self.listener]}, daemon=True)
        self.ready.assert_called_once_with(self.server, self.worker)
        self.manager.attach_main.assert_called_once_with(self.webview.create_window.return_value)
        self.assertEqual(self.events, [
            'worker_start', 'stop_accepting', 'server_shutdown', 'worker_join',
            'listener_close', 'instance_close',
        ])
        # A callback captured before shutdown must not recreate the main window
        # after the GUI loop and backend have returned.
        self.assertEqual(len(self.activations), 1)
        self.assertFalse(self.activations[0]())
        self.manager.open_main_window.assert_called_once()
        self.webview.create_window.assert_called_once()

    def test_wait_for_backend_checks_readiness_worker_exit_and_timeout(self):
        clock = MagicMock()
        self.stack.enter_context(patch.object(self.app, 'time', clock))
        wait = self.wait_for_backend
        clock.monotonic.side_effect = [0, 0]
        self.assertTrue(wait(SimpleNamespace(started=True), self.worker))
        self.worker.is_alive.return_value = False
        clock.monotonic.side_effect = [0, 0]
        self.assertFalse(wait(SimpleNamespace(started=False), self.worker))
        clock.monotonic.side_effect = [0, 0]
        self.assertFalse(wait(SimpleNamespace(started=True), self.worker))
        self.worker.is_alive.return_value = True
        clock.monotonic.side_effect = [0, 0, 16]
        self.assertFalse(wait(SimpleNamespace(started=False), self.worker))
        clock.sleep.assert_called_once_with(.05)


if __name__ == '__main__':
    unittest.main()
