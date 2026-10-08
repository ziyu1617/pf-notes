"""Windowed executable entry; smoke mode never opens the user's database."""
import argparse
import logging
import multiprocessing
import os
import sys
from pathlib import Path

if not getattr(sys, 'frozen', False):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def main():
    multiprocessing.freeze_support()
    for name in ('stdout', 'stderr'):
        if getattr(sys, name) is None:
            setattr(sys, name, open(os.devnull, 'w', encoding='utf-8'))
    parser = argparse.ArgumentParser()
    parser.add_argument('--smoke-test', action='store_true')
    parser.add_argument('--smoke-gui', action='store_true')
    parser.add_argument('--smoke-report', type=Path)
    args = parser.parse_args()
    # Windowed Windows bootloaders leave stdout/stderr unset. Uvicorn and
    # pywebview still expect file-like objects with isatty/write/flush.
    if args.smoke_test:
        from frozen_smoke import run
        return run(args.smoke_report, gui=args.smoke_gui)

    from runtime_paths import data_root
    from logging.handlers import RotatingFileHandler
    root = data_root()
    root.mkdir(parents=True, exist_ok=True)
    log = root / '.smart_notes-desktop.log'
    logging.basicConfig(level=logging.WARNING, handlers=[RotatingFileHandler(
        log, maxBytes=1_000_000, backupCount=2, encoding='utf-8')])
    if getattr(sys, 'frozen', False):
        # Preserve explicit launcher errors (for example an occupied port) in
        # the same discoverable log instead of the windowed bootloader's sink.
        sys.stdout = sys.stderr = log.open('a', encoding='utf-8', buffering=1)
    try:
        from app import main as launch
        launch()
        return 0
    except BaseException as error:
        if isinstance(error, SystemExit) and not error.code:
            return 0
        logging.exception('Desktop startup failed')
        message = f'Smart Notes could not start. See the log at:\n{log}'
        try:
            if sys.platform == 'win32':
                import ctypes
                ctypes.windll.user32.MessageBoxW(None, message, 'Smart Notes', 0x10)
            elif sys.platform == 'darwin':
                from AppKit import NSAlert
                alert = NSAlert.alloc().init()
                alert.setMessageText_('Smart Notes could not start')
                alert.setInformativeText_(message)
                alert.runModal()
        except Exception:
            pass
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
