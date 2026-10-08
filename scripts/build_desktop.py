#!/usr/bin/env python3
"""Native-host builds only. Never copies the repository or user home wholesale."""
import argparse
import hashlib
import json
import os
import platform
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def validate_export(folder):
    for required in ('index.html', 'sticky.html'):
        if not (folder / required).is_file():
            raise RuntimeError(f'Missing static frontend {required}; build frontend with NEXT_OUTPUT=export')
    for path in folder.rglob('*'):
        name = path.name.lower()
        if path.is_symlink() or name.startswith('.env') or name in ('.ds_store', '.smart_notes_uploads') or path.suffix.lower() in ('.db', '.sqlite', '.sqlite3', '.pem', '.key'):
            raise RuntimeError(f'Private or unexpected file in frontend export: {path}')


def native_target():
    arch = platform.machine().lower()
    if sys.platform == 'darwin' and arch in ('arm64', 'x86_64'):
        return 'macos', 'arm64' if arch == 'arm64' else 'x64'
    if sys.platform == 'win32' and arch in ('amd64', 'x86_64'):
        return 'windows', 'x64'
    raise RuntimeError('Build on a native macOS arm64/x64 or Windows x64 host; cross compilation is unsupported')


def run(command, **kwargs):
    print('+', ' '.join(map(str, command)), flush=True)
    subprocess.run(list(map(str, command)), check=True, **kwargs)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--version', default=os.environ.get('SMART_NOTES_VERSION', '0.2.0'))
    parser.add_argument('--skip-frontend', action='store_true')
    parser.add_argument('--skip-freeze', action='store_true', help='Package an already built onedir bundle')
    parser.add_argument('--skip-installer', action='store_true')
    args = parser.parse_args()
    if not re.fullmatch(r'\d+\.\d+\.\d+', args.version):
        raise SystemExit('Version must have the form 0.2.0')
    system, arch = native_target()
    env = dict(os.environ, SMART_NOTES_VERSION=args.version,
               PYINSTALLER_CONFIG_DIR=str(ROOT / 'build' / 'desktop-cache'))
    if not args.skip_frontend:
        npm = shutil.which('npm.cmd' if sys.platform == 'win32' else 'npm')
        if not npm:
            raise RuntimeError('Node.js 22 and npm are required to build the frontend')
        run([npm, 'ci'], cwd=ROOT / 'frontend')
        run([npm, 'exec', 'tsc', '--', '--noEmit', '--incremental', 'false'], cwd=ROOT / 'frontend')
        run([npm, 'run', 'build'], cwd=ROOT / 'frontend', env=dict(env, NEXT_OUTPUT='export'))
    validate_export(ROOT / 'frontend' / 'out')
    build, dist, releases = ROOT / 'build' / 'desktop', ROOT / 'dist', ROOT / 'dist' / 'releases'
    releases.mkdir(parents=True, exist_ok=True)
    if not args.skip_freeze:
        run([sys.executable, '-m', 'PyInstaller', '--clean', '--noconfirm', '--distpath', dist,
             '--workpath', build, ROOT / 'packaging' / 'smart-notes.spec'], cwd=ROOT, env=env)
    prefix = f'SmartNotes-{args.version}-{system}-{arch}'
    if not args.skip_installer:
        if system == 'macos':
            app = dist / 'Smart Notes.app'
            if not app.is_dir():
                raise RuntimeError('The macOS app bundle is missing')
            run(['codesign', '--verify', '--deep', '--strict', app])
            stage = build / 'dmg'
            if stage.exists():
                shutil.rmtree(stage)
            stage.mkdir(parents=True)
            run(['ditto', app, stage / app.name])
            (stage / 'Applications').symlink_to('/Applications')
            run(['hdiutil', 'create', '-volname', 'Smart Notes', '-srcfolder', stage,
                 '-ov', '-format', 'UDZO', releases / (prefix + '.dmg')])
            run(['ditto', '-c', '-k', '--sequesterRsrc', '--keepParent', app, releases / (prefix + '.zip')])
        else:
            compiler = shutil.which('ISCC.exe')
            if not compiler:
                candidate = Path(os.environ.get('ProgramFiles(x86)', r'C:\Program Files (x86)')) / 'Inno Setup 6' / 'ISCC.exe'
                compiler = str(candidate) if candidate.is_file() else None
            if not compiler:
                raise RuntimeError('Install Inno Setup 6 to produce the Windows installer')
            run([compiler, f'/DAppVersion={args.version}', f'/DSourceDir={dist / "SmartNotes"}',
                 f'/DOutputDir={releases}', ROOT / 'packaging' / 'windows.iss'])
            shutil.make_archive(str(releases / prefix), 'zip', root_dir=dist / 'SmartNotes')
    assets = []
    for path in sorted(releases.glob(prefix + '*')):
        if path.suffix not in ('.dmg', '.zip', '.exe'):
            continue
        assets.append({'name': path.name, 'size': path.stat().st_size,
                       'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
    manifest = {'version': args.version, 'platform': system, 'arch': arch,
                'signed': False, 'notarized': False, 'assets': assets}
    (releases / (prefix + '.json')).write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
