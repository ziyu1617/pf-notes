"""Packaging checks without loading the API, GUI, or personal data."""
import importlib.util
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


if __name__ == '__main__':
    unittest.main()
