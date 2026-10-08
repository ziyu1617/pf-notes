"""Read-only application resources and persistent, per-user data locations."""
import os
import sys
from pathlib import Path


def resource_root():
    return Path(getattr(sys, '_MEIPASS', Path(__file__).resolve().parent))


def data_root():
    # The override makes packaged smoke tests independent of the user's data.
    return Path(os.environ['SMART_NOTES_DATA_DIR']).expanduser().resolve() if os.environ.get('SMART_NOTES_DATA_DIR') else Path.home()


def config_path():
    if os.environ.get('SMART_NOTES_DATA_DIR') or getattr(sys, 'frozen', False):
        return data_root() / '.smart_notes.env'
    return resource_root() / '.env'


def instance_identity():
    # A onefile extraction directory changes on every launch; the installed
    # executable is stable for both onedir and onefile bundles.
    return Path(sys.executable).resolve() if getattr(sys, 'frozen', False) else resource_root()
