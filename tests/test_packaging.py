"""Packaging checks without loading the API, GUI, or personal data."""
import importlib.util
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import runtime_paths

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('desktop_build_test', ROOT / 'scripts' / 'build_desktop.py')
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)


class PackagingPathsTests(unittest.TestCase):
    def test_source_resources_and_existing_home_data_are_preserved(self):
        with patch.dict(os.environ, {}, clear=True), patch.object(Path, 'home', return_value=ROOT / 'test-home'), patch.object(sys, 'frozen', False, create=True):
            self.assertEqual(runtime_paths.resource_root(), ROOT)
            self.assertEqual(runtime_paths.data_root(), Path.home())
            self.assertEqual(runtime_paths.config_path(), ROOT / '.env')

    def test_frozen_resources_and_config_never_depend_on_working_directory(self):
        with tempfile.TemporaryDirectory() as folder:
            with patch.dict(os.environ, {}, clear=True), patch.object(Path, 'home', return_value=ROOT / 'test-home'), patch.object(sys, 'frozen', True, create=True), patch.object(sys, '_MEIPASS', folder, create=True):
                self.assertEqual(runtime_paths.resource_root(), Path(folder))
                self.assertEqual(runtime_paths.config_path(), Path.home() / '.smart_notes.env')
                self.assertEqual(runtime_paths.instance_identity(), Path(sys.executable).resolve())

    def test_smoke_data_override_does_not_change_home(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {'SMART_NOTES_DATA_DIR': ''}):
            original_home = Path.home()
            os.environ['SMART_NOTES_DATA_DIR'] = folder
            self.assertEqual(runtime_paths.data_root(), Path(folder).resolve())
            self.assertEqual(runtime_paths.config_path(), Path(folder).resolve() / '.smart_notes.env')
            self.assertEqual(Path.home(), original_home)

    def test_static_export_rejects_private_files_and_symlink_escape(self):
        with tempfile.TemporaryDirectory() as folder:
            out = Path(folder)
            (out / 'index.html').write_text('html')
            (out / 'sticky.html').write_text('html')
            build.validate_export(out)
            for name in ('.env', '.env.local', '.DS_Store', 'notes.db', 'notes.sqlite', 'secret.pem'):
                path = out / name
                path.write_text('must never package')
                with self.assertRaises(RuntimeError):
                    build.validate_export(out)
                path.unlink()
            if sys.platform != 'win32':
                (out / 'escape').symlink_to(ROOT)
                with self.assertRaises(RuntimeError):
                    build.validate_export(out)

    def test_missing_frontend_or_unsupported_host_fails_early(self):
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaises(RuntimeError):
                build.validate_export(Path(folder))
        with patch.object(build.sys, 'platform', 'linux'):
            with self.assertRaises(RuntimeError):
                build.native_target()

    def test_installer_harness_checks_installed_binary_and_preserves_fixture(self):
        spec = importlib.util.spec_from_file_location('installer_harness_test', ROOT / 'scripts' / 'test_windows_installer.py')
        harness = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(harness)
        calls = []

        def simulate(command, **kwargs):
            calls.append(command)
            if Path(command[0]).name == 'setup.exe':
                self.assertIn('/VERYSILENT', command)
                folder = Path(next(value[5:] for value in command if value.startswith('/DIR=')))
                folder.mkdir()
                (folder / 'SmartNotes.exe').touch()
                (folder / 'unins000.exe').touch()
            elif Path(command[0]).name == 'unins000.exe':
                folder = Path(command[0]).parent
                (folder / 'SmartNotes.exe').unlink()
                (folder / 'unins000.exe').unlink()
            else:
                self.assertTrue(Path(command[2]).is_file())

        with tempfile.TemporaryDirectory() as folder:
            reports = Path(folder) / 'reports'
            with patch.object(harness.sys, 'platform', 'win32'), patch.object(harness.sys, 'argv',
                    ['test_windows_installer.py', str(Path(folder) / 'setup.exe'), '--reports', str(reports)]), patch.object(harness.subprocess, 'run', side_effect=simulate):
                self.assertEqual(harness.main(), 0)
            report = json.loads((reports / 'windows-installer.json').read_text())
            self.assertEqual(report['checks'], ['silent-install', 'installed-backend', 'installed-native-renderer',
                                               'uninstall-removes-app', 'preserves-separate-user-data-fixture'])
            self.assertEqual(len(calls), 4)


if __name__ == '__main__':
    unittest.main()
