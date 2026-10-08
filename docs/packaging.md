# Desktop packages

The build produces native, self-contained Python + static Next.js bundles. End users do not need Python or Node.js. Build each target on that operating system and architecture; this project does not cross-compile Windows on macOS or produce a universal Mac binary.

| Target | Build host | Output |
| --- | --- | --- |
| Apple Silicon | macOS arm64 | `SmartNotes-0.2.0-macos-arm64.dmg`, `.zip` |
| Intel Mac | macOS x64 | `SmartNotes-0.2.0-macos-x64.dmg`, `.zip` |
| Windows x64 | Windows x64 | `SmartNotes-0.2.0-windows-x64-setup.exe`, `.zip` |

CI currently uses macOS 15 and Windows Server 2022 runners with Python 3.11 and Node 22. These are validation environments, not a promise that every older OS is supported. Windows requires Windows 10 version 1607 or later, .NET Framework, and Microsoft Edge WebView2 Evergreen Runtime. The per-user installer checks the Runtime and directs users to Microsoft's official installer if it is missing; it never silently falls back to Internet Explorer. Test Windows 10/11 and older supported macOS versions before claiming those versions as verified.

## Local build

Use a clean virtual environment so unrelated Qt packages and development tools are not accidentally bundled.

```sh
python3 -m venv .venv-packaging
.venv-packaging/bin/python -m pip install -r requirements-build.txt
.venv-packaging/bin/python scripts/build_desktop.py --version 0.2.0
```

On Windows, use `py -3.11 -m venv .venv-packaging`, then `.venv-packaging\Scripts\python.exe` for the last two commands. Install Node.js 22 and Inno Setup 6 first. On macOS, install Xcode Command Line Tools. The build invokes `npm ci`, a separate TypeScript check, the static export, PyInstaller, and the native installer tool. `--skip-frontend` reuses a validated export. `--skip-installer` stops after freezing. No build command creates a GitHub release or uploads files.

Only `frontend/out` and dependency resources are explicitly added to the bundle. `.env`, databases, uploads, repository backups, and local operating-system metadata are not package inputs. An export check rejects private files and symlinks before freezing. Never manually copy the entire repository into the bundle.

## Persistence and configuration

The installed app keeps the existing user data locations: `~/.smart_notes.db` and `~/.smart_notes_uploads`. It does not write them inside the application bundle, installation directory, or DMG. Uninstalling removes application files only, leaving notes and pictures in place.

Optional AI credentials belong in `~/.smart_notes.env` for installed builds, for example `ZHIPU_API_KEY=...`. Source checkouts continue to read the project `.env`. No credential is embedded in the application. `SMART_NOTES_DATA_DIR` overrides the data directory for isolated testing; ordinary users can leave it unset.

## Validation and CI

`.github/workflows/desktop-build.yml` builds all three targets independently. The `codex/desktop-packaging` branch trigger is for packaging validation; manual dispatch also accepts a version. It uploads Actions artifacts and reports, without publishing releases.

Each frozen executable runs a backend/resource smoke test against a new temporary database, then a separate native renderer smoke test. Both run under a 90-second parent timeout. The renderer check must load the page and execute JavaScript successfully; a missing WebView2 runtime or GUI initialization error fails the job. These checks do not replace manual installation, diary editing, IME, sticky dragging/resizing, multi-monitor, sleep/wake, upgrade, and uninstall testing on real user machines.

```sh
python scripts/smoke_desktop.py "dist/Smart Notes.app/Contents/MacOS/SmartNotes" --report dist/reports/local-backend.json
python scripts/smoke_desktop.py "dist/Smart Notes.app/Contents/MacOS/SmartNotes" --gui --report dist/reports/local-gui.json
```

For Windows, substitute `dist/SmartNotes/SmartNotes.exe`. The smoke tests set an isolated data directory before importing the API, so they cannot open personal notes.

## Signing and distribution

Current packages are **unsigned distribution builds**. PyInstaller applies the required ad-hoc Mac signatures, which do not identify a trusted developer and are not Apple notarization. Windows SmartScreen and macOS Gatekeeper may warn or block downloaded builds. Do not disable these protections or strip quarantine as an installation step. Developer ID signing + Apple notarization/stapling, and Windows code signing, are separate release prerequisites for a frictionless public download.

`SMART_NOTES_CODESIGN_IDENTITY` can pass an installed Developer ID identity to PyInstaller; notarization and Windows signing are intentionally not automated without the owner's certificates. Per-target JSON manifests record SHA-256 and size; their default `signed: false` / `notarized: false` status must only change after genuine signing verification.

## Primary references

- [PyInstaller platform-specific builds](https://pyinstaller.org/en/stable/operating-mode.html)
- [PyInstaller runtime resource paths](https://pyinstaller.org/en/stable/runtime-information.html)
- [PyInstaller macOS signing](https://pyinstaller.org/en/stable/feature-notes.html#macos-binary-code-signing)
- [pywebview dependencies](https://pywebview.flowrl.com/guide/installation.html) and [freezing guidance](https://pywebview.flowrl.com/guide/freezing.html)
- [Microsoft WebView2 Runtime distribution](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)
- [Inno Setup per-user installation](https://jrsoftware.org/ishelp/topic_setup_privilegesrequired.htm)
- [GitHub runner architectures](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
