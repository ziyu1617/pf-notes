# Build with: python scripts/build_desktop.py --version 0.2.0
import os
import sys
from pathlib import Path
from PyInstaller.utils.hooks import collect_data_files, collect_submodules

root = Path(SPECPATH).parent
version = os.environ.get('SMART_NOTES_VERSION', '0.2.0')
datas = [(str(root / 'frontend' / 'out'), 'frontend/out')]
datas += collect_data_files('webview')
hidden = collect_submodules('uvicorn')
hidden += ['api', 'app', 'runtime_paths', 'desktop_sticky', 'desktop_instance']
if sys.platform == 'win32':
    hidden += ['webview.platforms.winforms', 'webview.platforms.edgechromium',
               'desktop_windows', 'desktop_windows_instance']
else:
    hidden += ['webview.platforms.cocoa']

a = Analysis([str(root / 'packaging' / 'entry.py')],
             pathex=[str(root), str(root / 'packaging')], datas=datas,
             hiddenimports=hidden,
             excludes=['PyQt5', 'PyQt6', 'PySide2', 'PySide6', 'gi', 'cefpython3', 'tkinter'],
             noarchive=False)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name='SmartNotes',
          debug=False, strip=False, upx=False, console=False,
          target_arch=None, argv_emulation=False,
          codesign_identity=os.environ.get('SMART_NOTES_CODESIGN_IDENTITY') or None)
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name='SmartNotes')
if sys.platform == 'darwin':
    bundle = BUNDLE(coll, name='Smart Notes.app', bundle_identifier='com.ziyu1617.smartnotes',
                    info_plist={'CFBundleShortVersionString': version, 'CFBundleVersion': version,
                                'NSHighResolutionCapable': True,
                                'NSAppTransportSecurity': {'NSAllowsLocalNetworking': True}})
