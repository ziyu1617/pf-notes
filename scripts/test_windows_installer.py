#!/usr/bin/env python3
"""Exercise the real installer in a disposable Windows CI directory."""
import argparse
import hashlib
import json
import sqlite3
import subprocess
import sys
import tempfile
import traceback
from pathlib import Path


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('installer', type=Path)
    parser.add_argument('--reports', type=Path, required=True)
    args = parser.parse_args()
    if sys.platform != 'win32':
        raise SystemExit('Run this test on Windows, not through cross compilation')
    reports = args.reports.resolve()
    reports.mkdir(parents=True, exist_ok=True)
    report = {'ok': False, 'checks': []}
    try:
        with tempfile.TemporaryDirectory(prefix='smart-notes-installer-') as temporary:
            root = Path(temporary)
            installed = root / 'Smart Notes'
            user_data = root / 'isolated-user-data'
            user_data.mkdir()
            database = user_data / '.smart_notes.db'
            uploads = user_data / '.smart_notes_uploads'
            uploads.mkdir()
            attachment = uploads / 'preserved-test-attachment.txt'
            attachment.write_text('Installer must retain user attachments.', encoding='utf-8')
            connection = sqlite3.connect(database)
            try:
                connection.execute('CREATE TABLE notes (id INTEGER PRIMARY KEY, content TEXT)')
                connection.execute('INSERT INTO notes (content) VALUES (?)', ('Preserve this test note',))
                connection.commit()
            finally:
                connection.close()
            before = {path.name: digest(path) for path in (database, attachment)}
            uninstaller = installed / 'unins000.exe'
            try:
                subprocess.run([str(args.installer.resolve()), '/VERYSILENT', '/SUPPRESSMSGBOXES',
                                '/NORESTART', '/SP-', f'/DIR={installed}'], check=True, timeout=180)
                executable = installed / 'SmartNotes.exe'
                assert executable.is_file(), 'Installer did not create the application'
                report['checks'].append('silent-install')
                for gui in (False, True):
                    output = reports / ('windows-installed-gui.json' if gui else 'windows-installed-backend.json')
                    command = [sys.executable, str(Path(__file__).with_name('smoke_desktop.py')),
                               str(executable), '--report', str(output)]
                    if gui:
                        command.append('--gui')
                    subprocess.run(command, check=True, timeout=110)
                    report['checks'].append('installed-native-renderer' if gui else 'installed-backend')
            finally:
                if uninstaller.is_file():
                    subprocess.run([str(uninstaller), '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART'],
                                   check=True, timeout=120)
            assert not (installed / 'SmartNotes.exe').exists(), 'Uninstall left the executable behind'
            report['checks'].append('uninstall-removes-app')
            assert before == {path.name: digest(path) for path in (database, attachment)}, 'Uninstall modified user data'
            report['checks'].append('preserves-separate-user-data-fixture')
            report['ok'] = True
    except BaseException:
        report['error'] = traceback.format_exc()
    (reports / 'windows-installer.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, indent=2))
    return 0 if report['ok'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
